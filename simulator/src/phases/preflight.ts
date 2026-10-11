import { ApiClient } from "../api.ts";
import type { Ctx } from "../ctx.ts";
import { evidence } from "../reporter.ts";

/** P0 环境预检：后端可达性 + 健康接口契约形状（API_CONTRACT.md §8） */
export async function preflight(ctx: Ctx): Promise<boolean> {
  const { rep, cfg } = ctx;
  console.log("\n== P0 环境预检 ==");
  const probe = new ApiClient(cfg.baseUrl);
  let alive = false;
  try {
    const r = await probe.health();
    const shapeOk =
      r.http === 200 &&
      r.body.code === 0 &&
      r.body.data !== null &&
      typeof r.body.data?.status === "string";
    rep.check(
      "P0-1",
      "预检",
      "GET /api/v1/health 返回 code=0 且 data.status 为字符串",
      shapeOk && (r.body.data?.status as string) === "UP",
      evidence({ http: r.http, body: r.body }),
      `status=${r.body.data?.status}`,
    );
    alive = shapeOk;
  } catch (e) {
    rep.notVerified("P0-1", "预检", "GET /api/v1/health", `后端不可达: ${(e as Error).message}`);
  }
  return alive;
}
