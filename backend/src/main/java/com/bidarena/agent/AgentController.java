package com.bidarena.agent;

import com.bidarena.auction.dto.AuctionDetailVO;
import com.bidarena.auction.AuctionEventWriter;
import com.bidarena.auction.AuctionService;
import com.bidarena.bid.BidOutcome;
import com.bidarena.bid.BidService;
import com.bidarena.bid.dto.BidRequest;
import com.bidarena.bid.dto.BidVO;
import com.bidarena.common.ApiResult;
import org.noear.solon.annotation.Controller;
import org.noear.solon.annotation.Inject;
import org.noear.solon.annotation.Mapping;
import org.noear.solon.annotation.Post;
import org.noear.solon.core.handle.Context;

import java.util.Map;

/**
 * 竞拍 Agent 公开 API（独立于用户会话，最小权限）。
 * 复用与真人相同的业务服务（AuctionService / BidService），鉴权走 Agent Token。
 */
@Controller
@Mapping("/api/v1/agent")
public class AgentController {
    @Inject
    AuctionService auctions;
    @Inject
    BidService bidService;
    @Inject
    AuctionEventWriter events;

    @Mapping("/me")
    public ApiResult<Map<String, Object>> me(Context ctx) {
        AgentTokenRepository.AgentTokenRow t = AgentAuthInterceptor.currentToken(ctx);
        return ApiResult.ok(Map.of(
                "tokenId", t.getId(),
                "userId", t.getUserId(),
                "auctionId", t.getAuctionId(),
                "scopes", t.getScopes(),
                "expiresAt", t.getExpiresAt(),
                "rateLimitPerMin", t.getRateLimitPerMin()));
    }

    @Mapping("/auctions/{id}")
    public ApiResult<AuctionDetailVO> auction(long id, Context ctx) {
        AgentAuthInterceptor.assertScope(ctx, id, "auction:read");
        return ApiResult.ok(auctions.detail(id));
    }

    @Inject
    com.bidarena.bid.BidRepository bidRepo;

    @Mapping("/auctions/{id}/bids")
    public ApiResult<Object> bids(long id, Context ctx) throws java.sql.SQLException {
        AgentAuthInterceptor.assertScope(ctx, id, "auction:read");
        return ApiResult.ok(bidRepo.listByAuction(id, 200));
    }

    @Post
    @Mapping("/auctions/{id}/join")
    public ApiResult<Void> join(long id, Context ctx) {
        AgentAuthInterceptor.assertScope(ctx, id, "auction:bid");
        long agentUserId = ctx.attr("agentUserId");
        long seq = auctions.join(id, agentUserId, true);
        if (seq > 0) {
            events.broadcastSince(id, seq);
        }
        return ApiResult.ok();
    }

    @Post
    @Mapping("/auctions/{id}/bids")
    public ApiResult<BidVO> bid(long id, BidRequest req, Context ctx) {
        AgentAuthInterceptor.assertScope(ctx, id, "auction:bid");
        long receivedAt = System.currentTimeMillis();
        long agentUserId = ctx.attr("agentUserId");
        BidOutcome out = bidService.placeBid(id, agentUserId, req.getRequestId(), req.getAmount(), receivedAt);
        if (!out.isIdempotentReplay() && out.getFirstEventSeq() > 0) {
            events.broadcastSince(id, out.getFirstEventSeq());
        }
        BidVO vo = new BidVO();
        vo.setBidId(out.getBidId());
        vo.setAuctionId(id);
        vo.setUserId(out.getLeaderUserId());
        vo.setAmount(req.getAmount());
        vo.setSeq(out.getLastEventSeq());
        vo.setIdempotentReplay(out.isIdempotentReplay());
        vo.setCurrentPrice(out.getCurrentPrice());
        vo.setEndTime(out.getEndTime());
        vo.setExtended(out.isExtended());
        vo.setExtendCount(out.getExtendCount());
        vo.setServerTime(System.currentTimeMillis());
        return ApiResult.ok(vo);
    }
}
