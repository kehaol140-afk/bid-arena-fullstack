package com.bidarena.auction;

import com.bidarena.auction.dto.AuctionDetailVO;
import com.bidarena.auction.dto.CreateAuctionRequest;
import com.bidarena.common.BusinessException;
import com.bidarena.common.ErrorCode;
import com.bidarena.wallet.WalletRepository;
import org.noear.solon.annotation.Component;
import org.noear.solon.annotation.Inject;
import org.noear.solon.data.annotation.Tran;
import org.noear.solon.data.sql.SqlUtils;

import java.sql.SQLException;
import java.sql.SQLIntegrityConstraintViolationException;
import java.util.ArrayList;
import java.util.List;

/**
 * 拍卖状态机与生命周期：
 * DRAFT → (start) → RUNNING → (到期扫描) → SETTLING → (结算) → FINISHED
 * DRAFT/RUNNING → (cancel) → CANCELLED（SETTLING 之后禁止取消）
 */
@Component
public class AuctionService {
    @Inject
    AuctionRepository auctions;
    @Inject
    AuctionEventWriter events;
    @Inject
    WalletRepository wallets;
    @Inject
    SqlUtils sql;

    public long create(long adminUserId, CreateAuctionRequest req) {
        if (req.getTitle() == null || req.getTitle().isBlank()) {
            throw new BusinessException(ErrorCode.VALIDATION, "title 必填");
        }
        long startPrice = req.getStartPrice() == null ? 100L : req.getStartPrice();
        long minIncrement = req.getMinIncrement() == null ? 10L : req.getMinIncrement();
        int duration = req.getDurationSeconds() == null ? 180 : req.getDurationSeconds();
        if (startPrice <= 0 || minIncrement <= 0) {
            throw new BusinessException(ErrorCode.VALIDATION, "价格与最小加价必须为正整数");
        }
        if (duration < 3 || duration > 3600) {
            throw new BusinessException(ErrorCode.VALIDATION, "durationSeconds 取值 3~3600（默认 180 秒）");
        }
        try {
            long id = auctions.insert(req.getTitle().trim(), req.getDescription(), startPrice, minIncrement,
                    duration, adminUserId, System.currentTimeMillis());
            return id;
        } catch (SQLException e) {
            throw new RuntimeException(e);
        }
    }

    /** 管理员启动：DRAFT -> RUNNING，设置服务端截止时间。返回事件 seq（提交后由控制器广播）。 */
    @Tran
    public long start(long auctionId) {
        try {
            Auction a = auctions.lockById(auctionId);
            if (a == null) {
                throw new BusinessException(ErrorCode.NOT_FOUND, "拍卖不存在");
            }
            if (!Auction.DRAFT.equals(a.getStatus())) {
                throw new BusinessException(ErrorCode.AUCTION_STATE_INVALID,
                        "当前状态 " + a.getStatus() + " 不可启动");
            }
            long now = System.currentTimeMillis();
            long endTime = now + a.getDurationSeconds() * 1000L;
            sql.sql("UPDATE auctions SET status = 'RUNNING', started_at = ?, end_time = ?, updated_at = ? WHERE id = ?",
                    now, endTime, now, auctionId).update();
            return events.append(auctionId, "AUCTION_STARTED", n -> {
                n.set("startTime", now);
                n.set("endTime", endTime);
                n.set("currentPrice", a.getStartPrice());
            });
        } catch (SQLException e) {
            throw new RuntimeException(e);
        }
    }

    /** 管理员取消：释放本场全部冻结，写唯一结果（reason=CANCELLED，无赢家）。返回事件 seq。 */
    @Tran
    public long cancel(long auctionId) {
        try {
            Auction a = auctions.lockById(auctionId);
            if (a == null) {
                throw new BusinessException(ErrorCode.NOT_FOUND, "拍卖不存在");
            }
            if (!Auction.DRAFT.equals(a.getStatus()) && !Auction.RUNNING.equals(a.getStatus())) {
                throw new BusinessException(ErrorCode.AUCTION_STATE_INVALID,
                        "状态 " + a.getStatus() + " 不可取消（SETTLING 之后禁止取消）");
            }
            long now = System.currentTimeMillis();
            releaseAllHolds(auctionId, now);

            // 结果表唯一键 auction_id 保护：重复取消不会产生第二条结果
            insertResultIgnoreDuplicate(auctionId, null, 0L, "CANCELLED", now);
            auctions.markFinished(auctionId, "CANCELLED", now);
            return events.append(auctionId, "AUCTION_FINISHED", n -> {
                n.set("reason", "CANCELLED");
                n.set("winnerId", (Object) null);
            });
        } catch (SQLException e) {
            throw new RuntimeException(e);
        }
    }

