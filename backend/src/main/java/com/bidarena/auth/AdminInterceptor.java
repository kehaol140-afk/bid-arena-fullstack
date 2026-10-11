package com.bidarena.auth;

import com.bidarena.common.BusinessException;
import com.bidarena.common.ErrorCode;
import org.noear.solon.annotation.Component;
import org.noear.solon.core.handle.Context;
import org.noear.solon.core.handle.Handler;
import org.noear.solon.core.route.PathRule;
import org.noear.solon.core.route.RouterInterceptor;
import org.noear.solon.core.route.RouterInterceptorChain;

/**
 * 管理员权限拦截：/api/v1/admin/** 仅 ADMIN 角色可访问。
 */
@Component(index = -80)
public class AdminInterceptor implements RouterInterceptor {
    @Override
    public PathRule pathPatterns() {
        return new PathRule().include("/api/v1/admin/**");
    }

    @Override
    public void doIntercept(Context ctx, Handler mainHandler, RouterInterceptorChain chain) throws Throwable {
        if (!"ADMIN".equals(AuthInterceptor.currentRole(ctx))) {
            throw new BusinessException(ErrorCode.FORBIDDEN, "需要管理员权限");
        }
        chain.doIntercept(ctx, mainHandler);
    }
}
