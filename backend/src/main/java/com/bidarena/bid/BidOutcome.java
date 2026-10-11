package com.bidarena.bid;

/**
 * 出价事务结果（供控制器在提交后广播与响应）。
 */
public class BidOutcome {
    private final boolean idempotentReplay; // 相同 requestId 且金额一致的重放
    private final long bidId;
    private final long firstEventSeq;       // BID_ACCEPTED 事件 seq（广播起点；重放时为原出价 seq）
    private final long lastEventSeq;        // 若触发延时，含 AUCTION_EXTENDED 的 seq
    private final long currentPrice;
    private final Long endTime;
    private final boolean extended;
    private final int extendCount;
    private final long leaderUserId;
    private final long requiredMinPrice;    // 本次服务端计算的最小合法价

    public BidOutcome(boolean idempotentReplay, long bidId, long firstEventSeq, long lastEventSeq,
                      long currentPrice, Long endTime, boolean extended, int extendCount,
                      long leaderUserId, long requiredMinPrice) {
        this.idempotentReplay = idempotentReplay;
        this.bidId = bidId;
        this.firstEventSeq = firstEventSeq;
        this.lastEventSeq = lastEventSeq;
        this.currentPrice = currentPrice;
        this.endTime = endTime;
        this.extended = extended;
        this.extendCount = extendCount;
        this.leaderUserId = leaderUserId;
        this.requiredMinPrice = requiredMinPrice;
    }

    public boolean isIdempotentReplay() {
        return idempotentReplay;
    }

    public long getBidId() {
        return bidId;
    }

    public long getFirstEventSeq() {
        return firstEventSeq;
    }

    public long getLastEventSeq() {
        return lastEventSeq;
    }

    public long getCurrentPrice() {
        return currentPrice;
    }

    public Long getEndTime() {
        return endTime;
    }

    public boolean isExtended() {
        return extended;
    }

    public int getExtendCount() {
        return extendCount;
    }

    public long getLeaderUserId() {
        return leaderUserId;
    }

    public long getRequiredMinPrice() {
        return requiredMinPrice;
    }
}
