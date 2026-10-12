package com.bidarena.common;

import org.noear.solon.annotation.Component;
import org.noear.solon.core.handle.Context;
import org.noear.solon.core.handle.Handler;
import org.noear.solon.core.route.PathRule;
import org.noear.solon.core.route.RouterInterceptor;
import org.noear.solon.core.route.RouterInterceptorChain;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * 全局异常拦截 + 统一 JSON 错误响应。
 * 业务异常按 ErrorCode.httpStatus 返回；未知异常统一 500 且不泄漏内部细节。
 */
@Component(index = -100)
public class GlobalExceptionInterceptor implements RouterInterceptor {
    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionInterceptor.class);

    @Override
    public PathRule pathPatterns() {
        return new PathRule().include("/api/**");
    }

    @Override
    public void doIntercept(Context ctx, Handler mainHandler, RouterInterceptorChain chain) throws Throwable {
        try {
            chain.doIntercept(ctx, mainHandler);
        } catch (BusinessException e) {
            ctx.status(e.getErrorCode().getHttpStatus());
            ctx.render(ApiResult.error(e.getErrorCode(), e.getDetail()));
        } catch (org.noear.solon.core.exception.StatusException e) {
            if(e.getCode()==400) {
                ctx.status(400);
                ctx.render(ApiResult.error(ErrorCode.VALIDATION, "请求参数或 JSON 格式不合法"));
            } else {
                ctx.status(e.getCode());
                ctx.render(ApiResult.error(ErrorCode.INTERNAL, null));
            }
        } catch (IllegalArgumentException e) {
            ctx.status(400);
            ctx.render(ApiResult.error(ErrorCode.VALIDATION, e.getMessage()));
        } catch (Throwable e) {
            log.error("unhandled error on {} {}", ctx.method(), ctx.path(), e);
            ctx.status(500);
            ctx.render(ApiResult.error(ErrorCode.INTERNAL, null));
        }
    }
}
