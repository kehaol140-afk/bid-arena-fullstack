package com.bidarena.agent;

import org.noear.solon.annotation.Component;
import org.noear.solon.annotation.Inject;
import org.noear.solon.data.sql.SqlUtils;

import java.sql.SQLException;
import java.util.List;

@Component
public class AgentTokenRepository {
    @Inject
    SqlUtils sql;

    public static class AgentTokenRow {
        private long id;
        private String tokenHash;
        private String tokenPrefix;
        private long userId;
        private long auctionId;
        private String scopes;
        private long expiresAt;
        private boolean revoked;
        private int rateLimitPerMin;
        private int requestCount;
        private long windowStartedAt;
        private long createdAt;

        public long getId() {
            return id;
        }

        public void setId(long id) {
            this.id = id;
        }

        public String getTokenHash() {
            return tokenHash;
        }

        public void setTokenHash(String tokenHash) {
            this.tokenHash = tokenHash;
        }

        public String getTokenPrefix() {
            return tokenPrefix;
        }

        public void setTokenPrefix(String tokenPrefix) {
            this.tokenPrefix = tokenPrefix;
        }

        public long getUserId() {
            return userId;
        }

        public void setUserId(long userId) {
            this.userId = userId;
        }

        public long getAuctionId() {
            return auctionId;
        }

        public void setAuctionId(long auctionId) {
            this.auctionId = auctionId;
        }

        public String getScopes() {
            return scopes;
        }

        public void setScopes(String scopes) {
            this.scopes = scopes;
        }

        public long getExpiresAt() {
            return expiresAt;
        }

        public void setExpiresAt(long expiresAt) {
            this.expiresAt = expiresAt;
        }

        public boolean isRevoked() {
            return revoked;
        }

        public void setRevoked(boolean revoked) {
            this.revoked = revoked;
        }

        public int getRateLimitPerMin() {
            return rateLimitPerMin;
        }

        public void setRateLimitPerMin(int rateLimitPerMin) {
            this.rateLimitPerMin = rateLimitPerMin;
        }

        public int getRequestCount() {
            return requestCount;
        }

        public void setRequestCount(int requestCount) {
            this.requestCount = requestCount;
        }

        public long getWindowStartedAt() {
            return windowStartedAt;
        }

        public void setWindowStartedAt(long windowStartedAt) {
            this.windowStartedAt = windowStartedAt;
        }

        public long getCreatedAt() {
            return createdAt;
        }

        public void setCreatedAt(long createdAt) {
            this.createdAt = createdAt;
        }

        public boolean hasScope(String scope) {
            return scopes != null && java.util.Arrays.asList(scopes.split(",")).contains(scope);
        }
    }

    public AgentTokenRow findByHash(String hash) throws SQLException {
        return sql.sql("""
                        SELECT id, token_hash, token_prefix, user_id, auction_id, scopes, expires_at, revoked,
                               rate_limit_per_min, request_count, window_started_at, created_at
                        FROM agent_tokens WHERE token_hash = ?
                        """, hash).queryRow(AgentTokenRow.class);
    }

    public AgentTokenRow findById(long id) throws SQLException {
        return sql.sql("""
                        SELECT id, token_hash, token_prefix, user_id, auction_id, scopes, expires_at, revoked,
                               rate_limit_per_min, request_count, window_started_at, created_at
                        FROM agent_tokens WHERE id = ?
                        """, id).queryRow(AgentTokenRow.class);
    }

    public List<AgentTokenRow> listByUser(long userId) throws SQLException {
        List<AgentTokenRow> rows = sql.sql("""
                        SELECT id, token_hash, token_prefix, user_id, auction_id, scopes, expires_at, revoked,
                               rate_limit_per_min, request_count, window_started_at, created_at
                        FROM agent_tokens WHERE user_id = ? ORDER BY id DESC
                        """, userId).queryRowList(AgentTokenRow.class);
        return rows == null ? List.of() : rows;
    }

    public long insert(String hash, String prefix, long userId, long auctionId, String scopes,
                       long expiresAt, int rateLimitPerMin, long now) throws SQLException {
        Number id = sql.sql("""
                        INSERT INTO agent_tokens(token_hash, token_prefix, user_id, auction_id, scopes,
                                                 expires_at, revoked, rate_limit_per_min, request_count,
                                                 window_started_at, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, 0, ?, 0, 0, ?)
                        """, hash, prefix, userId, auctionId, scopes, expiresAt, rateLimitPerMin, now)
                .updateReturnKey();
        return id == null ? 0L : id.longValue();
    }

    public void revoke(long id, long now) throws SQLException {
        sql.sql("UPDATE agent_tokens SET revoked = 1, window_started_at = window_started_at WHERE id = ?", id).update();
    }

    /** 固定窗口频率计数：窗口过期则重置；返回当前窗口计数（原子自增后） */
    public int countRequest(long tokenId, long windowMs, long now) throws SQLException {
        sql.sql("""
                        UPDATE agent_tokens
                        SET request_count = IF(? >= window_started_at + ?, 1, request_count + 1),
                            window_started_at = IF(? >= window_started_at + ?, ?, window_started_at)
                        WHERE id = ?
                        """, now, windowMs, now, windowMs, now, tokenId).update();
        Integer c = null;
        Number n = sql.sql("SELECT request_count FROM agent_tokens WHERE id = ?", tokenId).queryValue();
        if (n != null) {
            c = n.intValue();
        }
        return c == null ? Integer.MAX_VALUE : c;
    }
}
