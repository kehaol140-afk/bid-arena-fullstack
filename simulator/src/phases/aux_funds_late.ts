import type { Ctx } from "../ctx.ts";
import { evidence } from "../reporter.ts";
import { sleep, waitUntil, pollUntil } from "../util.ts";

/**
 * P10 辅助拍卖：余额不足（精确边界）+ 迟到出价
 * - 管理员创建 8s 短拍卖；bot(N) 出价 L=可用余额-10（冻结后仅剩 10）
 * - 再出 L+20：最小价合法但需新增冻结 20 > 可用 10 → 400 code=2003，且无副作用
 * - 巨额出价（余额数量级之外）→ 2003
 * - 等待过期后在「RUNNING 未结算窗口」内出价 → 409 code=2004（若已被结算抢先则 2001，记录实际）
 */
export async function auxFundsLatePhase(ctx: Ctx): Promise<boolean> {
  const { rep, cfg, admin, bots } = ctx;
  console.log("\n== P10 余额不足（边界）与迟到出价（辅助拍卖）==");
  if (!admin) {
    for (const [id, name] of [
      ["P10-1", "领先者高价冻结后加价 → 2003（边界）"],
      ["P10-2", "巨额出价 → 2003"],
      ["P10-3", "2003 无资金副作用"],
      ["P10-4", "过期后出价 → 2004/2001（迟到）"],
    ] as const) {
      rep.notVerified(id, "余额/迟到", name, "依赖管理员登录（见 QA-001）");
    }
    return false;
  }

  const N = bots.length - 1; // 最后一个机器人承担资金边界场景
  const w0 = (await bots[N]!.wallet()).body.data!;
  const avail = w0.balance - w0.frozen;
  if (avail < 130) {
    rep.notVerified("P10-1", "余额/迟到", "余额边界场景", `bot 可用余额不足(${avail})，无法构造边界`);
    return false;
  }

  const c = await admin.adminCreateAuction({
    title: `sim-${cfg.tag} 辅助拍卖（余额/迟到）`,
    startPrice: 100,
    minIncrement: 10,
    durationSeconds: 8,
  });
  if (c.body.code !== 0 || !c.body.data?.auctionId) {
    rep.fail("P10-0", "余额/迟到", "创建辅助拍卖", evidence(c.body));
    return false;
  }
  const auxId = c.body.data.auctionId;
  ctx.auxAuctionId = auxId;
  await admin.adminStartAuction(auxId);
  await bots[N]!.join(auxId);

  // 领先价 L：冻结后仅剩 10（在可用余额内且 ≥ 最小合法出价 110）
  const L = avail - 10;
  const lead = await bots[N]!.bid(auxId, `sim-${cfg.tag}-aux-lead`, L);
  if (lead.body.code !== 0) {
    rep.fail("P10-0", "余额/迟到", "辅助拍卖领先出价", evidence(lead.body));
    return false;
  }

  // 边界加价：L+20（最小合法价= L+10，通过；需新增冻结 20 > 剩余 10）→ 2003
  const w1 = (await bots[N]!.wallet()).body.data!;
  const tryBoundary = await bots[N]!.bid(auxId, `sim-${cfg.tag}-aux-boundary`, L + 20);
  const r1 = tryBoundary.http === 400 && tryBoundary.body.code === 2003;
  rep.check(
    "P10-1",
    "余额/迟到",
    `领先 ${L} 后出 ${L + 20}：delta 20 > 可用 10 → 400/2003`,
    r1,
    evidence({ http: tryBoundary.http, body: tryBoundary.body, availAfterLead: w1.balance - w1.frozen }),
  );

  // 巨额出价 → 2003
  const huge = await bots[N]!.bid(auxId, `sim-${cfg.tag}-aux-huge`, w1.balance * 10);
  const r2 = huge.http === 400 && huge.body.code === 2003;
  rep.check("P10-2", "余额/迟到", `巨额出价 ${w1.balance * 10} → 400/2003`, r2, evidence({ http: huge.http, code: huge.body.code }));

  // 2003 无副作用
  const det = (await admin.auctionDetail(auxId)).body.data!;
  const w2 = (await bots[N]!.wallet()).body.data!;
  const r3 = det.currentPrice === L && w2.frozen === w1.frozen && w2.balance === w1.balance;
  rep.check(
    "P10-3",
    "余额/迟到",
    "两次 2003 后价格与钱包无变化",
    r3,
    evidence({ price: det.currentPrice, frozen: `${w1.frozen}->${w2.frozen}` }),
  );

  // 迟到出价：过期后 250ms 发出（结算扫描 1s 周期，大概率命中 RUNNING 已过期窗口）
  const d = (await admin.auctionDetail(auxId)).body.data!;
  await waitUntil((d.endTime ?? 0) + 250);
  const late = await bots[0]!.bid(auxId, `sim-${cfg.tag}-aux-late`, d.currentPrice + d.minIncrement);
  const lateAfter = (await admin.auctionDetail(auxId)).body.data!;
  const r4 =
    (late.http === 409 && late.body.code === 2004) ||
    (late.http === 409 && late.body.code === 2001 && lateAfter.status !== "RUNNING");
  rep.check(
    "P10-4",
    "余额/迟到",
    `过期后出价 → 2004（或已被结算 → 2001）：实际 code=${late.body.code}`,
    r4,
    evidence({ http: late.http, body: late.body, statusAfter: lateAfter.status }),
  );

  // 等辅助拍卖结算完成
  await pollUntil(
    async () => (await admin.auctionDetail(auxId)).body.data?.status === "FINISHED",
    15_000,
    400,
  );
  return r1 && r2 && r3 && r4;
}
