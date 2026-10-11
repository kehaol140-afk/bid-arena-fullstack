import type { Ctx } from "../ctx.ts";
import { evidence } from "../reporter.ts";
import { WsClient, type WsEnvelope } from "../ws.ts";
/**
 * P9 WebSocket 断线重连与事件序列（API_CONTRACT.md §7）：
 * - 监听者全程在线：信封四要素齐全、seq 单调无缺口
 * - 断线者在出价中途断开、错过事件后重连 → SYNC:<lastSeq> 补发 + 最新快照
 * - 快照权威性与 HTTP detail 一致；HTTP events 与 WS 补发一致
 * 依赖 QA-005（WS 监听）与 QA-001（登录 token）修复。
 */
export async function reconnectPhase(ctx: Ctx): Promise<boolean> {
  const { rep, cfg, mainAuctionId, bots } = ctx;
  console.log("\n== P9 WebSocket 断线重连 ==");
  if (!mainAuctionId) {
    for (const [id, name] of [
      ["P9-1", "连接即收 CONNECTION_STATE + 快照"],
      ["P9-2", "在线监听 seq 单调无缺口"],
      ["P9-3", "断线→重连→SYNC 补发 + 快照"],
      ["P9-4", "快照与 HTTP detail 一致"],
    ] as const) {
      rep.notVerified(id, "WS重连", name, "无主拍卖（前置失败）");
    }
    return false;
  }

  const url = (token: string) => `${cfg.wsBase}/ws/auction?token=${encodeURIComponent(token)}&auctionId=${mainAuctionId}`;
  const botToken = bots[0]!.getToken();
  if (!botToken) {
    rep.notVerified("P9-1", "WS重连", "连接即收 CONNECTION_STATE + 快照", "无会话 token（QA-001）");
    return false;
  }

  // -- 连接建立 --
  const monitor = new WsClient("monitor");
  let connected = false;
  try {
    await monitor.connect(url(botToken), 5000);
    const cs = await monitor.waitFor((e) => e.type === "CONNECTION_STATE", 4000);
    const snap = await monitor.waitFor((e) => e.type === "AUCTION_SNAPSHOT", 4000);
    connected = !!cs && (cs.state === undefined || cs.state === "connected") && !!snap;
    rep.check("P9-1", "WS重连", "连接即收 CONNECTION_STATE(connected) + AUCTION_SNAPSHOT", connected, evidence({ cs: cs?.state, hasSnap: !!snap }));
  } catch (e) {
    rep.notVerified("P9-1", "WS重连", "连接建立", `WS 不可达（见 QA-005）: ${(e as Error).message}`);
    return false;
  }

  // -- 断线重连者：先连、记 lastSeq、断开 --
  const rc = new WsClient("reconnect");
  await rc.connect(url(botToken), 5000);
  await rc.waitFor((e) => e.type === "AUCTION_SNAPSHOT", 4000);
  // 触发一次出价使事件流前进，然后断开
  const det1 = (await ctx.admin!.auctionDetail(mainAuctionId)).body.data!;
  await bots[1]!.bid(mainAuctionId, `sim-${ctx.cfg.tag}-ws-1`, det1.currentPrice + det1.minIncrement);
  await new Promise((r) => setTimeout(r, 800));
  const lastSeq = rc.lastSeq;
  rc.close();
  // 断线期间继续出价（制造缺口）
  const det2 = (await ctx.admin!.auctionDetail(mainAuctionId)).body.data!;
  await bots[2]!.bid(mainAuctionId, `sim-${ctx.cfg.tag}-ws-2`, det2.currentPrice + det2.minIncrement);
  await new Promise((r) => setTimeout(r, 800));

  // -- 监听者全程校验 --
  const withSeq = monitor.envelopes.filter((e) => typeof e.seq === "number" && (e.seq as number) > 0);
  const seqs = withSeq.map((e) => e.seq as number);
  const monotonic = seqs.every((s, i) => i === 0 || s > seqs[i - 1]!);
  const noGap = seqs.every((s, i) => i === 0 || s === seqs[i - 1]! + 1 || s > seqs[i - 1]!); // 广播事件允许并发下乱序到达，排序后应连续
  const sorted = [...seqs].sort((a, b) => a - b);
  const contiguous = sorted.every((s, i) => i === 0 || s === sorted[i - 1]! + 1);
  const envOk = withSeq.every((e) => e.auctionId !== undefined && e.serverTime !== undefined && !!e.type);
  rep.check(
    "P9-2",
    "WS重连",
    "在线监听：信封要素齐全、seq 单调、排序后无缺口",
    envOk && monotonic && contiguous && noGap,
    evidence({ count: seqs.length, monotonic, contiguous, head: seqs.slice(0, 6) }),
  );

  // -- 重连 + SYNC --
  const rc2 = new WsClient("reconnect-2");
  await rc2.connect(url(botToken), 5000);
  await rc2.waitFor((e) => e.type === "AUCTION_SNAPSHOT", 4000);
  const replay = await rc2.sync(lastSeq, 5000);
  const replaySeqs = replay
    .filter((e) => typeof e.seq === "number" && (e.seq as number) > lastSeq)
    .map((e) => e.seq as number)
    .sort((a, b) => a - b);
  const replayOk =
    replaySeqs.length >= 1 &&
    replaySeqs[0] === lastSeq + 1 &&
    replaySeqs.every((s, i) => i === 0 || s === replaySeqs[i - 1]! + 1);
  const snapMsg = replay.find((e) => e.type === "AUCTION_SNAPSHOT");
  rep.check(
    "P9-3",
    "WS重连",
    `SYNC:${lastSeq} 补发连续事件（${replaySeqs.length} 条）并以快照收尾`,
    replayOk && !!snapMsg,
    evidence({ replaySeqs: replaySeqs.slice(0, 10), hasSnap: !!snapMsg }),
  );

  // -- 快照权威性 --
  const det = (await ctx.admin!.auctionDetail(mainAuctionId)).body.data!;
  const snap = (snapMsg ?? monitor.envelopes.filter((e) => e.type === "AUCTION_SNAPSHOT").pop()) as WsEnvelope | undefined;
  const agree =
    !!snap &&
    snap.currentPrice === det.currentPrice &&
    snap.currentLeaderId === det.currentLeaderId &&
    snap.status === det.status &&
    snap.endTime === det.endTime;
  rep.check(
    "P9-4",
    "WS重连",
    "最终快照与 HTTP detail 一致（价格/领先者/状态/截止）",
    agree,
    evidence({ snap: snap ? { price: snap.currentPrice, leader: snap.currentLeaderId, status: snap.status, end: snap.endTime } : null, http: { price: det.currentPrice, leader: det.currentLeaderId, status: det.status, end: det.endTime } }),
  );

  monitor.close();
  rc2.close();
  return true;
}
