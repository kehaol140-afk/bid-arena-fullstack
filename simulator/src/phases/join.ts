import type { Ctx } from "../ctx.ts";
import { evidence } from "../reporter.ts";
import { readWallet } from "./auction_setup.ts";

/**
 * P4 全员加入：20 机器人加入主拍卖
 * - 每人 POST /auctions/{id}/join → code=0
 * - participantCount 达到 20
 * - 抽 1 人重复 join → 幂等成功且计数不变
 */
export async function joinPhase(ctx: Ctx): Promise<void> {
  const { rep, bots, mainAuctionId } = ctx;
  console.log("\n== P4 全员加入 ==");
  if (!mainAuctionId) {
    rep.notVerified("P4-1", "加入", "20 用户加入成功", "无主拍卖（前置失败）");
    rep.notVerified("P4-2", "加入", "participantCount=20", "无主拍卖（前置失败）");
    rep.notVerified("P4-3", "加入", "重复 join 幂等且计数不变", "无主拍卖（前置失败）");
    return;
  }

  let ok = 0;
  const errs: string[] = [];
  for (let i = 0; i < bots.length; i++) {
    const r = await bots[i]!.join(mainAuctionId);
    if (r.body.code === 0) ok++;
    else errs.push(`bot${i + 1}:${r.body.code}`);
  }
  rep.check("P4-1", "加入", `${bots.length} 个机器人 join 成功`, ok === bots.length, errs.join(",") || "");

  const d = (await ctx.admin!.auctionDetail(mainAuctionId)).body.data;
  const countAfterJoin = d?.participantCount ?? -1;
  rep.check(
    "P4-2",
    "加入",
    `participantCount=${bots.length}`,
    countAfterJoin === bots.length,
    `实际=${countAfterJoin}`,
  );

  // 幂等重加入（第 1 个机器人）
  const again = await bots[0]!.join(mainAuctionId);
  const d2 = (await ctx.admin!.auctionDetail(mainAuctionId)).body.data;
  rep.check(
    "P4-3",
    "加入",
    "重复 join 幂等成功且 participantCount 不变",
    again.body.code === 0 && d2?.participantCount === countAfterJoin,
    evidence({ again: again.body, countAfter: d2?.participantCount }),
  );

  // 钱包未受 join 影响
  const w = await readWallet(ctx, 0);
  const base = ctx.baseline.get(ctx.botIds[0]!);
  rep.check(
    "P4-4",
    "加入",
    "加入不产生资金变动",
    !!w && !!base && w.balance === base.balance && w.frozen === base.frozen,
    evidence({ now: w, base }),
  );
}
