package com.bidarena.wallet;

import org.noear.solon.annotation.Component;
import org.noear.solon.annotation.Inject;
import org.noear.solon.data.sql.SqlUtils;

import java.sql.SQLException;

/**
 * 钱包/持仓/流水仓储。锁操作仅供事务内调用（BidService / SettlementService / AuctionService.cancel）。
 */
@Component
public class WalletRepository {
    @Inject
    SqlUtils sql;

    /** SELECT ... FOR UPDATE：必须处于活动事务中 */
    public Wallet lockByUserId(long userId) throws SQLException {
        return sql.sql("SELECT user_id, balance, frozen, version, updated_at FROM wallets WHERE user_id = ? FOR UPDATE", userId)
                .queryRow(Wallet.class);
    }

    public Wallet findByUserId(long userId) throws SQLException {
        return sql.sql("SELECT user_id, balance, frozen, version, updated_at FROM wallets WHERE user_id = ?", userId)
                .queryRow(Wallet.class);
    }

    public java.util.Map<Long, Wallet> lockUsers(long bidderId, Long oldLeaderId) throws SQLException {
        java.util.SortedSet<Long> ids = new java.util.TreeSet<>();
        ids.add(bidderId);
        if (oldLeaderId != null) ids.add(oldLeaderId);
        java.util.Map<Long, Wallet> out = new java.util.LinkedHashMap<>();
        for (long id : ids) out.put(id, lockByUserId(id));
        return out;
    }

    public int updateFrozenAndBalance(long userId, long balance, long frozen, long now) throws SQLException {
        return sql.sql("""
                        UPDATE wallets SET balance = ?, frozen = ?, version = version + 1, updated_at = ?
                        WHERE user_id = ? AND balance >= 0 AND frozen >= 0 AND frozen <= balance
                        """, balance, frozen, now, userId).update();
    }

    /** 读取用户在某场的持仓（事务外可调用） */
    public long findHoldAmount(long userId, long auctionId) throws SQLException {
        Number v = sql.sql("SELECT amount FROM wallet_holds WHERE user_id = ? AND auction_id = ?", userId, auctionId)
                .queryValue();
        return v == null ? 0L : v.longValue();
    }

    /** Caller owns the auction lock; read stable holds and acquire wallets before hold writes. */
    public java.util.List<HoldRow> lockHoldsByAuction(long auctionId) throws SQLException {
        java.util.List<HoldRow> rows = sql.sql("""
                        SELECT h.user_id AS user_id, h.amount AS amount
                        FROM wallet_holds h WHERE h.auction_id = ? AND h.amount > 0
                        ORDER BY h.user_id ASC
                        """, auctionId).queryRowList(HoldRow.class);
        return rows == null ? java.util.List.of() : rows;
    }

    public void upsertHold(long userId, long auctionId, long amount, long now) throws SQLException {
        sql.sql("""
                        INSERT INTO wallet_holds(user_id, auction_id, amount, updated_at) VALUES (?, ?, ?, ?)
                        ON DUPLICATE KEY UPDATE amount = VALUES(amount), updated_at = VALUES(updated_at)
                        """, userId, auctionId, amount, now).update();
    }

    public void insertLedger(long userId, Long auctionId, String requestId, String type, long amount,
                             long balanceAfter, long frozenAfter, String remark, long now) throws SQLException {
        sql.sql("""
                        INSERT INTO wallet_ledger(user_id, auction_id, request_id, type, amount, balance_after, frozen_after, remark, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """, userId, auctionId, requestId, type, amount, balanceAfter, frozenAfter, remark, now).update();
    }

    public static class HoldRow {
        private long userId;
        private long amount;

        public long getUserId() {
            return userId;
        }

        public void setUserId(long userId) {
            this.userId = userId;
        }

        public long getAmount() {
            return amount;
        }

        public void setAmount(long amount) {
            this.amount = amount;
        }
    }
}
