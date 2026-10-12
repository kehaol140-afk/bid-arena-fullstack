package com.bidarena.bid;

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
import org.noear.solon.data.tran.TranIsolation;

import java.sql.SQLException;
import java.sql.SQLIntegrityConstraintViolationException;

/**
 * 出价事务引擎（全系统最高优先级）。
 *
 * 单事务关键步骤：
 * 锁拍卖 → 锁相关钱包(userId 升序) → requestId/auctionId/amount 幂等核对
 * → RUNNING/截止/最小价校验 → 新增冻结差额校验 → 释放旧领先者
 * → 冻结新领先者 → 更新最高价/领先者 → 写出价 → 写事件(seq) → 最后5秒延时 → 原子提交。
 *
 * 锁顺序（全局一致，防死锁）：auction 行锁 → wallet 行锁（userId 升序）。
 * 拍卖行锁是单场出价的串行化点：并发出价在锁上排队，最终顺序确定且可解释。
 *
 * 重要：本类方法必须由外部调用（Solon 代理拦截 @Tran），禁止同类自调用。
 */
@Component
public class BidTransaction {
    static final long EXTEND_WINDOW_MS = 5_000L;
    static final long EXTEND_MS = 10_000L;

    @Inject
    AuctionRepository auctions;
    @Inject
    WalletRepository wallets;
    @Inject
    AuctionEventWriter events;
    @Inject
    BidRepository bids;

