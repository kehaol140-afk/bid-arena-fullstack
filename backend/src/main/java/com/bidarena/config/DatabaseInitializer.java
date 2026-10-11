package com.bidarena.config;

import at.favre.lib.crypto.bcrypt.BCrypt;
import org.flywaydb.core.Flyway;
import org.noear.solon.Solon;
import org.noear.solon.data.sql.SqlUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.sql.DataSource;
import java.sql.SQLException;

/**
 * 启动初始化（纯静态工具，非容器组件）：
 * 1. Flyway 自动迁移（V1__init_schema.sql ...）
 * 2. 幂等种子：管理员 + 真人A/B + 20 个模拟账号 + 钱包 + 一个 DRAFT 演示拍品
 *    - 以 users.email 唯一键做存在性判断，重复启动不重复创建、不重置已有钱包、不复制拍品。
 */
public final class DatabaseInitializer {
    private static final Logger log = LoggerFactory.getLogger(DatabaseInitializer.class);
    static final long INITIAL_BALANCE = 1000L;

    public static synchronized void run() {
        DataSource ds = Solon.context().getBean(DataSource.class);
        if (ds == null) {
            throw new IllegalStateException("DataSource not ready");
        }
        Flyway flyway = Flyway.configure()
                .dataSource(ds)
                .locations("classpath:db/migration")
                .load();
        flyway.migrate();
        log.info("flyway migrate done");

        SqlUtils sql = SqlUtils.of(ds);
        try {
            seed(sql);
        } catch (SQLException e) {
            throw new RuntimeException("seed failed", e);
        }
        log.info("seed done (idempotent)");
    }

    static void seed(SqlUtils sql) throws SQLException {
        long now = System.currentTimeMillis();
        String adminHash = BCrypt.withDefaults().hashToString(10, "Admin123456!".toCharArray());
        String userHash = BCrypt.withDefaults().hashToString(10, "Test123456!".toCharArray());

        // 管理员与真人账号（钱包默认 1000，管理员不参与竞拍也给 1000 以便演示统一）
        long adminId = ensureUser(sql, "admin@example.com", adminHash, "管理员", "ADMIN", now);
        long bidderA = ensureUser(sql, "bidder_a@example.com", userHash, "竞拍者A", "USER", now);
        long bidderB = ensureUser(sql, "bidder_b@example.com", userHash, "竞拍者B", "USER", now);

        // 20 个模拟竞拍账号 bot_01 .. bot_20（与 simulator 脚本约定一致）
        for (int i = 1; i <= 20; i++) {
            ensureUser(sql, String.format("bot_%02d@example.com", i), userHash, "模拟用户" + i, "USER", now);
        }

        // 幂等：只在没有任何 DRAFT 演示拍品时创建一个（title 固定，存在即跳过）
        Number draftCount = sql.sql("SELECT COUNT(*) FROM auctions WHERE title = ?", "演示拍品·经典机械腕表（DRAFT）")
                .queryValue();
        if (draftCount == null || draftCount.longValue() == 0) {
            sql.sql("""
                            INSERT INTO auctions(title, description, status, start_price, min_increment, current_price,
                                                 duration_seconds, created_by, created_at, updated_at)
                            VALUES (?, ?, 'DRAFT', 100, 10, 100, 180, ?, ?, ?)
                            """,
                    "演示拍品·经典机械腕表（DRAFT）",
                    "服务启动时自动创建的演示拍品，处于 DRAFT 状态，需管理员手动启动倒计时。",
                    adminId, now, now).update();
            log.info("created demo DRAFT auction");
        }
    }

    /** 创建用户+钱包（存在则原样返回，不重置钱包） */
    static long ensureUser(SqlUtils sql, String email, String passwordHash, String displayName, String role, long now)
            throws SQLException {
        Number existing = sql.sql("SELECT id FROM users WHERE email = ?", email).queryValue();
        if (existing != null) {
            return existing.longValue();
        }
        Number id = sql.sql("""
                        INSERT INTO users(email, password_hash, display_name, role, status, created_at, updated_at)
                        VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?)
                        """,
                email, passwordHash, displayName, role, now, now)
                .updateReturnKey();
        sql.sql("INSERT INTO wallets(user_id, balance, frozen, version, updated_at) VALUES (?, ?, 0, 0, ?)",
                id.longValue(), INITIAL_BALANCE, now).update();
        return id.longValue();
    }

    private DatabaseInitializer() {
    }
}
