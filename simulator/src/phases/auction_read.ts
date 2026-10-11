import type { Ctx } from "../ctx.ts";
import { evidence } from "../reporter.ts";
import type { AuctionDetail } from "../api.ts";

/** 契约要求的 detail 必备字段（API_CONTRACT.md §3） */
const REQUIRED_FIELDS: (keyof AuctionDetail)[] = [
  "id",
  "title",
  "status",
  "startPrice",
  "minIncrement",
  "currentPrice",
  "durationSeconds",
  "extendCount",
  "maxExtends",
  "seq",
];

/**
 * P2 拍卖只读契约映射：
 * - GET /api/v1/auctions 列表形状与倒序
 * - 指定 --auctionId 时校验 detail 字段完整性
 */
export async function auctionReadPhase(ctx: Ctx): Promise<void> {
  const { rep, cfg, admin } = ctx;
  console.log("\n== P2 拍卖只读契约映射 ==");
  if (!admin) {
    rep.notVerified("P2-1", "拍卖读取", "GET /api/v1/auctions 返回数组", "无已认证客户端（见 QA-001）");
    rep.notVerified("P2-2", "拍卖读取", "列表按 id 倒序", "依赖认证（见 QA-001）");
    rep.notVerified("P2-3", "拍卖读取", "auction detail 字段完整性", "依赖认证（见 QA-001）");
    return;
  }

  const list = await admin.auctions();
  const arr = list.body.data;
  const shapeOk = list.http === 200 && Array.isArray(arr);
  rep.check("P2-1", "拍卖读取", "GET /api/v1/auctions 返回数组", shapeOk, evidence({ http: list.http, code: list.body.code }));

  if (shapeOk && (arr as AuctionDetail[]).length >= 2) {
    const ids = (arr as AuctionDetail[]).map((a) => a.id);
    const sorted = [...ids].sort((a, b) => b - a);
    rep.check("P2-2", "拍卖读取", "列表按 id 倒序", JSON.stringify(ids) === JSON.stringify(sorted), `ids=${ids.slice(0, 8).join(",")}…`);
  } else {
    rep.notVerified("P2-2", "拍卖读取", "列表按 id 倒序", `列表元素不足（${arr?.length ?? 0}），无法判定顺序`);
  }

  const target = cfg.auctionId ?? arr?.[0]?.id ?? null;
  if (target === null) {
    rep.notVerified("P2-3", "拍卖读取", "auction detail 字段完整性", "系统中无任何拍卖");
    return;
  }
  const d = await admin.auctionDetail(target);
  const det = d.body.data;
  const missing = det ? REQUIRED_FIELDS.filter((f) => det[f] === undefined) : REQUIRED_FIELDS;
  rep.check(
    "P2-3",
    "拍卖读取",
    `GET /api/v1/auctions/${target} 必备字段齐全`,
    d.http === 200 && d.body.code === 0 && missing.length === 0,
    missing.length ? `缺失字段: ${missing.join(",")}` : `status=${det?.status} startPrice=${det?.startPrice} minIncrement=${det?.minIncrement}`,
  );
  if (det) ctx.mainAuctionId = det.id;
}
