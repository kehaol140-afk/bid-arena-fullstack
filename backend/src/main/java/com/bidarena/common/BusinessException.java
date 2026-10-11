package com.bidarena.common;

/**
 * 业务异常：携带错误码，由全局异常拦截器转换为统一 JSON 响应。
 */
public class BusinessException extends RuntimeException {
    private final ErrorCode errorCode;
    private final String detail;

    public BusinessException(ErrorCode errorCode) {
        this(errorCode, null);
    }

    public BusinessException(ErrorCode errorCode, String detail) {
        super(errorCode.getDefaultMessage() + (detail == null ? "" : ": " + detail));
        this.errorCode = errorCode;
        this.detail = detail;
    }

    public ErrorCode getErrorCode() {
        return errorCode;
    }

    public String getDetail() {
        return detail;
    }
}