    /**
     * @param receivedAt 请求进入服务端的时刻（epoch ms，由控制器在进入业务前捕获）
     */
    @Tran(isolation = TranIsolation.read_committed)
    public BidOutcome placeBid(long auctionId, long userId, String requestId, long amount, long receivedAt) {
        validateInput(auctionId, userId, requestId, amount);
        try {
            // 1-2. requestId 幂等检查必须位于拍卖行锁之后：
            // 若在锁前做 FOR UPDATE 空结果检查，并发同 requestId 事务会在 bids 唯一索引
            // 空区间各持 gap 锁（互相兼容），领先者 INSERT 的插入意向锁与其冲突，
            // 后续事务又在等拍卖行锁 —— 形成环形等待（实测 MySQL 1213 Deadlock，P6-3）。
            // 移到锁后：幂等检查在串行化点内执行，锁定读能读到已提交的同号出价 → 干净走重放。

            // 3. 锁拍卖（第一把锁：单场串行化点）
            Auction a = auctions.lockById(auctionId);
            if (a == null) {
                throw new BusinessException(ErrorCode.NOT_FOUND, "拍卖不存在");
            }
            // Auction -> involved wallets ascending -> request/holds.
            // Bidder wallet serializes (userId, requestId) across auctions.
            Long oldLeaderId = a.getCurrentLeaderId();
            java.util.Map<Long, Wallet> locked = wallets.lockUsers(userId, oldLeaderId);
            Wallet bidderWallet = locked.get(userId);
            // 1-2（锁内）。requestId 幂等（FOR UPDATE 在串行化点内，读到已提交即重放）
            BidRepository.BidRow existing = bids.findByRequest(userId, requestId);
            if (existing != null) {
                if (existing.getAmount() != amount || existing.getAuctionId() != auctionId) {
                    throw new BusinessException(ErrorCode.IDEMPOTENT_CONFLICT,
                            "requestId 已绑定金额 " + existing.getAmount());
                }
                return new BidOutcome(true, existing.getId(), existing.getSeq(), existing.getSeq(),
                        existing.getAmount(), null, false, 0, existing.getUserId(), 0);
            }
            // 4. 只有 RUNNING 接受出价
            if (!Auction.RUNNING.equals(a.getStatus())) {
                throw new BusinessException(ErrorCode.AUCTION_NOT_RUNNING, "当前状态 " + a.getStatus());
            }
            // 5. 截止边界：接收时间必须严格早于当前截止时间；等于即迟到
            long endTime = a.getEndTime() == null ? 0L : a.getEndTime();
            if (receivedAt >= endTime) {
                throw new BusinessException(ErrorCode.BID_TOO_LATE);
            }
            // 6. 最小合法出价 = 当前最高价 + 最小加价（服务端权威计算）
            long minPrice;
            try { minPrice = Math.addExact(a.getCurrentPrice(), a.getMinIncrement()); }
            catch (ArithmeticException e) { throw new BusinessException(ErrorCode.VALIDATION, "价格超过整数范围"); }
            if (amount < minPrice) {
                throw new BusinessException(ErrorCode.BID_TOO_LOW,
                        "最小合法出价 " + minPrice);
            }

            // 7. 锁钱包：先 bidder 自己
            if (bidderWallet == null) {
                throw new BusinessException(ErrorCode.NOT_FOUND, "钱包不存在");
            }
            long now = System.currentTimeMillis();

            // 释放旧领先者（若存在且不是自己）
            long oldHold = 0;
            if (oldLeaderId != null && oldLeaderId != userId) {
                Wallet oldLeaderWallet = locked.get(oldLeaderId);
                if (oldLeaderWallet == null) {
                    throw new IllegalStateException("旧领先者钱包缺失 user=" + oldLeaderId);
                }
                oldHold = wallets.findHoldAmount(oldLeaderId, auctionId);
                if (oldHold > 0) {
                    long newFrozen = oldLeaderWallet.getFrozen() - oldHold;
                    wallets.updateFrozenAndBalance(oldLeaderId, oldLeaderWallet.getBalance(), newFrozen, now);
                    wallets.upsertHold(oldLeaderId, auctionId, 0L, now);
                    wallets.insertLedger(oldLeaderId, auctionId, requestId, "UNFREEZE", oldHold,
                            oldLeaderWallet.getBalance(), newFrozen,
                            "outbid by user " + userId, now);
                }
            }

            // 8-9. 新增冻结差额 = amount - 本场已冻结
            long myHold = wallets.findHoldAmount(userId, auctionId);
            long delta = amount - myHold;
            if (delta > bidderWallet.available()) {
                throw new BusinessException(ErrorCode.INSUFFICIENT_FUNDS,
                        "需新增冻结 " + delta + "，可用 " + bidderWallet.available());
            }
            // 11. 冻结新领先者（同用户加价只增加差额）
            long newFrozen = bidderWallet.getFrozen() + delta;
            wallets.updateFrozenAndBalance(userId, bidderWallet.getBalance(), newFrozen, now);
            wallets.upsertHold(userId, auctionId, amount, now);
            if (delta != 0) {
                wallets.insertLedger(userId, auctionId, requestId, "FREEZE", delta,
                        bidderWallet.getBalance(), newFrozen,
                        "bid " + amount + " on auction " + auctionId, now);
            }

            // 12-14. 更新最高价/领先者、写出价、写事件
            Long newEndTime = endTime;
            int extendCount = a.getExtendCount();
            boolean extended = false;
            long firstSeq;
            long lastSeq;

            // 先计算延时（同事务内，以最新截止时间为基准）
            long remain = endTime - receivedAt;
            if (remain <= EXTEND_WINDOW_MS && extendCount < a.getMaxExtends()) {
                newEndTime = endTime + EXTEND_MS;
                extendCount++;
                extended = true;
            }

            auctions.updateRunning(auctionId, amount, userId, newEndTime, extendCount, now);
            final long fEndTime = newEndTime;
            final int fExtendCount = extendCount;
            final long fFromTime = endTime;
            firstSeq = events.append(auctionId, "BID_ACCEPTED", n -> {
                n.set("bidderId", userId);
                n.set("amount", amount);
                n.set("currentPrice", amount);
                n.set("leaderId", userId);
                n.set("endTime", fEndTime);
            });
            // Constraint failure exits @Tran and rolls back ALL preceding writes.
            bids.insert(auctionId, userId, amount, requestId, firstSeq, now);
            long bidId = bids.lastInsertId();
            lastSeq = firstSeq;

            // 15. 延时事件（与出价同一事务；失败整体回滚）
            if (extended) {
                lastSeq = events.append(auctionId, "AUCTION_EXTENDED", n -> {
                    n.set("fromTime", fFromTime);
                    n.set("toTime", fEndTime);
                    n.set("extendCount", fExtendCount);
                    n.set("reason", "bid in last 5s");
                });
            }

            // 16. @Tran 原子提交
            return new BidOutcome(false, bidId, firstSeq, lastSeq, amount, newEndTime, extended,
                    extendCount, userId, minPrice);
        } catch (SQLException e) {
            throw new RuntimeException(e);
        }
    }

    private void validateInput(long auctionId, long userId, String requestId, long amount) {
        if (requestId == null || requestId.isBlank() || requestId.length() > 64) {
            throw new BusinessException(ErrorCode.VALIDATION, "requestId 必填且长度 1~64");
        }
        if (amount <= 0) {
            throw new BusinessException(ErrorCode.VALIDATION, "amount 必须为正整数");
        }
    }
}
