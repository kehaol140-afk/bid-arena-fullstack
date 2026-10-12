package com.bidarena.auction;

import com.bidarena.auction.dto.AuctionDetailVO;
import com.bidarena.auction.dto.CreateAuctionRequest;
import com.bidarena.auth.AuthInterceptor;
import com.bidarena.common.ApiResult;
import org.noear.solon.annotation.Controller;
import org.noear.solon.annotation.Inject;
import org.noear.solon.annotation.Mapping;
import org.noear.solon.annotation.Post;
import org.noear.solon.core.handle.Context;

import java.util.Map;

/**
 * 管理员接口（AdminInterceptor 校验 ADMIN 角色）。
 * 广播约定：@Tran 服务方法返回即已提交，随后广播；广播失败不影响事务。
 */
@io.swagger.annotations.Api(tags = "AdminAuctionController")
@Controller
@Mapping("/api/v1/admin/auctions")
public class AdminAuctionController {
    @Inject
    AuctionService auctions;
    @Inject
    AuctionEventWriter events;

    @io.swagger.annotations.ApiOperation(value = "Write AdminAuctionController")
    @Post
    @Mapping
    public ApiResult<Map<String, Long>> create(@org.noear.solon.annotation.Body CreateAuctionRequest req, Context ctx) {
        long adminUid = AuthInterceptor.currentUserId(ctx);
        long id = auctions.create(adminUid, req);
        return ApiResult.ok(Map.of("auctionId", id));
    }

    @io.swagger.annotations.ApiOperation(value = "Write AdminAuctionController")
    @Post
    @Mapping("/{id}/start")
    public ApiResult<AuctionDetailVO> start(long id) {
        long seq = auctions.start(id);
        events.broadcastSince(id, seq);
        return ApiResult.ok(auctions.detail(id));
    }

    @io.swagger.annotations.ApiOperation(value = "Write AdminAuctionController")
    @Post
    @Mapping("/{id}/cancel")
    public ApiResult<AuctionDetailVO> cancel(long id) {
        long seq = auctions.cancel(id);
        events.broadcastSince(id, seq);
        return ApiResult.ok(auctions.detail(id));
    }
}
