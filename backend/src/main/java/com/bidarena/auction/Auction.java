package com.bidarena.auction;

public class Auction {
    public static final String DRAFT = "DRAFT";
    public static final String RUNNING = "RUNNING";
    public static final String SETTLING = "SETTLING";
    public static final String FINISHED = "FINISHED";
    public static final String CANCELLED = "CANCELLED";

    private long id;
    private String title;
    private String description;
    private String status;
    private long startPrice;
    private long minIncrement;
    private long currentPrice;
    private Long currentLeaderId;
    private int durationSeconds;
    private Long startedAt;
    private Long endTime;
    private int extendCount;
    private int maxExtends;
    private long seq;
    private String settleReason;
    private long createdBy;
    private long createdAt;
    private long updatedAt;

    public long getId() {
        return id;
    }

    public void setId(long id) {
        this.id = id;
    }

    public String getTitle() {
        return title;
    }

    public void setTitle(String title) {
        this.title = title;
    }

    public String getDescription() {
        return description;
    }

    public void setDescription(String description) {
        this.description = description;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }

    public long getStartPrice() {
        return startPrice;
    }

    public void setStartPrice(long startPrice) {
        this.startPrice = startPrice;
    }

    public long getMinIncrement() {
        return minIncrement;
    }

    public void setMinIncrement(long minIncrement) {
        this.minIncrement = minIncrement;
    }

    public long getCurrentPrice() {
        return currentPrice;
    }

    public void setCurrentPrice(long currentPrice) {
        this.currentPrice = currentPrice;
    }

    public Long getCurrentLeaderId() {
        return currentLeaderId;
    }

    public void setCurrentLeaderId(Long currentLeaderId) {
        this.currentLeaderId = currentLeaderId;
    }

    public int getDurationSeconds() {
        return durationSeconds;
    }

    public void setDurationSeconds(int durationSeconds) {
        this.durationSeconds = durationSeconds;
    }

    public Long getStartedAt() {
        return startedAt;
    }

    public void setStartedAt(Long startedAt) {
        this.startedAt = startedAt;
    }

    public Long getEndTime() {
        return endTime;
    }

    public void setEndTime(Long endTime) {
        this.endTime = endTime;
    }

    public int getExtendCount() {
        return extendCount;
    }

    public void setExtendCount(int extendCount) {
        this.extendCount = extendCount;
    }

    public int getMaxExtends() {
        return maxExtends;
    }

    public void setMaxExtends(int maxExtends) {
        this.maxExtends = maxExtends;
    }

    public long getSeq() {
        return seq;
    }

    public void setSeq(long seq) {
        this.seq = seq;
    }

    public String getSettleReason() {
        return settleReason;
    }

    public void setSettleReason(String settleReason) {
        this.settleReason = settleReason;
    }

    public long getCreatedBy() {
        return createdBy;
    }

    public void setCreatedBy(long createdBy) {
        this.createdBy = createdBy;
    }

    public long getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(long createdAt) {
        this.createdAt = createdAt;
    }

    public long getUpdatedAt() {
        return updatedAt;
    }

    public void setUpdatedAt(long updatedAt) {
        this.updatedAt = updatedAt;
    }
}
