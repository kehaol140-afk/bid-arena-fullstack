import type { Ctx } from "../ctx.ts";
import { evidence } from "../reporter.ts";
import { waitUntil } from "../util.ts";
import type { EventRow } from "../api.ts";

/**
 * P8 最后 5 秒狙击与延时：
 * - 在 endTime-3.5s 出价 → extended=true、endTime+10s、extendCount 递增
 * - 连续 3 次（每次基于最新截止时间），AUCTION_EXTENDED 事件落库（HTTP events 校验）
 * - 第 4 次最后 5 秒出价 → 仍 200 但 extended=false（延时上限 3 次）
 */
export async function snipePhase(ctx: Ctx): Promise<boolean> {
  const { rep, mainAuctionId } = ctx;
  console.log("\n== P8 最后5秒狙击与延时上限 ==");
  if (!mainAuctionId) {
    for (const [id, name] of [
      ["P8-1", "狙击触发延时（3 次逐次校验）"],
      ["P8-2", "AUCTION_EXTENDED 事件落库"],
      ["P8-3", "第 4 次狙击不延时（上限 3）"],
    ] as const) {
      rep.notVerified(id, "狙击延时", name, "无主拍卖（前置失败）");
    }
    return false;
  }

  // 等到主拍卖自然进入最后 5 秒窗口（留 1.5s 请求余量）
  let det = (await ctx.admin!.auctionDetail(mainAuctionId)).body.data!;
  await waitUntil((det.endTime ?? 0) - 3500);

  let allExtOk = true;
  const extEvidence: unknown[] = [];
  const snipers: number[] = [];
  for (let n = 1; n <= 3; n++) {
    det = (await ctx.admin!.auctionDetail(mainAuctionId)).body.data!;
    const before = det.endTime!;
    const bi = ctx.rng.int(0, ctx.bots.length - 1);
    snipers.push(bi);
    const amount = det.currentPrice + det.minIncrement;
    const r = await ctx.bots[bi]!.bid(mainAuctionId, `sim-${ctx.cfg.tag}-snipe-${n}`, amount);
    const d = r.body.data;
    const ok =
      r.body.code === 0 &&
      d?.extended === true &&
      d.extendCount === n &&
      d.endTime === before + 10_000;
    extEvidence.push({ n, code: r.body.code, extended: d?.extended, count: d?.extendCount, endDelta: d ? d.endTime - before : null });
    allExtOk = allExtOk && ok;
    if (!ok || !d) break;
    await waitUntil(d.endTime - 3500);
  }
  rep.check(
    "P8-1",
    "狙击延时",
    "3 次最后5秒出价均延时 +10s、extendCount 1→3",
    allExtOk,
    evidence(extEvidence),
  );

  // AUCTION_EXTENDED 事件（HTTP 兜底回放）
  const ev = (await ctx.admin!.events(mainAuctionId)).body.data ?? [];
  const extEvents = ev.filter((e: EventRow) => e.payload.includes("AUCTION_EXTENDED"));
  rep.check(
    "P8-2",
    "狙击延时",
    "events 中存在 3 条 AUCTION_EXTENDED（延时与出价同事务）",
    extEvents.length === 3,
    `实际=${extEvents.length}`,
  );

  // 第 4 次：仍可出价但不延时
  det = (await ctx.admin!.auctionDetail(mainAuctionId)).body.data!;
  const before4 = det.endTime!;
  await waitUntil(before4 - 3500);
  det = (await ctx.admin!.auctionDetail(mainAuctionId)).body.data!;
  const bi4 = ctx.rng.int(0, ctx.bots.length - 1);
  const r4 = await ctx.bots[bi4]!.bid(mainAuctionId, `sim-${ctx.cfg.tag}-snipe-4`, det.currentPrice + det.minIncrement);
  const d4 = r4.body.data;
  const capOk =
    r4.body.code === 0 &&
    d4?.extended === false &&
    d4?.extendCount === 3 &&
    d4?.endTime === before4;
  rep.check(
    "P8-3",
    "狙击延时",
    "第 4 次最后5秒出价：接受但不延时（maxExtends=3）",
    capOk,
    evidence({ code: r4.body.code, extended: d4?.extended, count: d4?.extendCount, endDelta: d4 ? d4.endTime - before4 : null }),
  );

  return allExtOk && extEvents.length === 3 && capOk;
}