    /** 释放本场所有持仓（调用方必须持有拍卖行锁且处于事务中；钱包按 userId 升序加锁，避免死锁） */
    void releaseAllHolds(long auctionId, long now) throws SQLException {
        List<WalletRepository.HoldRow> holds = wallets.lockHoldsByAuction(auctionId);
        for (WalletRepository.HoldRow h : holds) {
            var w = wallets.lockByUserId(h.getUserId());
            if (w == null) {
                continue; // 理论不可达：wallet 随 user 创建
            }
            long newFrozen = w.getFrozen() - h.getAmount();
            if (newFrozen < 0) {
                throw new IllegalStateException("冻结余额异常: user=" + h.getUserId());
            }
            wallets.updateFrozenAndBalance(h.getUserId(), w.getBalance(), newFrozen, now);
            wallets.upsertHold(h.getUserId(), auctionId, 0L, now);
            wallets.insertLedger(h.getUserId(), auctionId, null, "UNFREEZE", h.getAmount(),
                    w.getBalance(), newFrozen, "auction cancelled, release hold", now);
        }
    }

    /** INSERT IGNORE 语义由调用场景保证幂等：auction_results 主键冲突时忽略（结算/取消并发触发） */
    void insertResultIgnoreDuplicate(long auctionId, Long winnerId, long finalPrice, String reason, long now)
            throws SQLException {
        try {
            sql.sql("""
                            INSERT INTO auction_results(auction_id, winner_id, final_price, reason, settled_at, created_at)
                            VALUES (?, ?, ?, ?, ?, ?)
                            """, auctionId, winnerId, finalPrice, reason, now, now).update();
        } catch (SQLIntegrityConstraintViolationException e) {
            // 主键冲突 = 已有结果，幂等忽略
        }
    }

    /** 加入拍卖（仅 RUNNING）；唯一约束保证重复加入幂等。返回 PARTICIPANT_JOINED 事件 seq（幂等重复加入返回 0）。 */
    @Tran
    public long join(long auctionId, long userId, boolean agent) {
        try {
            Auction a = auctions.lockById(auctionId);
            if (a == null) {
                throw new BusinessException(ErrorCode.NOT_FOUND, "拍卖不存在");
            }
            if (!Auction.RUNNING.equals(a.getStatus())) {
                throw new BusinessException(ErrorCode.AUCTION_NOT_RUNNING,
                        "当前状态 " + a.getStatus() + " 不可加入");
            }
            boolean already;
            try {
                auctions.insertParticipant(auctionId, userId, agent ? "AGENT" : "HUMAN",
                        System.currentTimeMillis());
                already = false;
            } catch (SQLIntegrityConstraintViolationException e) {
                already = true; // 幂等：重复加入视为成功
            }
            if (already) {
                return 0L;
            }
            return events.append(auctionId, "PARTICIPANT_JOINED", n -> {
                n.set("userId", userId);
                n.set("type", agent ? "AGENT" : "HUMAN");
            });
        } catch (SQLException e) {
            throw new RuntimeException(e);
        }
    }

    public AuctionDetailVO detail(long auctionId) {
        try {
            Auction a = auctions.findById(auctionId);
            if (a == null) {
                throw new BusinessException(ErrorCode.NOT_FOUND, "拍卖不存在");
            }
            return toDetail(a);
        } catch (SQLException e) {
            throw new RuntimeException(e);
        }
    }

    public List<AuctionDetailVO> list() {
        try {
            List<Auction> rows = auctions.listAll();
            List<AuctionDetailVO> out = new ArrayList<>();
            for (Auction a : rows) {
                out.add(toSummary(a));
            }
            return out;
        } catch (SQLException e) {
            throw new RuntimeException(e);
        }
    }

