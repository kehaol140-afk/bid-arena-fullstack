package com.bidarena.bid;

import com.bidarena.common.BusinessException;
import com.bidarena.common.ErrorCode;
import org.noear.solon.annotation.Component;
import org.noear.solon.annotation.Inject;
import java.sql.SQLException;

/** Retry outside @Tran: every attempt has its own complete commit/rollback boundary. */
@Component
public class BidService {
    @Inject BidTransaction transaction;

    public BidOutcome placeBid(long auctionId, long userId, String requestId, long amount, long receivedAt) {
        for (int attempt = 0; ; attempt++) {
            try {
                return transaction.placeBid(auctionId, userId, requestId, amount, receivedAt);
            } catch (Throwable failure) {
                if (!retryable(failure)) {
                    if (failure instanceof RuntimeException e) throw e;
                    if (failure instanceof Error e) throw e;
                    throw new RuntimeException(failure);
                }
                if (attempt == 2) throw new BusinessException(ErrorCode.BID_RETRYABLE, "事务竞争，请用相同 requestId 重试");
                try { Thread.sleep(20L * (attempt + 1)); }
                catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    throw new BusinessException(ErrorCode.BID_RETRYABLE, "请求中断，请用相同 requestId 重试");
                }
            }
        }
    }

    static boolean retryable(Throwable failure) {
        for (Throwable cause = failure; cause != null; cause = cause.getCause()) {
            if (cause instanceof SQLException sql && (sql.getErrorCode() == 1213 || sql.getErrorCode() == 1205)) return true;
        }
        return false;
    }
}
