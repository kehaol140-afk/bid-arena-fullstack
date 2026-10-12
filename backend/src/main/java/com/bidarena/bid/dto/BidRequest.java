package com.bidarena.bid.dto;

public class BidRequest {
    private String requestId;
    @io.swagger.annotations.ApiModelProperty(dataType="long", required=true, example="110")
    private java.math.BigDecimal amount;

    public String getRequestId() {
        return requestId;
    }

    public void setRequestId(String requestId) {
        this.requestId = requestId;
    }

    public Long getAmount() {
        if(amount==null) throw new com.bidarena.common.BusinessException(com.bidarena.common.ErrorCode.VALIDATION,"amount 必填");
        try { return amount.longValueExact(); }
        catch(ArithmeticException e) {throw new com.bidarena.common.BusinessException(com.bidarena.common.ErrorCode.VALIDATION,"amount 必须是可表示的整数积分");}
    }

    public void setAmount(java.math.BigDecimal amount) {
        this.amount = amount;
    }
}
