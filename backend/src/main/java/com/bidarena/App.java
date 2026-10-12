package com.bidarena;

import com.bidarena.config.DatabaseInitializer;
import org.noear.solon.Solon;

public class App {
    /** DB 迁移+种子完成后置 true；此前 HTTP 已监听但业务接口不可用（health 返回 STARTING） */
    public static volatile boolean dbReady = false;

    public static void main(String[] args) {
        // QA-005 根因修复：Solon 3 的 SolonApp 默认 _enableWebSocket=false，
        // NettyWsPlugin.start() 检查该标志为 false 时直接返回（netty 不监听 server.websocket.port）。
        // builder 在插件启动前执行，此处显式开启 WebSocket 信号。
        Solon.start(App.class, args, app -> app.enableWebSocket(true));
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
