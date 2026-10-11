package com.bidarena.it;

import com.bidarena.config.DatabaseInitializer;
import org.junit.jupiter.api.BeforeEach;
import org.noear.solon.test.SolonTest;

/**
 * 集成测试基类：真实 MySQL（bid_arena_test），Flyway 迁移 + 幂等种子。
 * solon-test 在测试实例创建时启动应用（晚于 @BeforeAll），故用 @BeforeEach 懒初始化。
 */
@SolonTest(com.bidarena.App.class)
public abstract class ItBase {
    private static boolean initialized = false;

    @BeforeEach
    void initDatabase() {
        if (!initialized) {
            DatabaseInitializer.run(); // 幂等：Flyway + 种子（admin/bidder/bot_01..20）
            initialized = true;
        }
    }

    public static long ts() {
        return System.currentTimeMillis();
    }
}
