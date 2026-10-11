package com.bidarena.auction.dto;

public class CreateAuctionRequest {
    private String title;
    private String description;
    private Long startPrice;      // 默认 100
    private Long minIncrement;    // 默认 10
    private Integer durationSeconds; // 默认 180；演示可创建更短时长（5~3600）

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

    public Long getStartPrice() {
        return startPrice;
    }

    public void setStartPrice(Long startPrice) {
        this.startPrice = startPrice;
    }

    public Long getMinIncrement() {
        return minIncrement;
    }

    public void setMinIncrement(Long minIncrement) {
        this.minIncrement = minIncrement;
    }

    public Integer getDurationSeconds() {
        return durationSeconds;
    }

    public void setDurationSeconds(Integer durationSeconds) {
        this.durationSeconds = durationSeconds;
    }
}
