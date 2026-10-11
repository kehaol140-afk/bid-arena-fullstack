package com.bidarena.wallet;

import com.bidarena.auth.AuthInterceptor;
import com.bidarena.common.ApiResult;
import com.bidarena.common.BusinessException;
import com.bidarena.common.ErrorCode;
import org.noear.solon.annotation.Controller;
import org.noear.solon.annotation.Inject;
import org.noear.solon.annotation.Mapping;
import org.noear.solon.data.sql.SqlUtils;
import org.noear.solon.core.handle.Context;

import java.sql.SQLException;
import java.util.List;

@Controller
@Mapping("/api/v1/wallets")
public class WalletController {
    @Inject
    WalletRepository wallets;
    @Inject
    SqlUtils sql;

    /** 只允许查询自己的钱包（普通用户禁止查看他人隐私） */
    @Mapping("/me")
    public ApiResult<WalletVO> me(Context ctx) {
        try {
            long uid = AuthInterceptor.currentUserId(ctx);
            Wallet w = wallets.findByUserId(uid);
            if (w == null) {
                throw new BusinessException(ErrorCode.NOT_FOUND, "钱包不存在");
            }
            return ApiResult.ok(new WalletVO(uid, w.getBalance(), w.getFrozen()));
        } catch (SQLException e) {
            throw new RuntimeException(e);
        }
    }

    /** 本人资金流水（最新优先） */
    @Mapping("/me/ledger")
    public ApiResult<List<LedgerVO>> ledger(Context ctx) {
        try {
            long uid = AuthInterceptor.currentUserId(ctx);
            return ApiResult.ok(sql.sql("""
                            SELECT id, auction_id, request_id, type, amount, balance_after, frozen_after, remark, created_at
                            FROM wallet_ledger WHERE user_id = ? ORDER BY id DESC LIMIT 200
                            """, uid).queryRowList(LedgerVO.class));
        } catch (SQLException e) {
            throw new RuntimeException(e);
        }
    }
}
