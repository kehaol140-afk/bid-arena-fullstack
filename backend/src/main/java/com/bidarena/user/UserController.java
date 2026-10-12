package com.bidarena.user;

import com.bidarena.auth.AuthInterceptor;
import com.bidarena.common.ApiResult;
import com.bidarena.common.BusinessException;
import com.bidarena.common.ErrorCode;
import org.noear.solon.annotation.Controller;
import org.noear.solon.annotation.Get;
import org.noear.solon.annotation.Inject;
import org.noear.solon.annotation.Mapping;
import org.noear.solon.core.handle.Context;

import java.sql.SQLException;

@Controller
@Mapping("/api/v1/users")
public class UserController {
    @Inject
    UserRepository users;

    @Get
    @Mapping("/me")
    public ApiResult<UserVO> me(Context ctx) {
        try {
            UserRepository.UserRow u = users.findById(AuthInterceptor.currentUserId(ctx));
            if (u == null) {
                throw new BusinessException(ErrorCode.NOT_FOUND);
            }
            return ApiResult.ok(new UserVO(u.getId(), u.getEmail(), u.getDisplayName(), u.getRole()));
        } catch (SQLException e) {
            throw new RuntimeException(e);
        }
    }
}
