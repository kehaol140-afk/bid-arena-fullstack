package com.bidarena.settlement;

import com.bidarena.auction.Auction;
import com.bidarena.auction.AuctionEventWriter;
import com.bidarena.auction.AuctionRepository;
import com.bidarena.common.BusinessException;
import com.bidarena.common.ErrorCode;
import com.bidarena.wallet.Wallet;
import com.bidarena.wallet.WalletRepository;
import org.noear.solon.annotation.Component;
import org.noear.solon.annotation.Inject;
import org.noear.solon.data.annotation.Tran;
import org.noear.solon.data.sql.SqlUtils;

import java.sql.SQLException;
import java.sql.SQLIntegrityConstraintViolationException;
import java.util.List;

/**
 * 唯一结算（两阶段，重启可恢复）：
 *
 * phase1 tryClaim（独立小事务）：原子 CAS RUNNING→SETTLING（条件 end_time<=now）。
 *   - 抢到 → 本实例获得结算权；affected=0 → 已结束跳过 / 滞留 SETTLING（崩溃残留）进入恢复。
 * phase2 finalize（独立事务）：
 *   - 锁拍卖 → 锁持仓行（userId 升序）→ 锁钱包 → 赢家冻结转扣款 → 其余释放
 *   - INSERT auction_results（主键 auction_id，数据库级唯一保护；并发双实例必有一方回滚）
 *   - 状态置 FINISHED + 事件 AUCTION_FINISHED
 *
 * 幂等：资金操作只在成交记录不存在时执行；若 result 已存在仅补 FINISHED 状态。
 */
@Component
public class SettlementService {
    @Inject
    AuctionRepository auctions;
    @Inject
    WalletRepository wallets;
    @Inject
    AuctionEventWriter events;
    @Inject
    SqlUtils sql;

    public enum Claim { CLAIMED, RESUME, SKIP }

    /** phase1：抢占/恢复结算权。 */
    @Tran
    public Claim tryClaim(long auctionId, long now) {
        try {
            int affected = sql.sql("""
                            UPDATE auctions SET status = 'SETTLING', updated_at = ?
                            WHERE id = ? AND status = 'RUNNING' AND end_time <= ?
                            """, now, auctionId, now).update();
            if (affected == 1) {
                return Claim.CLAIMED;
            }
            Auction a = auctions.findById(auctionId);
            if (a == null) {
                return Claim.SKIP;
            }
            if (Auction.SETTLING.equals(a.getStatus())) {
                return Claim.RESUME; // 崩溃/重启残留，恢复结算
            }
            return Claim.SKIP;
        } catch (SQLException e) {
            throw new RuntimeException(e);
        }
    }

    /** phase2：资金结算 + 唯一成交 + FINISHED。返回事件 seq（-1 表示无事可做）。 */
    @Tran
    public long finalizeSettlement(long auctionId) {
        try {
            Auction a = auctions.lockById(auctionId);
            if (a == null) {
                throw new BusinessException(ErrorCode.NOT_FOUND, "拍卖不存在");
            }
            if (!Auction.SETTLING.equals(a.getStatus())) {
                return -1L; // 已完成/已取消
            }
            long now = System.currentTimeMillis();
            Long winnerId = a.getCurrentLeaderId();

            // 已有成交记录（崩溃于 phase2 之后半途的恢复路径）：只补 FINISHED
            Number existing = sql.sql("SELECT auction_id FROM auction_results WHERE auction_id = ?", auctionId)
                    .queryValue();
            if (existing == null) {
                settleFunds(a, winnerId, now);
                insertResult(auctionId, winnerId, winnerId == null ? 0L : a.getCurrentPrice(), "EXPIRED", now);
            }
            auctions.markFinished(auctionId, "EXPIRED", now);
            return events.append(auctionId, "AUCTION_FINISHED", n -> {
                n.set("reason", "EXPIRED");
                n.set("winnerId", winnerId == null ? (Object) null : winnerId);
                n.set("finalPrice", winnerId == null ? 0L : a.getCurrentPrice());
            });
        } catch (SQLException e) {
            throw new RuntimeException(e);
        }
    }

    /**
     * 资金结算：赢家冻结转扣款（balance-=hold, frozen-=hold），其余参与者全部释放。
     * 锁顺序与 BidService 一致：auction → wallet_holds(userId asc) → wallets。
     */
    private void settleFunds(Auction a, Long winnerId, long now) throws SQLException {
        List<WalletRepository.HoldRow> holds = wallets.lockHoldsByAuction(a.getId());
        for (WalletRepository.HoldRow h : holds) {
            Wallet w = wallets.lockByUserId(h.getUserId());
            if (w == null) {
                continue;
            }
            boolean isWinner = winnerId != null && winnerId == h.getUserId();
            if (isWinner) {
                long hold = h.getAmount();
                long newBalance = w.getBalance() - hold;
                long newFrozen = w.getFrozen() - hold;
                if (newBalance < 0 || newFrozen < 0) {
                    throw new IllegalStateException("结算资金异常: user=" + h.getUserId());
                }
                wallets.updateFrozenAndBalance(h.getUserId(), newBalance, newFrozen, now);
                wallets.upsertHold(h.getUserId(), a.getId(), 0L, now);
                wallets.insertLedger(h.getUserId(), a.getId(), null, "PAY", -hold,
                        newBalance, newFrozen, "win auction " + a.getId(), now);
            } else {
                long newFrozen = w.getFrozen() - h.getAmount();
                if (newFrozen < 0) {
                    throw new IllegalStateException("释放资金异常: user=" + h.getUserId());
                }
                wallets.updateFrozenAndBalance(h.getUserId(), w.getBalance(), newFrozen, now);
                wallets.upsertHold(h.getUserId(), a.getId(), 0L, now);
                wallets.insertLedger(h.getUserId(), a.getId(), null, "UNFREEZE", h.getAmount(),
                        w.getBalance(), newFrozen, "auction " + a.getId() + " settled, release hold", now);
            }
        }
    }

    private void insertResult(long auctionId, Long winnerId, long finalPrice, String reason, long now)
            throws SQLException {
        try {
            sql.sql("""
                            INSERT INTO auction_results(auction_id, winner_id, final_price, reason, settled_at, created_at)
                            VALUES (?, ?, ?, ?, ?, ?)
                            """, auctionId, winnerId, finalPrice, reason, now, now).update();
        } catch (SQLIntegrityConstraintViolationException e) {
            throw new IllegalStateException("结算结果已存在（并发结算被唯一约束拦截）: " + auctionId, e);
        }
    }
}
