package com.bidarena.auth;

import com.bidarena.common.BusinessException;
import com.bidarena.common.ErrorCode;
import com.bidarena.user.UserRepository;
import org.noear.solon.annotation.Component;
import org.noear.solon.annotation.Inject;
import org.noear.solon.core.handle.Context;
import org.noear.solon.core.handle.Handler;
import org.noear.solon.core.route.PathRule;
import org.noear.solon.core.route.RouterInterceptor;
import org.noear.solon.core.route.RouterInterceptorChain;

import java.sql.SQLException;

/**
 * 认证拦截器：/api/** 需要有效会话（白名单除外）。
 * 解析后把 userId / role 放入 ctx attr，供控制器与后续拦截器使用。
 */
@Component(index = -90)
public class AuthInterceptor implements RouterInterceptor {
    @Inject
    SessionRepository sessions;
    @Inject
    UserRepository users;

    @Override
    public PathRule pathPatterns() {
        return new PathRule()
                .include("/api/**")
                .exclude("/api/v1/auth/login")
                .exclude("/api/v1/health")
                .exclude("/api/v1/agent/**"); // Agent 使用独立认证（AgentAuthInterceptor）
    }

    @Override
    public void doIntercept(Context ctx, Handler mainHandler, RouterInterceptorChain chain) throws Throwable {
        String token = AuthController.bearerToken(ctx);
        Long userId;
        try {
            userId = sessions.findValidUserId(token);
        } catch (SQLException e) {
            throw new RuntimeException(e);
        }
        if (userId == null) {
            throw new BusinessException(ErrorCode.UNAUTHORIZED);
        }
        UserRepository.UserRow user = users.findById(userId);
        if (user == null || !"ACTIVE".equals(user.getStatus())) {
            throw new BusinessException(ErrorCode.UNAUTHORIZED);
        }
        ctx.attrSet("userId", userId);
        ctx.attrSet("role", user.getRole());
        chain.doIntercept(ctx, mainHandler);
    }

    public static long currentUserId(Context ctx) {
        Long id = ctx.attr("userId");
        if (id == null) {
            throw new BusinessException(ErrorCode.UNAUTHORIZED);
        }
        return id;
    }

    public static String currentRole(Context ctx) {
        return ctx.attr("role");
    }
}
