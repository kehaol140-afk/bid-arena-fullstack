package com.bidarena.auction;

import com.bidarena.auction.dto.AuctionDetailVO;
import com.bidarena.auth.AuthInterceptor;
import com.bidarena.common.ApiResult;
import org.noear.solon.annotation.Controller;
import org.noear.solon.annotation.Get;
import org.noear.solon.annotation.Inject;
import org.noear.solon.annotation.Mapping;
import org.noear.solon.annotation.Post;
import org.noear.solon.core.handle.Context;

import java.util.List;

@io.swagger.annotations.Api(tags = "AuctionController")
@Controller
@Mapping("/api/v1/auctions")
public class AuctionController {
    @Inject
    AuctionService auctions;
    @Inject
    AuctionEventWriter events;

    @io.swagger.annotations.ApiOperation(value = "Read AuctionController")
    @Get
    @Mapping
    public ApiResult<List<AuctionDetailVO>> list() {
        return ApiResult.ok(auctions.list());
    }

    @io.swagger.annotations.ApiOperation(value = "Read AuctionController")
    @Get
    @Mapping("/{id}")
    public ApiResult<AuctionDetailVO> detail(long id) {
        return ApiResult.ok(auctions.detail(id));
    }

    @io.swagger.annotations.ApiOperation(value = "Write AuctionController")
    @Post
    @Mapping("/{id}/join")
    public ApiResult<Void> join(long id, Context ctx) {
        long uid = AuthInterceptor.currentUserId(ctx);
        // join 事务返回 PARTICIPANT_JOINED 事件 seq；事务提交后广播该事件（幂等重复加入 seq=0 不广播）
        long seq = auctions.join(id, uid, false);
        if (seq > 0) {
            events.broadcastSince(id, seq);
        }
        return ApiResult.ok();
    }

    /** 事件回放接口：断线/缺号客户端按 seq 拉取（HTTP 兜底，WebSocket 之外的恢复途径） */
    @io.swagger.annotations.ApiOperation(value = "Read AuctionController")
    @Get
    @Mapping("/{id}/events")
    public ApiResult<List<AuctionEventWriter.EventRow>> events(long id, Long since) throws java.sql.SQLException {
        return ApiResult.ok(events.since(id, since == null ? 0L : since));
    }
}
