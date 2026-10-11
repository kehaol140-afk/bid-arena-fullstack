package com.bidarena;

import com.bidarena.config.DatabaseInitializer;
import org.noear.solon.Solon;

public class App {
    public static void main(String[] args) {
        Solon.start(App.class, args);
        try {
            // 启动后立即执行数据库迁移与幂等种子（服务可用前完成初始化）
            DatabaseInitializer.run();
        } catch (Exception e) {
            e.printStackTrace();
            Solon.stopBlock();
            System.exit(1);
        }
    }
}
