package com.bidarena.agent;

import com.bidarena.auth.SessionRepository;
import com.bidarena.common.BusinessException;
import com.bidarena.common.ErrorCode;
import org.noear.solon.annotation.Component;
import org.noear.solon.annotation.Inject;

import java.security.SecureRandom;

/**
 * Agent Token 签发：
 * - 高熵随机（32 字节 SecureRandom，hex 编码 64 字符，前缀 bat_）
 * - 数据库仅存 sha256 摘要；明文只在创建响应中返回一次
 */
@Component
public class AgentTokenService {
    private static final SecureRandom RANDOM = new SecureRandom();

    @Inject
    AgentTokenRepository repo;

    public record Issued(long tokenId, String plainToken, long userId, long auctionId,
                         String scopes, long expiresAt, int rateLimitPerMin) {
    }

    public Issued issue(long userId, long auctionId, String scopes, long expiresAt, int rateLimitPerMin) {
        if (userId <= 0 || auctionId <= 0) {
            throw new BusinessException(ErrorCode.VALIDATION, "userId 与 auctionId 必填");
        }
        if (rateLimitPerMin < 1 || rateLimitPerMin > 10000 || expiresAt <= System.currentTimeMillis()) {
            throw new BusinessException(ErrorCode.VALIDATION, "Token 必须在未来过期，rateLimitPerMin 为 1~10000");
        }
        if (scopes == null || scopes.isBlank()) {
            scopes = "auction:read,auction:bid";
        }
        for (String s : scopes.split(",")) {
            if (!"auction:read".equals(s.trim()) && !"auction:bid".equals(s.trim())) {
                throw new BusinessException(ErrorCode.VALIDATION, "scopes 仅支持 auction:read / auction:bid");
            }
        }
        scopes = java.util.Arrays.stream(scopes.split(",")).map(String::trim).distinct()
                .collect(java.util.stream.Collectors.joining(","));
        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        String plain = "bat_" + SessionRepository.hex(bytes);
        String hash = SessionRepository.sha256(plain);
        try {
            long id = repo.insert(hash, plain.substring(0, 11), userId, auctionId, scopes,
                    expiresAt, rateLimitPerMin, System.currentTimeMillis());
            return new Issued(id, plain, userId, auctionId, scopes, expiresAt, rateLimitPerMin);
        } catch (java.sql.SQLException e) {
            throw new RuntimeException(e);
        }
    }

    public void revoke(long tokenId) {
        try {
            repo.revoke(tokenId, System.currentTimeMillis());
        } catch (java.sql.SQLException e) {
            throw new RuntimeException(e);
        }
    }
}
