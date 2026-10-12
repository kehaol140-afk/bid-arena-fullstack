package com.bidarena.it;

import com.bidarena.auction.AuctionRepository;
import com.bidarena.settlement.SettlementScanner;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;
import org.noear.solon.Solon;

import java.util.List;

/**
 * BUG-1 回归：Solon queryValueList() 零行结果返回 null（非空列表），
 * 曾导致 SettlementScanner 每秒 NPE（findDueIds 对 null 调用 .size()/遍历）。
 *
 * 场景：查询最早时间点（Long.MIN_VALUE），断言：
 * 1) findDueIds 返回非 null 空列表；
 * 2) SettlementScanner.scanOnce() 在空结果下不抛异常（直调受测方法）。
 */
public class Bug1FindDueIdsRegressionIT extends ItBase {

    @Test
    void findDueIdsReturnsEmptyListNotNullWhenNoDue() throws Exception {
        AuctionRepository repo = Solon.context().getBean(AuctionRepository.class);
        // Dedicated fresh test schema. A future cutoff makes every RUNNING lot due,
        // so the original 2100 timestamp did not actually construct an empty query.
        List<Long> ids = repo.findDueIds(Long.MIN_VALUE);
        Assertions.assertNotNull(ids, "BUG-1: 空结果必须返回空列表而非 null");
        Assertions.assertTrue(ids.isEmpty(), "新测试库在最早时间点应无到期拍卖");
    }

    @Test
    void scannerScanOnceSurvivesEmptyResult() throws Exception {
        SettlementScanner scanner = Solon.context().getBean(SettlementScanner.class);
        Assertions.assertDoesNotThrow(() -> {
            // 直调一轮扫描逻辑（此旧测试仅证明扫描入口可调用）
            // 说明：scanOnce 内部取 System.currentTimeMillis()，若恰有到期拍卖会真实结算（幂等安全），
            // 本断言关注的是不再出现 NullPointerException。
            scanner.scanOnce();
        }, "BUG-1: 扫描器空结果不允许 NPE");
    }
}
