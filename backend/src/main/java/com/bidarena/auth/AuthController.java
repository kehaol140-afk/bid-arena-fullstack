package com.bidarena.auth;

import com.bidarena.auth.dto.LoginRequest;
import com.bidarena.auth.dto.LoginResponse;
import com.bidarena.common.ApiResult;
import org.noear.solon.annotation.Controller;
import org.noear.solon.annotation.Inject;
import org.noear.solon.annotation.Mapping;
import org.noear.solon.annotation.Post;
import org.noear.solon.core.handle.Context;

@Controller
@Mapping("/api/v1/auth")
public class AuthController {
    @Inject
    AuthService auth;

    @Post
    @Mapping("/login")
    public ApiResult<LoginResponse> login(LoginRequest req) {
        return ApiResult.ok(auth.login(req));
    }

    @Post
    @Mapping("/logout")
    public ApiResult<Void> logout(Context ctx) {
        auth.logout(bearerToken(ctx));
        return ApiResult.ok();
    }

    public static String bearerToken(Context ctx) {
        String h = ctx.header("Authorization");
        if (h != null && h.startsWith("Bearer ")) {
            return h.substring(7).trim();
        }
        return null;
    }
}
