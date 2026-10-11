package com.bidarena.websocket;

import org.noear.solon.annotation.Component;
import org.noear.solon.annotation.Inject;
import org.noear.solon.net.websocket.WebSocket;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.Collection;
import java.util.concurrent.Future;

/**
 * 广播器：只负责发送。所有发送均为 best-effort：
 * 发送失败仅记日志并清理失效连接，绝不影响数据库事务（调用时机在事务提交之后）。
 */
@Component
public class WsBroadcaster {
    private static final Logger log = LoggerFactory.getLogger(WsBroadcaster.class);

    @Inject
    WsSessionRegistry registry;

    public void broadcast(long auctionId, String payload) {
        Collection<WsSessionRegistry.Client> clients = registry.clients(auctionId);
        for (WsSessionRegistry.Client c : clients) {
            sendQuietly(c.socket, payload);
        }
    }

    public void sendToUser(long auctionId, long userId, String payload) {
        for (WsSessionRegistry.Client c : registry.clients(auctionId)) {
            if (c.userId == userId) {
                sendQuietly(c.socket, payload);
            }
        }
    }

    public void sendRaw(WebSocket socket, String payload) {
        sendQuietly(socket, payload);
    }

    private void sendQuietly(WebSocket socket, String payload) {
        try {
            Future<Void> f = socket.send(payload);
            // 不阻塞等待网络完成；连接失效在下一轮或 onClose 清理
            if (f.isDone() && f.isCancelled()) {
                registry.leave(socket);
            }
        } catch (Exception e) {
            log.warn("ws send failed: {}", e.getMessage());
            registry.leave(socket);
        }
    }
}
