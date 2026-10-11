package com.bidarena.user;

import org.noear.solon.annotation.Component;
import org.noear.solon.annotation.Inject;
import org.noear.solon.data.sql.SqlUtils;

import java.sql.SQLException;

@Component
public class UserRepository {
    @Inject
    SqlUtils sql;

    public static class UserRow {
        private long id;
        private String email;
        private String passwordHash;
        private String displayName;
        private String role;
        private String status;

        public long getId() {
            return id;
        }

        public void setId(long id) {
            this.id = id;
        }

        public String getEmail() {
            return email;
        }

        public void setEmail(String email) {
            this.email = email;
        }

        public String getPasswordHash() {
            return passwordHash;
        }

        public void setPasswordHash(String passwordHash) {
            this.passwordHash = passwordHash;
        }

        public String getDisplayName() {
            return displayName;
        }

        public void setDisplayName(String displayName) {
            this.displayName = displayName;
        }

        public String getRole() {
            return role;
        }

        public void setRole(String role) {
            this.role = role;
        }

        public String getStatus() {
            return status;
        }

        public void setStatus(String status) {
            this.status = status;
        }
    }

    public UserRow findByEmail(String email) throws SQLException {
        return sql.sql("SELECT id, email, password_hash, display_name, role, status FROM users WHERE email = ?", email)
                .queryRow(UserRow.class);
    }

    public UserRow findById(long id) throws SQLException {
        return sql.sql("SELECT id, email, password_hash, display_name, role, status FROM users WHERE id = ?", id)
                .queryRow(UserRow.class);
    }
}
