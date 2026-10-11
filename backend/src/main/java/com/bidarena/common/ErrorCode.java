package com.bidarena.common;

/**
 * 业务错误码。httpStatus 为对外返回的 HTTP 状态码。
 */
public enum ErrorCode {
    UNAUTHORIZED(1001, 401, "未认证或会话已过期"),
    FORBIDDEN(1002, 403, "无权访问"),
    NOT_FOUND(1004, 404, "资源不存在"),
    VALIDATION(1005, 400, "参数校验失败"),
    AUCTION_NOT_RUNNING(2001, 409, "拍卖当前不接受出价"),
    BID_TOO_LOW(2002, 400, "出价低于最小合法价"),
    INSUFFICIENT_FUNDS(2003, 400, "可用余额不足"),
    BID_TOO_LATE(2004, 409, "出价已超过截止时间"),
    IDEMPOTENT_CONFLICT(2005, 409, "相同 requestId 已存在但请求内容不同"),
    EXTEND_LIMIT(2006, 200, "延时次数已达上限（出价仍有效）"),
    AUCTION_STATE_INVALID(2007, 409, "拍卖状态不允许该操作"),
    AGENT_TOKEN_INVALID(3001, 401, "Agent Token 无效、过期或已吊销"),
    AGENT_SCOPE_DENIED(3002, 403, "Agent Token 无权访问该拍卖"),
    AGENT_PERMISSION_DENIED(3003, 403, "Agent Token 缺少所需权限"),
    AGENT_RATE_LIMITED(3004, 429, "Agent 调用频率超限"),
    INTERNAL(9999, 500, "服务器内部错误");

    private final int code;
    private final int httpStatus;
    private final String defaultMessage;

    ErrorCode(int code, int httpStatus, String defaultMessage) {
        this.code = code;
        this.httpStatus = httpStatus;
        this.defaultMessage = defaultMessage;
    }

    public int getCode() {
        return code;
    }

    public int getHttpStatus() {
        return httpStatus;
    }

    public String getDefaultMessage() {
        return defaultMessage;
    }
}
