/**
 * Bid Arena 多人拍卖模拟器（黑盒）。
 *
 * 用法（仓库根目录）：
 *   npm run simulate:auction -- --auctionId=1 --bots=20 --seed=42
 *
 * 阶段：
 *   P0 环境预检 → P1 认证冒烟 → P2 拍卖只读契约
 *   →（C2）加入/递增/并发/幂等/余额/低价/狙击延时/迟到/断线重连/结算核对
 *
 * 输出：每条检查 PASS/FAIL/NOT_VERIFIED + 汇总 + 可选 JSON 报告（--json=path）。
 * 退出码：0=无 FAIL；1=有 FAIL；2=环境不可用。
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
  } catch (e) {
    if (e instanceof NetworkError) {
      rep.notVerified("P0-9", "预检", "网络层中断", e.message);
      rep.printSummary();
      return 2;
    }
    throw e;
  }

  rep.printSummary();
  if (cfg.jsonReport) {
    mkdirSync(dirname(cfg.jsonReport), { recursive: true });
    writeFileSync(cfg.jsonReport, rep.toJson(), "utf8");
    console.log(`JSON 报告已写入 ${cfg.jsonReport}`);
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
