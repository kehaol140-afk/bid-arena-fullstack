package com.bidarena.websocket;

import com.bidarena.auction.Auction;
import com.bidarena.auction.AuctionRepository;
import com.bidarena.auth.SessionRepository;
import org.noear.solon.Solon;
import org.noear.solon.annotation.Bean;
import org.noear.solon.annotation.Configuration;
import org.noear.solon.net.websocket.WebSocket;
import org.noear.solon.net.websocket.WebSocketListener;
import org.noear.solon.net.websocket.WebSocketRouter;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.sql.SQLException;
import java.util.List;

/**
 * 拍卖房间 WebSocket：
 * - 连接：ws://host:port/ws/auction?token=<会话token>&auctionId=<id>
 * - 服务端事件信封：{type, auctionId, seq, serverTime, ...}
 * - 客户端可发 "SYNC:<lastSeq>" 请求补发缺失事件（序号缺口恢复）。
 */
@Configuration
public class WsConfig {
    private static final Logger log = LoggerFactory.getLogger(WsConfig.class);

    @Bean
    public void register(WebSocketRouter router) {
        WsSessionRegistry registry = Solon.context().getBean(WsSessionRegistry.class);
        router.of("/ws/auction", new AuctionWsListener(registry));
    }

    static class AuctionWsListener implements WebSocketListener {
        private final WsSessionRegistry registry;
        private final SessionRepository sessions = Solon.context().getBean(SessionRepository.class);
        private final AuctionRepository auctions = Solon.context().getBean(AuctionRepository.class);
        private final WsBroadcaster broadcaster = Solon.context().getBean(WsBroadcaster.class);
        private final EventFactory factory = Solon.context().getBean(EventFactory.class);

        AuctionWsListener(WsSessionRegistry registry) {
            this.registry = registry;
        }

        @Override
        public void onOpen(WebSocket socket) {
            Long auctionId = parseLong(socket.param("auctionId"));
            String token = socket.param("token");
            if (auctionId == null || token == null) {
                broadcaster.sendRaw(socket, factory.envelope("CONNECTION_STATE", 0, 0,
                        n -> n.set("state", "rejected").set("reason", "missing auctionId or token")));
                socket.close();
                return;
            }
            Long userId;
            try {
                userId = sessions.findValidUserId(token);
            } catch (SQLException e) {
                throw new RuntimeException(e);
            }
            if (userId == null) {
                broadcaster.sendRaw(socket, factory.envelope("CONNECTION_STATE", auctionId, 0,
                        n -> n.set("state", "rejected").set("reason", "invalid token")));
                socket.close();
                return;
            }
            socket.attr("auctionId", auctionId);
            socket.attr("userId", userId);
            registry.join(auctionId, new WsSessionRegistry.Client(socket, userId));

            broadcaster.sendRaw(socket, factory.envelope("CONNECTION_STATE", auctionId, 0,
                    n -> n.set("state", "connected")));
            // 连接建立即推送权威快照
            sendSnapshot(socket, auctionId);
        }

        @Override
        public void onMessage(WebSocket socket, String message) throws IOException {
            Long auctionId = socket.attr("auctionId");
            if (auctionId == null) {
                return;
            }
            // 协议：SYNC:<lastSeq> —— 补发该 seq 之后的所有持久化事件
            if (message != null && message.startsWith("SYNC:")) {
                long lastSeq = parseLong(message.substring(5)) == null ? 0 : parseLong(message.substring(5));
                replaySince(socket, auctionId, lastSeq);
                return;
            }
            if ("PING".equalsIgnoreCase(message)) {
                broadcaster.sendRaw(socket, factory.envelope("CONNECTION_STATE", auctionId, 0,
                        n -> n.set("state", "ping")));
            }
        }

        @Override
        public void onMessage(WebSocket socket, java.nio.ByteBuffer bytes) {
            // 本项目不使用二进制帧
        }

        @Override
        public void onClose(WebSocket socket) {
            registry.leave(socket);
        }

        @Override
        public void onError(WebSocket socket, Throwable error) {
            log.warn("ws error auction socket={}: {}", socket.id(), String.valueOf(error));
            registry.leave(socket);
        }

        private void sendSnapshot(WebSocket socket, long auctionId) {
            try {
                Auction a = auctions.findById(auctionId);
                if (a == null) {
                    broadcaster.sendRaw(socket, factory.envelope("AUCTION_SNAPSHOT", auctionId, 0,
                            n -> n.set("state", "not_found")));
                    return;
                }
                List<AuctionRepository.ParticipantRow> parts = auctions.listParticipants(auctionId);
                org.noear.snack4.ONode participants = new org.noear.snack4.ONode().asArray();
                for (AuctionRepository.ParticipantRow p : parts) {
                    org.noear.snack4.ONode po = new org.noear.snack4.ONode().asObject();
                    po.set("userId", p.getUserId());
                    po.set("displayName", p.getDisplayName());
                    po.set("type", p.getParticipantType());
                    participants.add(po);
                }
                String payload = factory.envelope("AUCTION_SNAPSHOT", auctionId, a.getSeq(), n -> {
                    n.set("status", a.getStatus());
                    n.set("title", a.getTitle());
                    n.set("startPrice", a.getStartPrice());
                    n.set("minIncrement", a.getMinIncrement());
                    n.set("currentPrice", a.getCurrentPrice());
                    n.set("currentLeaderId", a.getCurrentLeaderId());
                    n.set("startTime", a.getStartedAt());
                    n.set("endTime", a.getEndTime());
                    n.set("extendCount", a.getExtendCount());
                    n.set("maxExtends", a.getMaxExtends());
                    n.set("settleReason", a.getSettleReason());
                    n.set("participants", participants);
                });
                broadcaster.sendRaw(socket, payload);
            } catch (SQLException e) {
                log.warn("snapshot failed: {}", e.getMessage());
            }
        }

        private void replaySince(WebSocket socket, long auctionId, long lastSeq) {
            try {
                List<com.bidarena.auction.AuctionEventWriter.EventRow> rows =
                        Solon.context().getBean(org.noear.solon.data.sql.SqlUtils.class)
                                .sql("SELECT seq, payload FROM auction_events WHERE auction_id = ? AND seq > ? ORDER BY seq ASC",
                                        auctionId, lastSeq)
                                .queryRowList(com.bidarena.auction.AuctionEventWriter.EventRow.class);
                for (var r : rows) {
                    broadcaster.sendRaw(socket, r.getPayload());
                }
                // 无论有无事件，最后补发最新快照供对齐
                sendSnapshot(socket, auctionId);
            } catch (SQLException e) {
                log.warn("replay failed: {}", e.getMessage());
            }
        }

        private static Long parseLong(String s) {
            try {
                return s == null ? null : Long.parseLong(s.trim());
            } catch (NumberFormatException e) {
                return null;
            }
        }
    }
}
