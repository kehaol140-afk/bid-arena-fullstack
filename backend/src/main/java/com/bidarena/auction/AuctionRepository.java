package com.bidarena.auction;

import org.noear.solon.annotation.Component;
import org.noear.solon.annotation.Inject;
import org.noear.solon.data.sql.SqlUtils;

import java.sql.SQLException;
import java.util.List;

@Component
public class AuctionRepository {
    private static final String COLS = """
            id, title, description, status, start_price, min_increment, current_price, current_leader_id,
            duration_seconds, started_at, end_time, extend_count, max_extends, seq, settle_reason,
            created_by, created_at, updated_at
            """;

    @Inject
    SqlUtils sql;

    /** SELECT FOR UPDATE：仅事务内使用（出价/结算/取消的第一把锁） */
    public Auction lockById(long id) throws SQLException {
        return sql.sql("SELECT " + COLS + " FROM auctions WHERE id = ? FOR UPDATE", id)
                .queryRow(Auction.class);
    }

    public Auction findById(long id) throws SQLException {
        return sql.sql("SELECT " + COLS + " FROM auctions WHERE id = ?", id)
                .queryRow(Auction.class);
    }

    public List<Auction> listAll() throws SQLException {
        return sql.sql("SELECT " + COLS + " FROM auctions ORDER BY id DESC").queryRowList(Auction.class);
    }

    /** 到期待结算的拍卖（RUNNING 且到期，或滞留 SETTLING——重启恢复用） */
    public List<Long> findDueIds(long nowEpochMs) throws SQLException {
        List<Number> ids = sql.sql("""
                        SELECT id FROM auctions
                        WHERE (status = 'RUNNING' AND end_time <= ?) OR status = 'SETTLING'
                        ORDER BY id ASC
                        """, nowEpochMs).queryValueList();
        List<Long> out = new java.util.ArrayList<>(ids.size());
        for (Number n : ids) {
            out.add(n.longValue());
        }
        return out;
    }

    public long insert(String title, String description, long startPrice, long minIncrement,
                       int durationSeconds, long createdBy, long now) throws SQLException {
        Number id = sql.sql("""
                        INSERT INTO auctions(title, description, status, start_price, min_increment, current_price,
                                             duration_seconds, created_by, created_at, updated_at)
                        VALUES (?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?)
                        """, title, description, startPrice, minIncrement, startPrice, durationSeconds, createdBy, now, now)
                .updateReturnKey();
        return id == null ? 0L : id.longValue();
    }

    /**
     * 原子状态迁移：仅当当前状态等于期望值时更新（受影响行数=1 表示迁移成功并抢占到该拍卖的结算权）。
     */
    public int casStatus(long id, String expect, String target, long now) throws SQLException {
        return sql.sql("UPDATE auctions SET status = ?, updated_at = ? WHERE id = ? AND status = ?",
                target, now, id, expect).update();
    }

    public int updateRunning(long id, long currentPrice, Long leaderId, Long endTime, Integer extendCount, long now)
            throws SQLException {
        return sql.sql("""
                        UPDATE auctions SET current_price = ?, current_leader_id = ?, end_time = ?, extend_count = ?,
                                           updated_at = ?
                        WHERE id = ?
                        """, currentPrice, leaderId, endTime, extendCount, now, id).update();
    }

    public int markFinished(long id, String reason, long now) throws SQLException {
        return sql.sql("UPDATE auctions SET status = 'FINISHED', settle_reason = ?, updated_at = ? WHERE id = ?", reason, now, id).update();
    }

    /** 事务内递增事件序号（调用方必须已持有该拍卖行锁） */
    public long nextSeq(long auctionId, long now) throws SQLException {
        sql.sql("UPDATE auctions SET seq = seq + 1, updated_at = ? WHERE id = ?", now, auctionId).update();
        Number seq = sql.sql("SELECT seq FROM auctions WHERE id = ?", auctionId).queryValue();
        return seq == null ? 0L : seq.longValue();
    }

    public void insertParticipant(long auctionId, long userId, String type, long now) throws SQLException {
        sql.sql("""
                        INSERT INTO auction_participants(auction_id, user_id, participant_type, joined_at)
                        VALUES (?, ?, ?, ?)
                        """, auctionId, userId, type, now).update();
    }

    public static class ParticipantRow {
        private long userId;
        private String displayName;
        private String participantType;
        private long joinedAt;

        public long getUserId() {
            return userId;
        }

        public void setUserId(long userId) {
            this.userId = userId;
        }

        public String getDisplayName() {
            return displayName;
        }

        public void setDisplayName(String displayName) {
            this.displayName = displayName;
        }

        public String getParticipantType() {
            return participantType;
        }

        public void setParticipantType(String participantType) {
            this.participantType = participantType;
        }

        public long getJoinedAt() {
            return joinedAt;
        }

        public void setJoinedAt(long joinedAt) {
            this.joinedAt = joinedAt;
        }
    }

    public List<ParticipantRow> listParticipants(long auctionId) throws SQLException {
        return sql.sql("""
                        SELECT p.user_id AS user_id, u.display_name AS display_name,
                               p.participant_type AS participant_type, p.joined_at AS joined_at
                        FROM auction_participants p JOIN users u ON u.id = p.user_id
                        WHERE p.auction_id = ? ORDER BY p.joined_at ASC, p.user_id ASC
                        """, auctionId).queryRowList(ParticipantRow.class);
    }
}
