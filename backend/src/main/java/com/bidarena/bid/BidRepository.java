package com.bidarena.bid;

import org.noear.solon.annotation.Component;
import org.noear.solon.annotation.Inject;
import org.noear.solon.data.sql.SqlUtils;

import java.sql.SQLException;
import java.util.List;

@Component
public class BidRepository {
    @Inject
    SqlUtils sql;

    public long lastInsertId() throws SQLException {
        Number id = sql.sql("SELECT LAST_INSERT_ID()").queryValue();
        return id == null ? 0L : id.longValue();
    }

    public static class BidRow {
        private long id;
        private long auctionId;
        private long userId;
        private long amount;
        private String requestId;
        private long seq;
        private long createdAt;

        public long getId() {
            return id;
        }

        public void setId(long id) {
            this.id = id;
        }

        public long getAuctionId() {
            return auctionId;
        }

        public void setAuctionId(long auctionId) {
            this.auctionId = auctionId;
        }

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

        public String getRequestId() {
            return requestId;
        }

        public void setRequestId(String requestId) {
            this.requestId = requestId;
        }

        public long getSeq() {
            return seq;
        }

        public void setSeq(long seq) {
            this.seq = seq;
        }

        public long getCreatedAt() {
            return createdAt;
        }

        public void setCreatedAt(long createdAt) {
            this.createdAt = createdAt;
        }
    }

    /** 幂等检查（事务内 FOR UPDATE：并发同 requestId 在此处串行化） */
    public BidRow findByRequest(long userId, String requestId) throws SQLException {
        return sql.sql("""
                        SELECT id, auction_id, user_id, amount, request_id, seq, created_at
                        FROM bids WHERE user_id = ? AND request_id = ? FOR UPDATE
                        """, userId, requestId).queryRow(BidRow.class);
    }

    public void insert(long auctionId, long userId, long amount, String requestId, long seq, long now)
            throws SQLException {
        sql.sql("""
                        INSERT INTO bids(auction_id, user_id, amount, request_id, seq, created_at)
                        VALUES (?, ?, ?, ?, ?, ?)
                        """, auctionId, userId, amount, requestId, seq, now).update();
    }

    public List<BidRow> listByAuction(long auctionId, int limit) throws SQLException {
        List<BidRow> rows = sql.sql("""
                        SELECT b.id, b.auction_id, b.user_id, b.amount, b.request_id, b.seq, b.created_at
                        FROM bids b WHERE b.auction_id = ? ORDER BY b.seq DESC LIMIT ?
                        """, auctionId, limit).queryRowList(BidRow.class);
        return rows == null ? List.of() : rows;
    }
}
