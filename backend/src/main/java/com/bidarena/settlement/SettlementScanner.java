package com.bidarena.settlement;

import com.bidarena.auction.AuctionEventWriter;
import com.bidarena.auction.AuctionRepository;
import org.noear.solon.annotation.Component;
import org.noear.solon.annotation.Init;
import org.noear.solon.annotation.Inject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.List;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * 到期结算扫描器：服务端独立线程每秒扫描，不依赖任何客户端/浏览器触发。
 * 服务重启后由本扫描器继续完成 RUNNING 到期与 SETTLING 滞留（恢复）的结算。
 *
 * 注意：scanner -> settlementService 为跨 bean 调用，@Tran 代理正常生效（无自调用问题）。
 */
@Component
public class SettlementScanner {
    private static final Logger log = LoggerFactory.getLogger(SettlementScanner.class);

    @Inject
    AuctionRepository auctions;
    @Inject
    SettlementService settlement;
    @Inject
    AuctionEventWriter events;

    private ScheduledExecutorService executor;

    @Init
    public void start() {
        executor = Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "settlement-scanner");
            t.setDaemon(true);
            return t;
        });
        executor.scheduleWithFixedDelay(this::scanOnce, 3, 1, TimeUnit.SECONDS);
        log.info("settlement scanner started (interval 1s)");
    }

    void scanOnce() {
        try {
            long now = System.currentTimeMillis();
            List<Long> due = auctions.findDueIds(now);
            for (Long id : due) {
                try {
                    SettlementService.Claim claim = settlement.tryClaim(id, now);
                    if (claim == SettlementService.Claim.SKIP) {
                        continue;
                    }
                    if (claim == SettlementService.Claim.RESUME) {
                        log.info("resuming settlement for auction {}", id);
                    }
                    long seq = settlement.finalizeSettlement(id);
                    if (seq > 0) {
                        events.broadcastSince(id, seq);
                    }
                    log.info("auction {} settled (claim={})", id, claim);
                } catch (Exception e) {
                    log.error("settle auction {} failed: {}", id, e.getMessage(), e);
                }
            }
        } catch (Throwable t) {
            log.error("settlement scan error", t);
        }
    }
}