    public AuctionDetailVO toSummary(Auction a) throws SQLException {
        AuctionDetailVO vo = base(a);
        Number cnt = sql.sql("SELECT COUNT(*) FROM auction_participants WHERE auction_id = ?", a.getId())
                .queryValue();
        vo.setParticipantCount(cnt == null ? 0 : cnt.intValue());
        return vo;
    }

    public AuctionDetailVO toDetail(Auction a) throws SQLException {
        AuctionDetailVO vo = base(a);
        List<AuctionRepository.ParticipantRow> parts = auctions.listParticipants(a.getId());
        List<AuctionDetailVO.ParticipantVO> pv = new ArrayList<>();
        for (var p : parts) {
            AuctionDetailVO.ParticipantVO x = new AuctionDetailVO.ParticipantVO();
            x.setUserId(p.getUserId());
            x.setDisplayName(p.getDisplayName());
            x.setType(p.getParticipantType());
            x.setJoinedAt(p.getJoinedAt());
            pv.add(x);
        }
        vo.setParticipants(pv);
        vo.setParticipantCount(pv.size());
        if (a.getCurrentLeaderId() != null) {
            vo.setCurrentLeaderName(displayNameOf(a.getCurrentLeaderId()));
        }
        // 结束后附带成交结果
        if (Auction.FINISHED.equals(a.getStatus()) || Auction.CANCELLED.equals(a.getStatus())) {
            ResultRow r = sql.sql("""
                            SELECT r.winner_id AS winnerId, r.final_price AS finalPrice, r.reason AS reason,
                                   r.settled_at AS settledAt, u.display_name AS winnerName
                            FROM auction_results r LEFT JOIN users u ON u.id = r.winner_id
                            WHERE r.auction_id = ?
                            """, a.getId()).queryRow(ResultRow.class);
            if (r != null) {
                AuctionDetailVO.ResultVO rv = new AuctionDetailVO.ResultVO();
                rv.setWinnerId(r.getWinnerId());
                rv.setWinnerName(r.getWinnerName());
                rv.setFinalPrice(r.getFinalPrice());
                rv.setReason(r.getReason());
                rv.setSettledAt(r.getSettledAt());
                vo.setResult(rv);
            }
        }
        return vo;
    }

    private AuctionDetailVO base(Auction a) {
        AuctionDetailVO vo = new AuctionDetailVO();
        vo.setId(a.getId());
        vo.setTitle(a.getTitle());
        vo.setDescription(a.getDescription());
        vo.setStatus(a.getStatus());
        vo.setStartPrice(a.getStartPrice());
        vo.setMinIncrement(a.getMinIncrement());
        vo.setCurrentPrice(a.getCurrentPrice());
        vo.setCurrentLeaderId(a.getCurrentLeaderId());
        vo.setDurationSeconds(a.getDurationSeconds());
        vo.setStartedAt(a.getStartedAt());
        vo.setEndTime(a.getEndTime());
        vo.setExtendCount(a.getExtendCount());
        vo.setMaxExtends(a.getMaxExtends());
        vo.setSeq(a.getSeq());
        vo.setSettleReason(a.getSettleReason());
        vo.setCreatedAt(a.getCreatedAt());
        return vo;
    }

    String displayNameOf(long userId) throws SQLException {
        String n = sql.sql("SELECT display_name FROM users WHERE id = ?", userId).queryValue();
        return n;
    }

    public static class ResultRow {
        private Long winnerId;
        private String winnerName;
        private long finalPrice;
        private String reason;
        private long settledAt;

        public Long getWinnerId() {
            return winnerId;
        }

        public void setWinnerId(Long winnerId) {
            this.winnerId = winnerId;
        }

        public String getWinnerName() {
            return winnerName;
        }

        public void setWinnerName(String winnerName) {
            this.winnerName = winnerName;
        }

        public long getFinalPrice() {
            return finalPrice;
        }

        public void setFinalPrice(long finalPrice) {
            this.finalPrice = finalPrice;
        }

        public String getReason() {
            return reason;
        }

        public void setReason(String reason) {
            this.reason = reason;
        }

        public long getSettledAt() {
            return settledAt;
        }

        public void setSettledAt(long settledAt) {
            this.settledAt = settledAt;
        }
    }
}
