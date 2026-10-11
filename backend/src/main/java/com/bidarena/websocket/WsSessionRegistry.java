package com.bidarena.websocket;

import org.noear.solon.annotation.Component;
import org.noear.solon.net.websocket.WebSocket;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.Collection;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * WebSocket 会话注册表：auctionId -> (socketId -> Client{socket, userId})。
 * 线程安全；socket 关闭时由监听器负责移除。
 */
@Component
public class WsSessionRegistry {
    private static final Logger log = LoggerFactory.getLogger(WsSessionRegistry.class);
    private final Map<Long, Map<String, Client>> rooms = new ConcurrentHashMap<>();

    public static class Client {
        public final WebSocket socket;
        public final long userId;

        public Client(WebSocket socket, long userId) {
            this.socket = socket;
            this.userId = userId;
        }
    }

    public void join(long auctionId, Client client) {
        rooms.computeIfAbsent(auctionId, k -> new ConcurrentHashMap<>())
                .put(client.socket.id(), client);
        log.debug("ws join auction={} user={} total={}", auctionId, client.userId, rooms.get(auctionId).size());
    }

    public void leave(WebSocket socket) {
        Long auctionId = socket.attr("auctionId");
        if (auctionId == null) {
            return;
        }
        Map<String, Client> room = rooms.get(auctionId);
        if (room != null) {
            room.remove(socket.id());
            if (room.isEmpty()) {
                rooms.remove(auctionId, room);
            }
        }
        log.debug("ws leave auction={} socket={}", auctionId, socket.id());
    }

    public Collection<Client> clients(long auctionId) {
        Map<String, Client> room = rooms.get(auctionId);
        return room == null ? java.util.List.of() : room.values();
    }

    public int roomSize(long auctionId) {
        Map<String, Client> room = rooms.get(auctionId);
        return room == null ? 0 : room.size();
    }
}
