package com.bidarena.auction.dto;

import java.util.List;

public class AuctionDetailVO {
    private long id;
    private String title;
    private String description;
    private String status;
    private long startPrice;
    private long minIncrement;
    private long currentPrice;
    private Long currentLeaderId;
    private String currentLeaderName;
    private int durationSeconds;
    private Long startedAt;
    private Long endTime;
    private int extendCount;
    private int maxExtends;
    private long seq;
    private String settleReason;
    private long createdAt;
    private int participantCount;
    private List<ParticipantVO> participants;
    private ResultVO result;

    public static class ParticipantVO {
        private long userId;
        private String displayName;
        private String type;
        private long joinedAt;

        public long getUserId() {
            return userId;
        }

        public void setUserId(long userId) {
            this.userId = userId;
        }

        public String getDisplayName() {
            return displayName;
        }

        public void setDisplayName(String displayName) {
            this.displayName = displayName;
        }

        public String getType() {
            return type;
        }

        public void setType(String type) {
            this.type = type;
        }

        public long getJoinedAt() {
            return joinedAt;
        }

        public void setJoinedAt(long joinedAt) {
            this.joinedAt = joinedAt;
        }
    }

    public static class ResultVO {
        private Long winnerId;
        private String winnerName;
        private long finalPrice;
        private String reason;
        private long settledAt;

        public Long getWinnerId() {
            return winnerId;
        }

        public void setWinnerId(Long winnerId) {
            this.winnerId = winnerId;
        }

        public String getWinnerName() {
            return winnerName;
        }

        public void setWinnerName(String winnerName) {
            this.winnerName = winnerName;
        }

        public long getFinalPrice() {
            return finalPrice;
        }

        public void setFinalPrice(long finalPrice) {
            this.finalPrice = finalPrice;
        }

        public String getReason() {
            return reason;
        }

        public void setReason(String reason) {
            this.reason = reason;
        }

        public long getSettledAt() {
            return settledAt;
        }

        public void setSettledAt(long settledAt) {
            this.settledAt = settledAt;
        }
    }

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

    public String getCurrentLeaderName() {
        return currentLeaderName;
    }

    public void setCurrentLeaderName(String currentLeaderName) {
        this.currentLeaderName = currentLeaderName;
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

    public long getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(long createdAt) {
        this.createdAt = createdAt;
    }

    public int getParticipantCount() {
        return participantCount;
    }

    public void setParticipantCount(int participantCount) {
        this.participantCount = participantCount;
    }

    public List<ParticipantVO> getParticipants() {
        return participants;
    }

    public void setParticipants(List<ParticipantVO> participants) {
        this.participants = participants;
    }

    public ResultVO getResult() {
        return result;
    }

    public void setResult(ResultVO result) {
        this.result = result;
    }
}
