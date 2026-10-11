package com.bidarena.websocket;

import org.noear.snack4.ONode;
import org.noear.solon.annotation.Component;

/**
 * 事件组装工具：统一事件信封 {type, auctionId, seq, serverTime, ...data}。
 * payload 仅含服务端生成字段（数字/已知枚举），不含用户自由文本，避免注入风险。
 */
@Component
public class EventFactory {
    public String envelope(String type, long auctionId, long seq, java.util.function.Consumer<ONode> data) {
        ONode n = new ONode();
        n.set("type", type);
        n.set("auctionId", auctionId);
        n.set("seq", seq);
        n.set("serverTime", System.currentTimeMillis());
        if (data != null) {
            data.accept(n);
        }
        return n.toJson();
    }
}
