package com.bidarena.auction;

import org.noear.snack4.ONode;
import org.noear.solon.annotation.Component;
import org.noear.solon.annotation.Inject;
import org.noear.solon.data.sql.SqlUtils;
import org.noear.solon.core.handle.Context;

import java.io.IOException;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;

/**
 * 事件写入（事务内）+ 事务提交后广播。
 *
 * 编排规则（写入 DESIGN.md）：
 * - append：必须在活动事务内调用，事件随业务事务原子提交；
 * - flush：必须在事务提交成功之后调用（Controller/扫描器在 Service 方法返回后触发），
 *   广播失败仅记日志，绝不回滚已提交事务。
 */
@Component
public class AuctionEventWriter {
    @Inject
    AuctionRepository auctions;
    @Inject
    SqlUtils sql;
    @Inject
    com.bidarena.websocket.EventFactory factory;
    @Inject
    com.bidarena.websocket.WsBroadcaster broadcaster;

    /** 事务内：为拍卖追加一条事件（seq 由拍卖行锁保护递增） */
    public long append(long auctionId, String type, java.util.function.Consumer<ONode> data) throws SQLException {
        long now = System.currentTimeMillis();
        long seq = auctions.nextSeq(auctionId, now);
        String payload = factory.envelope(type, auctionId, seq, data);
        sql.sql("INSERT INTO auction_events(auction_id, seq, type, payload, created_at) VALUES (?, ?, ?, ?, ?)",
                auctionId, seq, type, payload, now).update();
        return seq;
    }

    /** 提交后：广播 >= fromSeq 的事件（可重放，供断线客户端与并发观察者使用） */
    public void broadcastSince(long auctionId, long fromSeq) {
        try {
            List<EventRow> rows = since(auctionId, fromSeq);
            for (EventRow r : rows) {
                broadcaster.broadcast(auctionId, r.getPayload());
            }
        } catch (Exception e) {
            // 广播失败不影响已提交事务
            org.slf4j.LoggerFactory.getLogger(AuctionEventWriter.class)
                    .warn("broadcast failed for auction {}: {}", auctionId, e.getMessage());
        }
    }

    /** 查询某 seq 之后的事件（HTTP 兜底回放） */
    public List<EventRow> since(long auctionId, long fromSeq) throws SQLException {
        return sql.sql("SELECT seq, payload FROM auction_events WHERE auction_id = ? AND seq >= ? ORDER BY seq ASC",
                auctionId, fromSeq).queryRowList(EventRow.class);
    }

    /** 单事件定向发送（例如 BID_REJECTED 只推给本人） */
    public void sendToUser(long auctionId, long userId, String type, java.util.function.Consumer<ONode> data) {
        try {
            Auction a = auctions.findById(auctionId);
            long seq = a == null ? 0 : a.getSeq();
            String payload = factory.envelope(type, auctionId, seq, data);
            broadcaster.sendToUser(auctionId, userId, payload);
        } catch (Exception e) {
            org.slf4j.LoggerFactory.getLogger(AuctionEventWriter.class)
                    .warn("sendToUser failed for user {}: {}", userId, e.getMessage());
        }
    }

    public static class EventRow {
        private long seq;
        private String payload;

        public long getSeq() {
            return seq;
        }

        public void setSeq(long seq) {
            this.seq = seq;
        }

        public String getPayload() {
            return payload;
        }

        public void setPayload(String payload) {
            this.payload = payload;
        }
    }
}
