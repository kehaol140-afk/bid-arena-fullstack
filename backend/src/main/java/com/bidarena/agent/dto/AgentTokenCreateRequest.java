package com.bidarena.agent.dto;

public class AgentTokenCreateRequest {
    private Long userId;            // 绑定的 Agent 用户
    private Long auctionId;         // 允许参与的拍卖（范围）
    private String scopes;          // auction:read,auction:bid
    private Long expiresInSeconds;  // 默认 3600
    private Integer rateLimitPerMin;// 默认 30

    public Long getUserId() {
        return userId;
    }

    public void setUserId(Long userId) {
        this.userId = userId;
    }

    public Long getAuctionId() {
        return auctionId;
    }

    public void setAuctionId(Long auctionId) {
        this.auctionId = auctionId;
    }

    public String getScopes() {
        return scopes;
    }

    public void setScopes(String scopes) {
        this.scopes = scopes;
    }

    public Long getExpiresInSeconds() {
        return expiresInSeconds;
    }

    public void setExpiresInSeconds(Long expiresInSeconds) {
        this.expiresInSeconds = expiresInSeconds;
    }

    public Integer getRateLimitPerMin() {
        return rateLimitPerMin;
    }

    public void setRateLimitPerMin(Integer rateLimitPerMin) {
        this.rateLimitPerMin = rateLimitPerMin;
    }
}
