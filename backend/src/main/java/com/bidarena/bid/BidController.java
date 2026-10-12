package com.bidarena.bid;

import com.bidarena.auction.AuctionEventWriter;
import com.bidarena.auth.AuthInterceptor;
import com.bidarena.bid.dto.BidRequest;
import com.bidarena.bid.dto.BidVO;
import com.bidarena.common.ApiResult;
import com.bidarena.common.BusinessException;
import org.noear.solon.annotation.Controller;
import org.noear.solon.annotation.Get;
import org.noear.solon.annotation.Inject;
import org.noear.solon.annotation.Mapping;
import org.noear.solon.annotation.Post;
import org.noear.solon.core.handle.Context;

import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;

@Controller
@Mapping("/api/v1/auctions/{id}/bids")
public class BidController {
    @Inject
    BidService bidService;
    @Inject
    BidRepository bids;
    @Inject
    AuctionEventWriter events;

    /**
     * 出价：receivedAt 在进入业务逻辑前捕获（服务端接收时间），
     * 截止校验在拍卖行锁内以 receivedAt 严格早于 end_time 判定（见 BidService）。
     */
    @Post
    @Mapping
    public ApiResult<BidVO> place(long id, BidRequest req, Context ctx) {
        long receivedAt = System.currentTimeMillis();
        long uid = AuthInterceptor.currentUserId(ctx);
        try {
            BidOutcome out = bidService.placeBid(id, uid, req.getRequestId(), req.getAmount(), receivedAt);
            // 事务已提交（@Tran 方法返回），此后广播；广播失败不影响事务
            if (!out.isIdempotentReplay() && out.getFirstEventSeq() > 0) {
                events.broadcastSince(id, out.getFirstEventSeq());
            }
            return ApiResult.ok(toVO(out, id, uid, req));
        } catch (BusinessException e) {
            // BID_REJECTED 仅推给本人（不落库：拒绝不改变任何状态）
            events.sendToUser(id, uid, "BID_REJECTED", n -> {
                n.set("requestId", String.valueOf(req.getRequestId()));
                n.set("reason", e.getErrorCode().name());
                n.set("message", e.getMessage());
            });
            throw e;
        }
    }

    @Get
    @Mapping
    public ApiResult<List<BidVO>> list(long id) throws SQLException {
        List<BidRepository.BidRow> rows = bids.listByAuction(id, 200);
        List<BidVO> out = new ArrayList<>();
        for (BidRepository.BidRow r : rows) {
            BidVO vo = new BidVO();
            vo.setBidId(r.getId());
            vo.setAuctionId(r.getAuctionId());
            vo.setUserId(r.getUserId());
            vo.setAmount(r.getAmount());
            vo.setSeq(r.getSeq());
            vo.setServerTime(r.getCreatedAt());
            out.add(vo);
        }
        return ApiResult.ok(out);
    }

    private BidVO toVO(BidOutcome out, long auctionId, long uid, BidRequest req) {
        BidVO vo = new BidVO();
        vo.setBidId(out.getBidId());
        vo.setAuctionId(auctionId);
        vo.setUserId(out.getLeaderUserId());
        vo.setAmount(req.getAmount());
        vo.setSeq(out.getLastEventSeq());
        vo.setIdempotentReplay(out.isIdempotentReplay());
        vo.setCurrentPrice(out.getCurrentPrice());
        vo.setEndTime(out.getEndTime());
        vo.setExtended(out.isExtended());
        vo.setExtendCount(out.getExtendCount());
        vo.setServerTime(System.currentTimeMillis());
        return vo;
    }
}
