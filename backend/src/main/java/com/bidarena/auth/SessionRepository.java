package com.bidarena.auth;

import org.noear.solon.annotation.Component;
import org.noear.solon.annotation.Inject;
import org.noear.solon.data.sql.SqlUtils;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.sql.SQLException;

/**
 * 会话存储：token 明文仅返回给客户端，库中只保存 sha256(token)。
 */
@Component
public class SessionRepository {
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final long TTL_MILLIS = 24L * 3600 * 1000;

    @Inject
    SqlUtils sql;

    public record Session(String token, long userId, String role, long expiresAt) {
    }

    public Session create(long userId) throws SQLException {
        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        String token = hex(bytes);
        long now = System.currentTimeMillis();
        long expiresAt = now + TTL_MILLIS;
        sql.sql("INSERT INTO sessions(token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
                sha256(token), userId, expiresAt, now).update();
        return new Session(token, userId, null, expiresAt);
    }

    /** 校验并返回 userId；无效/过期返回 null */
    public Long findValidUserId(String token) throws SQLException {
        if (token == null || token.isBlank()) {
            return null;
        }
        Number userId = sql.sql("SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > ?",
                sha256(token), System.currentTimeMillis()).queryValue();
        return userId == null ? null : userId.longValue();
    }

    public void delete(String token) throws SQLException {
        if (token != null && !token.isBlank()) {
            sql.sql("DELETE FROM sessions WHERE token_hash = ?", sha256(token)).update();
        }
    }

    public static String sha256(String input) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            return hex(md.digest(input.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    public static String hex(byte[] bytes) {
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) {
            sb.append(Character.forDigit((b >> 4) & 0xF, 16)).append(Character.forDigit(b & 0xF, 16));
        }
        return sb.toString();
    }
}
