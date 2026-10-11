package com.bidarena.config;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import org.noear.solon.annotation.Bean;
import org.noear.solon.annotation.Configuration;
import org.noear.solon.data.sql.SqlUtils;

import javax.sql.DataSource;
import java.util.Map;

/**
 * 数据源与 SqlUtils 配置。
 *
 * 说明：
 * - 通过环境变量注入连接信息，默认指向本机 MySQL 的 bid_arena 库（开发/测试）。
 * - SqlUtils.of(ds) 持有同一 DataSource 实例，@Tran 事务内所有 SQL 自动走同一连接（见 DESIGN.md）。
 */
@Configuration
public class DbConfig {

    private static String env(String key, String def) {
        String v = System.getenv(key);
        return (v == null || v.isBlank()) ? def : v;
    }

    @Bean(name = "db", typed = true)
    public DataSource dataSource() {
        HikariConfig cfg = new HikariConfig();
        cfg.setJdbcUrl(env("BID_DB_URL", "jdbc:mysql://localhost:3306/bid_arena?useSSL=false&allowPublicKeyRetrieval=true&serverTimezone=UTC"));
        cfg.setUsername(env("BID_DB_USER", "root"));
        cfg.setPassword(env("BID_DB_PASSWORD", "123456"));
        cfg.setMaximumPoolSize(Integer.parseInt(env("BID_DB_POOL_MAX", "20")));
        cfg.setMinimumIdle(2);
        cfg.setPoolName("bid-arena-pool");
        cfg.addDataSourceProperty("cachePrepStmts", "true");
        HikariDataSource ds = new HikariDataSource(cfg);
        AppShutdownHook.register(ds);
        return ds;
    }

    @Bean
    public SqlUtils sqlUtils(DataSource db) {
        return SqlUtils.of(db);
    }

    static Map<String, String> connectionInfoForLog() {
        return Map.of(
                "url", env("BID_DB_URL", "jdbc:mysql://localhost:3306/bid_arena"),
                "user", env("BID_DB_USER", "root"));
    }

    private static class AppShutdownHook {
        static void register(HikariDataSource ds) {
            Runtime.getRuntime().addShutdownHook(new Thread(ds::close, "hikari-shutdown"));
        }
    }
}
