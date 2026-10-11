import { ApiClient } from "../api.ts";
import type { Ctx } from "../ctx.ts";
import { botEmail } from "../config.ts";
import { evidence } from "../reporter.ts";

/**
 * P1 认证冒烟（API_CONTRACT.md §1）：
 * - 管理员登录 + /users/me 角色校验
 * - N 个机器人账号登录 + id 归属校验
 * - 错误密码 → 401 code=1001
 * - 登出后旧 token 失效（一次性会话验证，不影响后续阶段）
 */
export async function authPhase(ctx: Ctx): Promise<boolean> {
  const { rep, cfg } = ctx;
  console.log("\n== P1 认证冒烟 ==");

  // 管理员
  const admin = new ApiClient(cfg.baseUrl);
  const al = await admin.login(cfg.adminEmail, cfg.adminPassword);
  const adminOk = al.body.code === 0 && !!al.body.data?.token && al.body.data.user?.role === "ADMIN";
  if (!adminOk) {
    // 契约要求种子管理员可登录；失败=真实缺陷（证据入 QA_BLOCKERS），依赖项全部 NOT_VERIFIED
    rep.fail("P1-1", "认证", "管理员登录成功且 role=ADMIN", evidence(al.body));
    ctx.blocked = `管理员登录失败：HTTP ${al.http} ${evidence(al.body)}（对照 QA_BLOCKERS QA-001）`;
    for (const [id, name] of [
      ["P1-2", "GET /users/me（管理员）"],
      ["P1-3", "错误密码 → 401/1001"],
      ["P1-4", "机器人账号批量登录"],
      ["P1-5", "登出后旧 token 失效"],
    ] as const) {
      rep.notVerified(id, "认证", name, "依赖登录（见 QA-001）");
    }
    return false;
  }
  rep.pass("P1-1", "认证", "管理员登录成功且 role=ADMIN", `userId=${al.body.data!.user.id}`);
  const am = await admin.me();
  rep.check(
    "P1-2",
    "认证",
    "GET /users/me（管理员 token）返回本人",
    am.body.code === 0 && am.body.data?.email === cfg.adminEmail,
    evidence(am.body),
  );
  ctx.admin = admin;

  // 错误密码
  const bad = new ApiClient(cfg.baseUrl);
  const bl = await bad.login(cfg.botEmailPattern.replace("%02d", "01"), "WrongPassword!");
  rep.check(
    "P1-3",
    "认证",
    "错误密码 → HTTP 401 / code=1001",
    bl.http === 401 && bl.body.code === 1001,
    evidence({ http: bl.http, body: bl.body }),
  );

  // 机器人批量登录
  let okCount = 0;
  const failLines: string[] = [];
  for (let i = 1; i <= cfg.bots; i++) {
    const email = botEmail(cfg, i);
    const c = new ApiClient(cfg.baseUrl);
    const r = await c.login(email, cfg.botPassword);
    if (r.body.code === 0 && r.body.data?.token) {
      ctx.bots.push(c);
      ctx.botEmails.push(email);
      ctx.botIds.push(r.body.data.user.id);
      okCount++;
    } else {
      failLines.push(`${email}: ${evidence(r.body)}`);
    }
  }
  rep.check(
    "P1-4",
    "认证",
    `${cfg.bots} 个机器人账号全部登录成功`,
    okCount === cfg.bots,
    failLines.join(" | ") || `ok=${okCount}`,
  );
  if (okCount !== cfg.bots) return false;

  // 一次性会话：登录→登出→旧 token 失效
  const throwaway = new ApiClient(cfg.baseUrl);
  const tl = await throwaway.login(ctx.botEmails[0]!, cfg.botPassword);
  const tok = tl.body.data?.token ?? "";
  const t2 = new ApiClient(cfg.baseUrl);
  t2.setToken(tok);
  const before = await t2.me();
  const lo = await t2.logout();
  const after = await t2.me();
  rep.check(
    "P1-5",
    "认证",
    "登出后旧 token 访问 /users/me → 401 code=1001",
    before.body.code === 0 && lo.body.code === 0 && after.http === 401 && after.body.code === 1001,
    evidence({ before: before.body.code, logout: lo.body.code, after: { http: after.http, code: after.body.code } }),
  );

  return true;
}
