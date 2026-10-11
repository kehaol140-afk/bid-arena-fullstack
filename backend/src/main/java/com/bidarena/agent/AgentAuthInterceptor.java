package com.bidarena.agent;

import com.bidarena.auth.AuthController;
import com.bidarena.auth.SessionRepository;
import com.bidarena.common.BusinessException;
import com.bidarena.common.ErrorCode;
import org.noear.solon.annotation.Component;
import org.noear.solon.annotation.Inject;
import org.noear.solon.core.handle.Context;
import org.noear.solon.core.handle.Handler;
import org.noear.solon.core.route.PathRule;
import org.noear.solon.core.route.RouterInterceptor;
import org.noear.solon.core.route.RouterInterceptorChain;

import java.sql.SQLException;

/**
 * Agent 独立认证（最小权限边界）：
 * - Bearer <agent token> → sha256 查库
 * - 校验：存在 / 未吊销 / 未过期
 * - 固定窗口频率限制（每分钟请求数）
 * - auctionId 范围与 scope 校验由 AgentController 按目标资源再校验
 */
@Component(index = -70)
public class AgentAuthInterceptor implements RouterInterceptor {
    static final long WINDOW_MS = 60_000L;

    @Inject
    AgentTokenRepository repo;

    @Override
    public PathRule pathPatterns() {
        return new PathRule().include("/api/v1/agent/**");
    }

    @Override
    public void doIntercept(Context ctx, Handler mainHandler, RouterInterceptorChain chain) throws Throwable {
        String token = AuthController.bearerToken(ctx);
        if (token == null) {
            throw new BusinessException(ErrorCode.AGENT_TOKEN_INVALID, "缺少 Bearer Token");
        }
        AgentTokenRepository.AgentTokenRow row;
        try {
            row = repo.findByHash(SessionRepository.sha256(token));
        } catch (SQLException e) {
            throw new RuntimeException(e);
        }
        if (row == null || row.isRevoked() || row.getExpiresAt() <= System.currentTimeMillis()) {
            throw new BusinessException(ErrorCode.AGENT_TOKEN_INVALID);
        }
        int count;
        try {
            count = repo.countRequest(row.getId(), WINDOW_MS, System.currentTimeMillis());
        } catch (SQLException e) {
            throw new RuntimeException(e);
        }
        if (count > row.getRateLimitPerMin()) {
            throw new BusinessException(ErrorCode.AGENT_RATE_LIMITED,
                    "limit " + row.getRateLimitPerMin() + "/min");
        }
        ctx.attrSet("agentToken", row);
        ctx.attrSet("agentUserId", row.getUserId());
        chain.doIntercept(ctx, mainHandler);
    }

    public static AgentTokenRepository.AgentTokenRow currentToken(Context ctx) {
        return ctx.attr("agentToken");
    }

    /** 范围 + 权限断言（在控制器按目标 auctionId 调用） */
    public static void assertScope(Context ctx, long auctionId, String scope) {
        AgentTokenRepository.AgentTokenRow t = currentToken(ctx);
        if (t == null) {
            throw new BusinessException(ErrorCode.AGENT_TOKEN_INVALID);
        }
        if (t.getAuctionId() != auctionId) {
            throw new BusinessException(ErrorCode.AGENT_SCOPE_DENIED,
                    "token 仅限 auction " + t.getAuctionId());
        }
        if (!t.hasScope(scope)) {
            throw new BusinessException(ErrorCode.AGENT_PERMISSION_DENIED, "缺少 " + scope);
        }
    }
}
