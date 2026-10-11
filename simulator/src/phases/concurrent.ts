import type { Ctx } from "../ctx.ts";
import { evidence } from "../reporter.ts";
import type { BidData } from "../api.ts";

export interface BidAttempt {
  botIndex: number;
  requestId: string;
  amount: number;
}

export interface AttemptResult {
  botIndex: number;
  requestId: string;
  amount: number;
  http: number;
  code: number;
  data: BidData | null;
  error?: string;
}

/** 并发提交一组出价（同一事件循环轮次内同时 fetch） */
export async function fireConcurrent(
  ctx: Ctx,
  auctionId: number,
  attempts: BidAttempt[],
): Promise<AttemptResult[]> {
  const reqs = attempts.map(async (a): Promise<AttemptResult> => {
    try {
      const r = await ctx.bots[a.botIndex]!.bid(auctionId, a.requestId, a.amount);
      return { ...a, http: r.http, code: r.body.code, data: r.body.data };
    } catch (e) {
      return { ...a, http: -1, code: -1, data: null, error: (e as Error).message };
    }
  });
  return Promise.all(reqs);
}

/**
 * P6 并发出价：
 * - 轮A 同价并发：3 人同时出相同价 p+inc → 恰 1 成功、其余 2002，最终价 p+inc
 * - 轮B 相邻价并发：同时出 p+inc 与 p+2inc → 最终价 p+2inc（成功 1~2 个，失败者必为 2002）
 * - 轮C 同 requestId 并发重放：4 个相同 requestId+amount 同时提交 → 全 200，库中该 requestId 恰 1 条
 */
export async function concurrentPhase(ctx: Ctx): Promise<boolean> {
  const { rep, rng, mainAuctionId } = ctx;
  console.log("\n== P6 并发出价（同价/相邻价/同requestId）==");
  if (!mainAuctionId) {
    rep.notVerified("P6-1", "并发", "同价并发恰一成功", "无主拍卖（前置失败）");
    rep.notVerified("P6-2", "并发", "相邻价并发最终价为高价", "无主拍卖（前置失败）");
    rep.notVerified("P6-3", "并发", "同 requestId 并发重放唯一落库", "无主拍卖（前置失败）");
    rep.notVerified("P6-4", "并发", "并发后 detail 与 bids 一致", "无主拍卖（前置失败）");
    return false;
  }

  const detail = (await ctx.admin!.auctionDetail(mainAuctionId)).body.data!;
  const p = detail.currentPrice;
  const inc = detail.minIncrement;
  let ok = true;

  // 轮A：同价并发（3 个不同用户，相同金额）
  const samePrice = p + inc;
  const idxA = rng.sample([...Array(ctx.bots.length).keys()], 3);
  const resA = await fireConcurrent(
    ctx,
    mainAuctionId,
    idxA.map((bi, k) => ({ botIndex: bi, requestId: `sim-${ctx.cfg.tag}-ca-${k}`, amount: samePrice })),
  );
  const succA = resA.filter((r) => r.code === 0);
  const failA = resA.filter((r) => r.code !== 0);
  const aOk =
    succA.length === 1 &&
    failA.length === 2 &&
    failA.every((r) => r.code === 2002) &&
    succA[0]!.data?.currentPrice === samePrice;
  rep.check(
    "P6-1",
    "并发",
    `3 人并发同价 ${samePrice}：恰 1 成功、2 个 2002`,
    aOk,
    evidence(resA.map((r) => ({ code: r.code, amt: r.amount }))),
  );
  ok = ok && aOk;

  // 轮B：相邻价并发（低价+高价同时）
  const d1 = (await ctx.admin!.auctionDetail(mainAuctionId)).body.data!;
  const q = d1.currentPrice;
  const idxB = rng.sample([...Array(ctx.bots.length).keys()], 2);
  const resB = await fireConcurrent(ctx, mainAuctionId, [
    { botIndex: idxB[0]!, requestId: `sim-${ctx.cfg.tag}-cb-lo`, amount: q + inc },
    { botIndex: idxB[1]!, requestId: `sim-${ctx.cfg.tag}-cb-hi`, amount: q + 2 * inc },
  ]);
  const finalB = (await ctx.admin!.auctionDetail(mainAuctionId)).body.data!;
  const succB = resB.filter((r) => r.code === 0);
  const failB = resB.filter((r) => r.code !== 0);
  const bOk =
    finalB.currentPrice === q + 2 * inc &&
    succB.length >= 1 &&
    succB.length <= 2 &&
    failB.every((r) => r.code === 2002);
  rep.check(
    "P6-2",
    "并发",
    `相邻价并发（${q + inc}/${q + 2 * inc}）：最终价=${q + 2 * inc}，失败者均 2002`,
    bOk,
    evidence({ results: resB.map((r) => r.code), finalPrice: finalB.currentPrice }),
  );
  ok = ok && bOk;

  // 轮C：同 requestId 并发重放
  const d2 = (await ctx.admin!.auctionDetail(mainAuctionId)).body.data!;
  const r0 = d2.currentPrice + inc;
  const bi = rng.int(0, ctx.bots.length - 1);
  const rid = `sim-${ctx.cfg.tag}-cc-race`;
  const resC = await fireConcurrent(
    ctx,
    mainAuctionId,
    [0, 1, 2, 3].map((k) => ({ botIndex: bi, requestId: rid, amount: r0 })),
  );
  const all200 = resC.every((r) => r.code === 0 && r.data);
  const replayFlags = resC.filter((r) => r.data?.idempotentReplay === true).length;
  const bidsList = (await ctx.admin!.bids(mainAuctionId)).body.data ?? [];
  const withRid = bidsList.filter((b) => b.requestId === rid);
  const cOk =
    all200 &&
    withRid.length === 1 &&
    replayFlags === resC.length - 1 &&
    withRid[0]?.amount === r0;
  rep.check(
    "P6-3",
    "并发",
    "4 个相同 requestId 并发提交：全部 200、库中恰 1 条、重放标记正确",
    cOk,
    evidence({ codes: resC.map((r) => r.code), replayFlags, rows: withRid.length }),
  );
  ok = ok && cOk;

  // 一致性：detail 价格 == bids 最高价；seq 无重复
  const final = (await ctx.admin!.auctionDetail(mainAuctionId)).body.data!;
  const seqs = bidsList.map((b) => b.seq).sort((a, b) => a - b);
  const dupSeq = seqs.length !== new Set(seqs).size;
  const maxBid = Math.max(...bidsList.map((b) => b.amount));
  const dOk = final.currentPrice === maxBid && !dupSeq && (final.seq ?? 0) >= (seqs[seqs.length - 1] ?? 0);
  rep.check(
    "P6-4",
    "并发",
    "并发后 detail.currentPrice==bids 最高价且 seq 无重复",
    dOk,
    evidence({ currentPrice: final.currentPrice, maxBid, dupSeq }),
  );
  return ok && dOk;
}
