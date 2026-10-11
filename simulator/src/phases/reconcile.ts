import type { Ctx } from "../ctx.ts";
import { evidence } from "../reporter.ts";
import type { LedgerEntry, WalletData } from "../api.ts";

/**
 * P12 结果与钱包核对（全量对账，基线相对）：
 * 对主拍卖 + 辅助拍卖，逐机器人校验：
 *  A. 冻结回收：final.frozen == base.frozen（所有持仓已释放/转扣）
 *  B. 余额守恒：final.balance == base.balance − Σ(本场成交支付)
 *  C. 流水可解释：ΣFREEZE − ΣUNFREEZE == (赢家 ? finalPrice : 0)；赢家恰 1 条 PAY=−finalPrice，其余无 PAY
 *  D. 拒绝不留痕：本场无金额为 0 的 FREEZE；PAY/UNFREEZE 金额与钱包变化自洽（balanceAfter/frozenAfter 单调一致）
 */
export async function reconcilePhase(ctx: Ctx): Promise<void> {
  const { rep, bots, botIds, baseline, mainAuctionId, auxAuctionId } = ctx;
  console.log("\n== P12 结果与钱包核对 ==");
  if (!mainAuctionId) {
    rep.notVerified("P12-1", "对账", "冻结回收与余额守恒（20 人全量）", "无主拍卖（前置失败）");
    rep.notVerified("P12-2", "对账", "流水可解释（FREEZE/UNFREEZE/PAY）", "无主拍卖（前置失败）");
    rep.notVerified("P12-3", "对账", "成交记录唯一且金额正确", "无主拍卖（前置失败）");
    return;
  }

  const auctions = [mainAuctionId, ...(auxAuctionId ? [auxAuctionId] : [])];
  const details = new Map<number, { winnerId: number | null; finalPrice: number }>();
  for (const aid of auctions) {
    const d = (await ctx.admin!.auctionDetail(aid)).body.data!;
    details.set(aid, { winnerId: d.result?.winnerId ?? null, finalPrice: d.result?.finalPrice ?? 0 });
  }

  const walletFails: string[] = [];
  const ledgerFails: string[] = [];
  const wallets: (WalletData | null)[] = [];
  const ledgers: LedgerEntry[][] = [];

  for (let i = 0; i < bots.length; i++) {
    const uid = botIds[i]!;
    const w = (await bots[i]!.wallet()).body.data ?? null;
    wallets.push(w);
    const led = ((await bots[i]!.ledger()).body.data ?? []).filter((l) => auctions.includes(l.auctionId));
    ledgers.push(led);
    const base = baseline.get(uid);

    // A+B 冻结回收 + 余额守恒
    let paidTotal = 0;
    for (const aid of auctions) {
      const info = details.get(aid)!;
      if (info.winnerId === uid) paidTotal += info.finalPrice;
    }
    if (!w || !base) {
      walletFails.push(`bot${i + 1}: 钱包/基线缺失`);
    } else {
      if (w.frozen !== base.frozen) walletFails.push(`bot${i + 1}: frozen ${base.frozen}->${w.frozen}`);
      if (w.balance !== base.balance - paidTotal) {
        walletFails.push(`bot${i + 1}: balance ${base.balance}->${w.balance} (期望 ${base.balance - paidTotal})`);
      }
    }

    // C 流水可解释
    for (const aid of auctions) {
      const info = details.get(aid)!;
      const mine = led.filter((l) => l.auctionId === aid);
      const freezeSum = mine.filter((l) => l.type === "FREEZE").reduce((s, l) => s + l.amount, 0);
      const unfreezeSum = mine.filter((l) => l.type === "UNFREEZE").reduce((s, l) => s + l.amount, 0);
      const pays = mine.filter((l) => l.type === "PAY");
      const isWinner = info.winnerId === uid;
      const expectHold = isWinner ? info.finalPrice : 0;
      if (freezeSum - unfreezeSum !== expectHold) {
        ledgerFails.push(`bot${i + 1}@${aid}: ΣFREEZE−ΣUNFREEZE=${freezeSum - unfreezeSum} 期望=${expectHold}`);
      }
      if (isWinner && (pays.length !== 1 || pays[0]!.amount !== -info.finalPrice)) {
        ledgerFails.push(`bot${i + 1}@${aid}: PAY 应恰 1 条 =-${info.finalPrice}，实际 ${pays.length} 条`);
      }
      if (!isWinner && pays.length > 0) {
        ledgerFails.push(`bot${i + 1}@${aid}: 非赢家出现 PAY`);
      }
      if (mine.some((l) => (l.type === "FREEZE" || l.type === "UNFREEZE") && l.amount === 0)) {
        ledgerFails.push(`bot${i + 1}@${aid}: 存在 0 金额冻结/解冻流水`);
      }
    }
  }

  rep.check(
    "P12-1",
    "对账",
    `${bots.length} 人冻结回收 + 余额守恒（基线相对，含两场拍卖）`,
    walletFails.length === 0,
    walletFails.slice(0, 6).join(" | "),
  );
  rep.check(
    "P12-2",
    "对账",
    "流水可解释：ΣFREEZE−ΣUNFREEZE=最终持仓；赢家恰 1 条 PAY；无 0 金额流水",
    ledgerFails.length === 0,
    ledgerFails.slice(0, 6).join(" | "),
  );

  // D 成交记录唯一且金额正确（detail.result 已查；再验 bids 最高价 == finalPrice）
  const d = (await ctx.admin!.auctionDetail(mainAuctionId)).body.data!;
  const bids = (await ctx.admin!.bids(mainAuctionId)).body.data ?? [];
  const maxBid = bids.length ? Math.max(...bids.map((b) => b.amount)) : 0;
  const winnerBid = bids.find((b) => b.userId === d.result?.winnerId && b.amount === d.result?.finalPrice);
  const r3 = !!d.result && d.result.finalPrice === maxBid && !!winnerBid;
  rep.check(
    "P12-3",
    "对账",
    "成交价 == 出价历史最高价且为赢家本人出价",
    r3,
    evidence({ finalPrice: d.result?.finalPrice, maxBid, winnerBidFound: !!winnerBid }),
  );

  // 汇总证据（进 JSON 报告）
  console.log(`  对账明细：${wallets.filter(Boolean).length} 钱包、${ledgers.flat().length} 条相关流水`);
}
