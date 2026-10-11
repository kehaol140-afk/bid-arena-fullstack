import type { SimConfig } from "./config.ts";
import type { Rng } from "./rng.ts";
import type { Reporter } from "./reporter.ts";
import type { ApiClient } from "./api.ts";

/** 跨阶段共享上下文（由各阶段逐步填充） */
export interface Ctx {
  cfg: SimConfig;
  rng: Rng;
  rep: Reporter;
  admin: ApiClient | null;
  bots: ApiClient[]; // 已登录，index 0 = bot_01
  botEmails: string[];
  botIds: number[]; // 与 bots 对齐（来自 /users/me）
  mainAuctionId: number | null;
  auxAuctionId: number | null;
  baseline: Map<number, { balance: number; frozen: number }>; // userId -> 开跑前钱包
  mainStartSeq: number; // 主拍卖开跑时 seq
  blocked: string | null; // 非空 = 环境级阻塞（后续阶段自动 NOT_VERIFIED）
}

export function newCtx(cfg: SimConfig, rng: Rng, rep: Reporter): Ctx {
  return {
    cfg,
    rng,
    rep,
    admin: null,
    bots: [],
    botEmails: [],
    botIds: [],
    mainAuctionId: null,
    auxAuctionId: null,
    baseline: new Map(),
    mainStartSeq: 0,
    blocked: null,
  };
}
