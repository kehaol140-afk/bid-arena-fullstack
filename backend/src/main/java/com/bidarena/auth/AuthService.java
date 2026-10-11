package com.bidarena.auth;

import com.bidarena.auth.dto.LoginRequest;
import com.bidarena.auth.dto.LoginResponse;
import com.bidarena.common.BusinessException;
import com.bidarena.common.ErrorCode;
import com.bidarena.user.UserRepository;
import com.bidarena.user.UserVO;
import org.noear.solon.annotation.Component;
import org.noear.solon.annotation.Inject;

import java.sql.SQLException;

@Component
public class AuthService {
    @Inject
    UserRepository users;
    @Inject
    SessionRepository sessions;
    @Inject
    PasswordHasher hasher;

    public LoginResponse login(LoginRequest req) {
        if (req.getEmail() == null || req.getEmail().isBlank() || req.getPassword() == null || req.getPassword().isBlank()) {
            throw new BusinessException(ErrorCode.VALIDATION, "email 与 password 必填");
        }
        try {
            UserRepository.UserRow user = users.findByEmail(req.getEmail().trim().toLowerCase());
            // 统一返回“邮箱或密码错误”，不泄漏账号是否存在
            if (user == null || !"ACTIVE".equals(user.getStatus()) || !hasher.verify(req.getPassword(), user.getPasswordHash())) {
                throw new BusinessException(ErrorCode.UNAUTHORIZED, "邮箱或密码错误");
            }
            SessionRepository.Session session = sessions.create(user.getId());
            return new LoginResponse(session.token(), toVO(user));
        } catch (BusinessException e) {
            throw e;
        } catch (SQLException e) {
            throw new RuntimeException(e);
        }
    }

    public void logout(String token) {
        try {
            sessions.delete(token);
        } catch (SQLException e) {
            throw new RuntimeException(e);
        }
    }

    public UserVO toVO(UserRepository.UserRow u) {
        return new UserVO(u.getId(), u.getEmail(), u.getDisplayName(), u.getRole());
    }
}
