/**
 * CLI 与环境变量解析。
 * 用法：npm run simulate:auction -- --auctionId=1 --bots=20 --seed=42
 * 所有配置均可被同名环境变量覆盖（见根目录 .env.example）。
 */

export interface SimConfig {
  auctionId: number | null; // null = 由管理员现场创建专用测试拍卖
  bots: number; // 1..20
  seed: number;
  baseUrl: string;
  wsBase: string;
  adminEmail: string;
  adminPassword: string;
  botEmailPattern: string; // 含 %02d
  botPassword: string;
  mainDurationSeconds: number; // 现场创建主拍卖时的时长
  jsonReport: string | null;
  tag: string; // 报告标签（区分运行）
}

function parseArgs(argv: string[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const a of argv) {
    const eq = a.indexOf("=");
    if (a.startsWith("--") && eq > 2) {
      m.set(a.slice(2, eq), a.slice(eq + 1));
    }
  }
  return m;
}

function num(v: string | undefined, def: number | null): number | null {
  if (v === undefined || v === "") return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

export function loadConfig(argv: string[]): SimConfig {
  const args = parseArgs(argv);
  const env = process.env;
  const bots = num(args.get("bots") ?? env.BID_BOTS, 20)!;
  if (bots < 1 || bots > 20) {
    throw new Error(`--bots 必须在 1..20（种子账号 bot_01..bot_20）`);
  }
  return {
    auctionId: num(args.get("auctionId") ?? env.BID_AUCTION_ID, null),
    bots,
    seed: num(args.get("seed") ?? env.BID_SEED, 42)!,
    baseUrl: (args.get("baseUrl") ?? env.BID_API_BASE ?? "http://127.0.0.1:8090").replace(/\/+$/, ""),
    wsBase: (args.get("wsBase") ?? env.BID_WS_BASE ?? "ws://127.0.0.1:8091").replace(/\/+$/, ""),
    adminEmail: args.get("adminEmail") ?? env.BID_ADMIN_EMAIL ?? "admin@example.com",
    adminPassword: args.get("adminPassword") ?? env.BID_ADMIN_PASSWORD ?? "Admin123456!",
    botEmailPattern: args.get("botPattern") ?? env.BID_BOT_EMAIL_PATTERN ?? "bot_%02d@example.com",
    botPassword: args.get("botPassword") ?? env.BID_BOT_PASSWORD ?? "Test123456!",
    mainDurationSeconds: num(args.get("duration") ?? env.BID_MAIN_DURATION, 75)!,
    jsonReport: args.get("json") ?? null,
    tag: args.get("tag") ?? `run-${new Date().toISOString().replace(/[:.]/g, "-")}`,
  };
}

export function botEmail(cfg: SimConfig, i: number): string {
  // i 为 1 基序号
  return cfg.botEmailPattern.replace("%02d", String(i).padStart(2, "0"));
}
