import type { Ctx } from "../ctx.ts";
import { evidence } from "../reporter.ts";
import { botEmail } from "../config.ts";
import type { WalletData } from "../api.ts";

/**
 * P3 场景准备：
 * - 解析主拍卖：--auctionId 指定则使用该拍卖（DRAFT→启动；RUNNING 直接用；其他状态报错）；
 *   未指定则管理员创建专用短时长拍卖（startPrice=100, minIncrement=10, duration=cfg）
 * - 记录 20 个机器人钱包基线（balance/frozen，供结算对账）
 * - 记录开跑 seq
 */
export async function setupPhase(ctx: Ctx): Promise<boolean> {
  const { rep, cfg, admin, bots } = ctx;
  console.log("\n== P3 场景准备（主拍卖）==");
  if (!admin || bots.length === 0) {
    rep.notVerified("P3-1", "准备", "主拍卖就绪（DRAFT→RUNNING 或已 RUNNING）", "依赖管理员登录（见 QA-001）");
    rep.notVerified("P3-2", "准备", "机器人钱包基线采集", "依赖登录（见 QA-001）");
    return false;
  }

  // 钱包基线（在任何出价前）
  let baseOk = true;
  const lines: string[] = [];
  for (let i = 0; i < bots.length; i++) {
    const w = await bots[i]!.wallet();
    const d = w.body.data;
    if (w.body.code === 0 && d) {
      ctx.baseline.set(ctx.botIds[i]!, { balance: d.balance, frozen: d.frozen });
    } else {
      baseOk = false;
      lines.push(`${botEmail(cfg, i + 1)}: ${evidence(w.body)}`);
    }
  }
  rep.check("P3-2", "准备", `${bots.length} 个机器人钱包基线采集`, baseOk, lines.join(" | "));

  let id: number;
  if (cfg.auctionId !== null) {
    const d = await admin.auctionDetail(cfg.auctionId);
    const det = d.body.data;
    if (d.body.code !== 0 || !det) {
      rep.fail("P3-1", "准备", `指定拍卖 ${cfg.auctionId} 可读取`, evidence(d.body));
      return false;
    }
    if (det.status === "RUNNING") {
      rep.pass("P3-1", "准备", "主拍卖已处 RUNNING", `id=${det.id} currentPrice=${det.currentPrice}`);
      id = det.id;
    } else if (det.status === "DRAFT") {
      const s = await admin.adminStartAuction(det.id);
      const sd = s.body.data;
      rep.check(
        "P3-1",
        "准备",
        "DRAFT 拍卖经 POST /admin/auctions/{id}/start 启动",
        s.body.code === 0 && sd?.status === "RUNNING" && !!sd?.endTime,
        evidence(s.body),
        `endTime=${sd?.endTime}`,
      );
      if (s.body.code !== 0) return false;
      id = det.id;
    } else {
      rep.fail("P3-1", "准备", `指定拍卖状态=${det.status}，需 DRAFT/RUNNING`, `title=${det.title}`);
      return false;
    }
  } else {
    const c = await admin.adminCreateAuction({
      title: `sim-${cfg.tag} 主拍卖（20人全场景）`,
      description: "simulator created",
      startPrice: 100,
      minIncrement: 10,
      durationSeconds: cfg.mainDurationSeconds,
    });
    if (c.body.code !== 0 || !c.body.data?.auctionId) {
      rep.fail("P3-1", "准备", "管理员创建主拍卖", evidence(c.body));
      return false;
    }
    id = c.body.data.auctionId;
    const s = await admin.adminStartAuction(id);
    const sd = s.body.data;
    rep.check(
      "P3-1",
      "准备",
      "现场创建并启动主拍卖",
      s.body.code === 0 && sd?.status === "RUNNING" && !!sd?.endTime,
      evidence(s.body),
      `id=${id} duration=${cfg.mainDurationSeconds}s`,
    );
    if (s.body.code !== 0) return false;
  }
  ctx.mainAuctionId = id;

  const det = (await admin.auctionDetail(id)).body.data;
  if (det) ctx.mainStartSeq = det.seq;
  return true;
}

/** 结算后调用的共享钱包读取（供对账阶段） */
export async function readWallet(ctx: Ctx, botIndex: number): Promise<WalletData | null> {
  const r = await ctx.bots[botIndex]!.wallet();
  return r.body.code === 0 ? r.body.data : null;
}
