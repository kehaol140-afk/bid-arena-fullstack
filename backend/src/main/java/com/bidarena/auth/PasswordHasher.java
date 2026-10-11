package com.bidarena.auth;

import at.favre.lib.crypto.bcrypt.BCrypt;
import org.noear.solon.annotation.Component;

/**
 * BCrypt 密码哈希（cost=10）。verify 使用常量时间比较（库内实现）。
 */
@Component
public class PasswordHasher {
    public String hash(String rawPassword) {
        return BCrypt.withDefaults().hashToString(10, rawPassword.toCharArray());
    }

    public boolean verify(String rawPassword, String hash) {
        try {
            return BCrypt.verifyer().verify(rawPassword.toCharArray(), hash).verified;
        } catch (Exception e) {
            return false;
        }
    }
}
