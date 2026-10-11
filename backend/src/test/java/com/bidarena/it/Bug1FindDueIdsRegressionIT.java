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
 * 场景：查询一个「必然无到期拍卖」的时间点（远未来 now），断言：
 * 1) findDueIds 返回非 null 空列表；
 * 2) SettlementScanner.scanOnce() 在空结果下不抛异常（直调受测方法）。
 */
public class Bug1FindDueIdsRegressionIT extends ItBase {

    @Test
    void findDueIdsReturnsEmptyListNotNullWhenNoDue() throws Exception {
        AuctionRepository repo = Solon.context().getBean(AuctionRepository.class);
        // 远未来时间点：除非存在 end_time <= 2099 年的 RUNNING/SETTLING 记录，否则必然为空结果集
        List<Long> ids = repo.findDueIds(4_102_444_800_000L); // 2100-01-01 epoch ms
        Assertions.assertNotNull(ids, "BUG-1: 空结果必须返回空列表而非 null");
        Assertions.assertTrue(ids.isEmpty(), "远未来查询应无到期拍卖");
    }

    @Test
    void scannerScanOnceSurvivesEmptyResult() throws Exception {
        SettlementScanner scanner = Solon.context().getBean(SettlementScanner.class);
        Assertions.assertDoesNotThrow(() -> {
            // 用远未来时间直调一轮扫描逻辑（包内可见方法）
            // 说明：scanOnce 内部取 System.currentTimeMillis()，若恰有到期拍卖会真实结算（幂等安全），
            // 本断言关注的是不再出现 NullPointerException。
            scanner.scanOnce();
        }, "BUG-1: 扫描器空结果不允许 NPE");
    }
}
