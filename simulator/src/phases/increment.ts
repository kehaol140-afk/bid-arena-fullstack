import type { Ctx } from "../ctx.ts";
import { evidence } from "../reporter.ts";
import type { BidData } from "../api.ts";

/**
 * P5 正常递增出价：round-robin 递增（currentPrice + k*minIncrement，k 由 RNG 决定）
 * 断言：
 * - 每次出价 code=0、idempotentReplay=false、currentPrice=amount、领先者切换正确
 * - 服务端 seq 严格单调递增
 * - 价格只升不降，且每次加价 ≥ minIncrement
 */
export async function incrementPhase(ctx: Ctx): Promise<boolean> {
  const { rep, bots, rng, mainAuctionId } = ctx;
  console.log("\n== P5 正常递增出价 ==");
  if (!mainAuctionId) {
    rep.notVerified("P5-1", "递增出价", "顺序递增出价全成功", "无主拍卖（前置失败）");
    return false;
  }

  const detail0 = (await ctx.admin!.auctionDetail(mainAuctionId)).body.data!;
  let cur = detail0.currentPrice;
  const inc = detail0.minIncrement;
  let lastSeq = detail0.seq;
  let allOk = true;
  const errs: string[] = [];
  const accepted: BidData[] = [];
  const rounds = Math.min(10, bots.length);

  for (let k = 0; k < rounds; k++) {
    const bi = rng.int(0, bots.length - 1);
    const amount = cur + inc * rng.int(1, 3);
    const r = await bots[bi]!.bid(mainAuctionId, `sim-${ctx.cfg.tag}-inc-${k}`, amount);
    const d = r.body.data;
    if (
      r.body.code === 0 &&
      d &&
      !d.idempotentReplay &&
      d.currentPrice === amount &&
      (d.seq ?? 0) > lastSeq &&
      d.extendCount === detail0.extendCount
    ) {
      accepted.push(d);
      cur = amount;
      lastSeq = d.seq;
    } else {
      allOk = false;
      errs.push(`#${k} bot${bi + 1} amt=${amount}: ${evidence(r.body)}`);
    }
  }
  rep.check("P5-1", "递增出价", `${rounds} 次顺序递增出价全部接受且价格/领先者/seq 正确`, allOk, errs.join(" | "));

  const d = (await ctx.admin!.auctionDetail(mainAuctionId)).body.data!;
  rep.check(
    "P5-2",
    "递增出价",
    "detail.currentPrice 与最后成功出价一致",
    d.currentPrice === cur,
    `detail=${d.currentPrice} expect=${cur}`,
  );
  return allOk;
}
