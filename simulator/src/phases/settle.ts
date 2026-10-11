import type { Ctx } from "../ctx.ts";
import { evidence } from "../reporter.ts";
import { pollUntil, waitUntil } from "../util.ts";

/**
 * P11 主拍卖到期结算与结果核对：
 * - 等待 FINISHED（服务端定时结算，不依赖客户端）
 * - result.winnerId == 结算前领先者、finalPrice == 结算前 currentPrice、reason=EXPIRED
 * - FINISHED 后出价 → 409 code=2001（非法状态）
 */
export async function settlePhase(ctx: Ctx): Promise<boolean> {
  const { rep, mainAuctionId } = ctx;
  console.log("\n== P11 主拍卖结算 ==");
  if (!mainAuctionId) {
    for (const [id, name] of [
      ["P11-1", "到期自动 FINISHED（服务端结算）"],
      ["P11-2", "result 赢家/成交价/原因正确"],
      ["P11-3", "FINISHED 后出价 → 409/2001"],
    ] as const) {
      rep.notVerified(id, "结算", name, "无主拍卖（前置失败）");
    }
    return false;
  }

  const before = (await ctx.admin!.auctionDetail(mainAuctionId)).body.data!;
  await waitUntil((before.endTime ?? 0) + 1500);
  const done = await pollUntil(
    async () => (await ctx.admin!.auctionDetail(mainAuctionId)).body.data?.status === "FINISHED",
    20_000,
    500,
  );
  rep.check("P11-1", "结算", "到期后自动 FINISHED（服务端扫描结算）", done, "20s 内未观察到 FINISHED");

  const after = (await ctx.admin!.auctionDetail(mainAuctionId)).body.data!;
  const res = after.result;
  const r2 =
    done &&
    !!res &&
    res.winnerId === before.currentLeaderId &&
    res.finalPrice === before.currentPrice &&
    res.reason === "EXPIRED";
  rep.check(
    "P11-2",
    "结算",
    "result 与结算前状态一致（赢家/价格/EXPIRED）",
    r2,
    evidence({ result: res, before: { leader: before.currentLeaderId, price: before.currentPrice } }),
  );

  // 终态后出价 → 2001
  const late = await ctx.bots[0]!.bid(mainAuctionId, `sim-${ctx.cfg.tag}-after-end`, after.currentPrice + after.minIncrement);
  const r3 = late.http === 409 && late.body.code === 2001;
  rep.check("P11-3", "结算", "FINISHED 后出价 → 409/2001", r3, evidence({ http: late.http, code: late.body.code }));

  return done && r2 && r3;
}
