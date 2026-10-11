import type { Ctx } from "../ctx.ts";
import { evidence } from "../reporter.ts";

/**
 * P7 幂等与拒绝路径：
 * - 同 requestId 同金额重放 → 200 + idempotentReplay=true + bidId 不变 + bids 不新增 + 流水不新增
 * - 同 requestId 不同金额 → 409 code=2005
 * - 低于最小加价（currentPrice+inc-1）与等于当前价 → 400 code=2002
 * - 拒绝后无副作用：价格/领先者/seq 不变、钱包冻结不变
 */
export async function idempotencyRejectPhase(ctx: Ctx): Promise<boolean> {
  const { rep, rng, mainAuctionId } = ctx;
  console.log("\n== P7 幂等重试与拒绝（低价）==");
  if (!mainAuctionId) {
    rep.notVerified("P7-1", "幂等", "requestId 重放幂等", "无主拍卖（前置失败）");
    rep.notVerified("P7-2", "幂等", "requestId 内容冲突 409/2005", "无主拍卖（前置失败）");
    rep.notVerified("P7-3", "拒绝", "低价/平价出价 400/2002", "无主拍卖（前置失败）");
    rep.notVerified("P7-4", "拒绝", "拒绝无资金副作用", "无主拍卖（前置失败）");
    return false;
  }

  const before = (await ctx.admin!.auctionDetail(mainAuctionId)).body.data!;
  const p = before.currentPrice;
  const inc = before.minIncrement;
  const bi = rng.int(0, ctx.bots.length - 1);
  const rid = `sim-${ctx.cfg.tag}-idem`;
  const amount = p + inc;

  // 首次出价
  const first = await ctx.bots[bi]!.bid(mainAuctionId, rid, amount);
  if (first.body.code !== 0 || !first.body.data) {
    rep.fail("P7-0", "幂等", "基准出价成功", evidence(first.body));
    return false;
  }
  const bidId = first.body.data.bidId;

  // 幂等重放（串行重试，模拟网络重试）
  const bidsBefore = ((await ctx.admin!.bids(mainAuctionId)).body.data ?? []).length;
  const ledgerBefore = ((await ctx.bots[bi]!.ledger()).body.data ?? []).filter((l) => l.auctionId === mainAuctionId).length;
  const replay = await ctx.bots[bi]!.bid(mainAuctionId, rid, amount);
  const bidsAfter = ((await ctx.admin!.bids(mainAuctionId)).body.data ?? []).length;
  const ledgerAfter = ((await ctx.bots[bi]!.ledger()).body.data ?? []).filter((l) => l.auctionId === mainAuctionId).length;
  const r1 =
    replay.body.code === 0 &&
    replay.body.data?.idempotentReplay === true &&
    replay.body.data?.bidId === bidId &&
    bidsAfter === bidsBefore &&
    ledgerAfter === ledgerBefore;
  rep.check(
    "P7-1",
    "幂等",
    "同 requestId+金额重放：idempotentReplay=true、bidId 不变、不新增出价/流水",
    r1,
    evidence({ replayCode: replay.body.code, flags: replay.body.data?.idempotentReplay, bidId, bidsBefore, bidsAfter, ledgerBefore, ledgerAfter }),
  );

  // requestId 冲突（同号不同金额）
  const conflict = await ctx.bots[bi]!.bid(mainAuctionId, rid, amount + inc);
  const r2 = conflict.http === 409 && conflict.body.code === 2005;
  rep.check(
    "P7-2",
    "幂等",
    "同 requestId 不同金额 → 409 code=2005",
    r2,
    evidence({ http: conflict.http, body: conflict.body }),
  );

  // 低价拒绝：currentPrice+inc-1 与 ==currentPrice
  const after = (await ctx.admin!.auctionDetail(mainAuctionId)).body.data!;
  const q = after.currentPrice;
  const bi2 = rng.int(0, ctx.bots.length - 1);
  const low1 = await ctx.bots[bi2]!.bid(mainAuctionId, `sim-${ctx.cfg.tag}-low-1`, q + inc - 1);
  const low2 = await ctx.bots[bi2]!.bid(mainAuctionId, `sim-${ctx.cfg.tag}-low-2`, q);
  const r3 =
    low1.http === 400 && low1.body.code === 2002 &&
    low2.http === 400 && low2.body.code === 2002;
  rep.check(
    "P7-3",
    "拒绝",
    `低价（${q + inc - 1}）与平价（${q}）出价 → 400 code=2002`,
    r3,
    evidence({ low1: { http: low1.http, code: low1.body.code }, low2: { http: low2.http, code: low2.body.code } }),
  );

  // 无副作用：价格/领先者/seq 不变；被拒者冻结 = 基线 + (当前领先者持仓或 0)
  const final = (await ctx.admin!.auctionDetail(mainAuctionId)).body.data!;
  const w = (await ctx.bots[bi2]!.wallet()).body.data;
  const wBase = ctx.baseline.get(ctx.botIds[bi2]!);
  const isLeaderNow = final.currentLeaderId === ctx.botIds[bi2]!;
  const expectFrozen = (wBase?.frozen ?? 0) + (isLeaderNow ? final.currentPrice : 0);
  const r4 =
    final.currentPrice === q &&
    final.seq === after.seq &&
    final.currentLeaderId === after.currentLeaderId &&
    !!w && w.frozen === expectFrozen;
  rep.check(
    "P7-4",
    "拒绝",
    "拒绝后价格/领先者/seq/冻结均无变化",
    r4,
    evidence({ price: `${after.currentPrice}->${final.currentPrice}`, seq: `${after.seq}->${final.seq}`, frozen: `${w?.frozen} expect=${expectFrozen}` }),
  );

  return r1 && r2 && r3 && r4;
}
