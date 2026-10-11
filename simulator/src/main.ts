/**
 * Bid Arena 多人拍卖模拟器（黑盒）。
 *
 * 用法（仓库根目录）：
 *   npm run simulate:auction -- --auctionId=1 --bots=20 --seed=42
 *
 * 阶段：
 *   P0 健康预检 → P1 认证冒烟 → P2 拍卖只读契约
 *   P3 场景准备 → P4 全员加入 → P5 递增出价 → P6 并发（同价/相邻/同requestId）
 *   P7 幂等与低价拒绝 → P9 WS 断线重连 → P8 最后5秒狙击与延时上限
 *   P11 主拍卖结算 → P10 辅助拍卖（余额不足边界 + 迟到出价） → P12 全量对账
 *
 * 输出：每条检查 PASS/FAIL/NOT_VERIFIED + 汇总 + JSON 报告（--json=path 或默认 reports/）。
 * 退出码：0=无 FAIL；1=有 FAIL；2=环境不可达。
 * 本工具只调用公开 HTTP/WS 接口，绝不直连数据库或修改业务数据。
 */
import { loadConfig } from "./config.ts";
import { Rng } from "./rng.ts";
import { Reporter } from "./reporter.ts";
import { newCtx } from "./ctx.ts";
import { NetworkError } from "./api.ts";
import { preflight } from "./phases/preflight.ts";
import { authPhase } from "./phases/auth.ts";
import { auctionReadPhase } from "./phases/auction_read.ts";
import { setupPhase } from "./phases/auction_setup.ts";
import { joinPhase } from "./phases/join.ts";
import { incrementPhase } from "./phases/increment.ts";
import { concurrentPhase } from "./phases/concurrent.ts";
import { idempotencyRejectPhase } from "./phases/idempotency.ts";
import { reconnectPhase } from "./phases/reconnect.ts";
import { snipePhase } from "./phases/snipe.ts";
import { settlePhase } from "./phases/settle.ts";
import { auxFundsLatePhase } from "./phases/aux_funds_late.ts";
import { reconcilePhase } from "./phases/reconcile.ts";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

async function main(): Promise<number> {
  const cfg = loadConfig(process.argv.slice(2));
  console.log(`Bid Arena 模拟器 tag=${cfg.tag}`);
  console.log(`  后端 ${cfg.baseUrl}  WS ${cfg.wsBase}`);
  console.log(`  bots=${cfg.bots} seed=${cfg.seed} auctionId=${cfg.auctionId ?? "(现场创建)"}`);

  const rep = new Reporter({
    tool: "bid-arena-simulator",
    baseUrl: cfg.baseUrl,
    wsBase: cfg.wsBase,
    bots: cfg.bots,
    seed: cfg.seed,
    requestedAuctionId: cfg.auctionId,
  });
  const ctx = newCtx(cfg, new Rng(cfg.seed), rep);

  try {
    if (!(await preflight(ctx))) {
      rep.printSummary();
      return 2;
    }
    await authPhase(ctx);
    await auctionReadPhase(ctx);
    if (await setupPhase(ctx)) {
      await joinPhase(ctx);
      await incrementPhase(ctx);
      await concurrentPhase(ctx);
      await idempotencyRejectPhase(ctx);
      await reconnectPhase(ctx); // QA-005 未修复时自动 NOT_VERIFIED
      await snipePhase(ctx);
      await settlePhase(ctx);
      await auxFundsLatePhase(ctx);
    } else {
      for (const ph of [joinPhase, incrementPhase, concurrentPhase, idempotencyRejectPhase, reconnectPhase, snipePhase, settlePhase, auxFundsLatePhase]) {
        await ph(ctx); // 各阶段自守卫：前置失败 → NOT_VERIFIED
      }
    }
    await reconcilePhase(ctx);
  } catch (e) {
    if (e instanceof NetworkError) {
      rep.notVerified("P0-9", "预检", "网络层中断", e.message);
      rep.printSummary();
      return 2;
    }
    console.error("阶段异常（计入 FAIL 证据）：", e);
    rep.fail("PX-9", "全局", "模拟器执行中异常", String(e));
  }

  rep.printSummary();
  const out = cfg.jsonReport ?? `simulator/reports/sim-${cfg.tag}.json`;
  try {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, rep.toJson(), "utf8");
    console.log(`JSON 报告已写入 ${out}`);
  } catch (e) {
    console.error(`JSON 报告写入失败: ${(e as Error).message}`);
  }
  return rep.hasFail ? 1 : 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((e) => {
    console.error("模拟器异常退出:", e);
    process.exitCode = 1;
  });
