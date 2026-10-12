package com.bidarena;

import com.bidarena.config.DatabaseInitializer;
import org.noear.solon.Solon;

public class App {
    /** DB 迁移+种子完成后置 true；此前 HTTP 已监听但业务接口不可用（health 返回 STARTING） */
    public static volatile boolean dbReady = false;

    public static void main(String[] args) {
        Solon.start(App.class, args);
        try {
            // 启动后立即执行数据库迁移与幂等种子（服务可用前完成初始化）
            DatabaseInitializer.run();
            dbReady = true;
        } catch (Exception e) {
            e.printStackTrace();
            Solon.stopBlock();
            System.exit(1);
        }
    }
}
