package com.bidarena.agent;

import com.bidarena.agent.dto.AgentTokenCreateRequest;
import com.bidarena.common.ApiResult;
import com.bidarena.common.BusinessException;
import com.bidarena.common.ErrorCode;
import org.noear.solon.annotation.Controller;
import org.noear.solon.annotation.Get;
import org.noear.solon.annotation.Inject;
import org.noear.solon.annotation.Mapping;
import org.noear.solon.annotation.Post;

import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * 管理员签发/撤销 Agent Token。
 * 明文 token 只在创建响应中出现一次；列表接口只返回摘要前缀。
 */
@io.swagger.annotations.Api(tags = "AdminAgentTokenController")
@Controller
@Mapping("/api/v1/admin/agent-tokens")
public class AdminAgentTokenController {
    @Inject
    AgentTokenService tokens;
    @Inject
    AgentTokenRepository repo;

    @io.swagger.annotations.ApiOperation(value = "Write AdminAgentTokenController")
    @Post
    @Mapping
    public ApiResult<Map<String, Object>> create(@org.noear.solon.annotation.Body AgentTokenCreateRequest req) {
        if (req.getUserId() == null || req.getAuctionId() == null) {
            throw new BusinessException(ErrorCode.VALIDATION, "userId 与 auctionId 必填");
        }
        if (req.getExpiresInSeconds() != null && (req.getExpiresInSeconds() <= 0 || req.getExpiresInSeconds() > 86400L)) {
            throw new BusinessException(ErrorCode.VALIDATION, "expiresInSeconds 为 1~86400");
        }
        long expiresAt = System.currentTimeMillis()
                + (req.getExpiresInSeconds() == null ? 3600L : req.getExpiresInSeconds()) * 1000L;
        int rateLimit = req.getRateLimitPerMin() == null ? 30 : req.getRateLimitPerMin();
        AgentTokenService.Issued issued = tokens.issue(req.getUserId(), req.getAuctionId(),
                req.getScopes(), expiresAt, rateLimit);
        return ApiResult.ok(Map.of(
                "tokenId", issued.tokenId(),
                "token", issued.plainToken(), // 明文仅此一次
                "userId", issued.userId(),
                "auctionId", issued.auctionId(),
                "scopes", issued.scopes(),
                "expiresAt", issued.expiresAt(),
                "rateLimitPerMin", issued.rateLimitPerMin()));
    }

    @io.swagger.annotations.ApiOperation(value = "Read AdminAgentTokenController")
    @Get
    @Mapping
    public ApiResult<List<Map<String, Object>>> list(Long userId) throws SQLException {
        List<AgentTokenRepository.AgentTokenRow> rows =
                repo.listByUser(userId == null ? 0L : userId);
        List<Map<String, Object>> out = new ArrayList<>();
        for (var r : rows) {
            out.add(Map.of(
                    "tokenId", r.getId(),
                    "tokenPrefix", r.getTokenPrefix() + "...",
                    "userId", r.getUserId(),
                    "auctionId", r.getAuctionId(),
                    "scopes", r.getScopes(),
                    "expiresAt", r.getExpiresAt(),
                    "revoked", r.isRevoked(),
                    "rateLimitPerMin", r.getRateLimitPerMin()));
        }
        return ApiResult.ok(out);
    }

    @io.swagger.annotations.ApiOperation(value = "Write AdminAgentTokenController")
    @Post
    @Mapping("/{id}/revoke")
    public ApiResult<Void> revoke(long id) {
        tokens.revoke(id);
        return ApiResult.ok();
    }
}
