// Live-stack demo verification against http://127.0.0.1:8090 + ws://127.0.0.1:8091
// Checks: admin login, auction create+start, user join+bid, WebSocket cross-user push,
// wallet balance/frozen changes + ledger. Run while start-local stack is UP.
const API = "http://127.0.0.1:8090";
const WS = "ws://127.0.0.1:8091";

const results = [];
function step(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name} :: ${detail}`);
}
async function api(method, path, body, token) {
  const res = await fetch(API + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { http: res.status, body: await res.json().catch(() => null) };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // 1) admin login
  const admin = await api("POST", "/api/v1/auth/login", { email: "admin@example.com", password: "Admin123456!" });
  const adminTok = admin.body?.data?.token;
  step("admin login", admin.body?.code === 0 && !!adminTok, `http=${admin.http}`);

  // 2) create + start demo auction (admin)
  const cr = await api("POST", "/api/v1/admin/auctions",
    { title: `演示拍卖-STARTLOCAL-${Date.now()}`, durationSeconds: 300, startPrice: 100, minIncrement: 10 }, adminTok);
  const aid = cr.body?.data?.auctionId;
  step("admin create auction", cr.body?.code === 0 && !!aid, `auctionId=${aid}`);
  const st = await api("POST", `/api/v1/admin/auctions/${aid}/start`, {}, adminTok);
  step("admin start auction", st.body?.code === 0 && st.body?.data?.status === "RUNNING", `status=${st.body?.data?.status}`);

  // 3) bidder_a login + wallet before
  const la = await api("POST", "/api/v1/auth/login", { email: "bidder_a@example.com", password: "Test123456!" });
  const tokA = la.body?.data?.token;
  step("bidder_a login", la.body?.code === 0 && !!tokA, "");
  const wBefore = await api("GET", "/api/v1/wallets/me", null, tokA);
  const before = wBefore.body?.data;
  step("bidder_a wallet before", wBefore.body?.code === 0, `balance=${before?.balance} frozen=${before?.frozen}`);

  // 4) join auction as bidder_a
  const join = await api("POST", `/api/v1/auctions/${aid}/join`, {}, tokA);
  step("bidder_a join auction", join.body?.code === 0, `http=${join.http}`);

  // 5) WebSocket connect as bidder_a
  const wsUrl = `${WS}/ws/auction?token=${encodeURIComponent(tokA)}&auctionId=${aid}`;
  const ws = new WebSocket(wsUrl);
  const wsEvents = [];
  let wsOpen = false;
  await new Promise((res) => { ws.onopen = () => { wsOpen = true; res(); }; ws.onerror = () => res(); setTimeout(res, 8000); });
  step("WebSocket connected (bidder_a)", wsOpen, wsUrl.slice(0, 60) + "...");
  ws.onmessage = (e) => { try { wsEvents.push(JSON.parse(e.data)); } catch {} };

  await sleep(500);
  // 6) bidder_a bids 110 via HTTP (real user bid)
  const b1 = await api("POST", `/api/v1/auctions/${aid}/bids`, { requestId: `startlocal-a-${aid}`, amount: 110 }, tokA);
  step("bidder_a bid 110", b1.body?.code === 0 && b1.body?.data?.currentPrice === 110, `price=${b1.body?.data?.currentPrice}`);

  // 7) cross-user: bidder_b bids 150 via HTTP -> must arrive on A's WebSocket
  const lb = await api("POST", "/api/v1/auth/login", { email: "bidder_b@example.com", password: "Test123456!" });
  const tokB = lb.body?.data?.token;
  await api("POST", `/api/v1/auctions/${aid}/join`, {}, tokB);
  const wBeforeB = await api("GET", "/api/v1/wallets/me", null, tokB);
  const beforeB = wBeforeB.body?.data; // may include frozen from OTHER still-running auctions
  const b2 = await api("POST", `/api/v1/auctions/${aid}/bids`, { requestId: `startlocal-b-${aid}`, amount: 150 }, tokB);
  step("bidder_b bid 150", b2.body?.code === 0 && b2.body?.data?.currentPrice === 150, `price=${b2.body?.data?.currentPrice}`);

  // wait for WS push of B's bid to A (event envelope: {type,auctionId,seq,serverTime,bidderId,amount,currentPrice,...})
  let pushB = null;
  for (let i = 0; i < 20 && !pushB; i++) {
    await sleep(250);
    pushB = wsEvents.find((ev) => ev.type === "BID_ACCEPTED" && Number(ev.amount) === 150);
  }
  step("WebSocket live push (B's bid reached A)", !!pushB, `events=${wsEvents.map((e) => e.type).join(",")}`);

  // 8) wallet after: A outbid -> frozen released; B leads -> frozen 150 (available = balance - frozen)
  const wAfterA = await api("GET", "/api/v1/wallets/me", null, tokA);
  const afterA = wAfterA.body?.data;
  const aOk = afterA && before && afterA.balance === before.balance && afterA.frozen === 0;
  step("bidder_a funds released after outbid", !!aOk, `balance=${afterA?.balance} frozen=${afterA?.frozen}`);
  const wAfterB = await api("GET", "/api/v1/wallets/me", null, tokB);
  const afterB = wAfterB.body?.data;
  const bFrozenOk = afterB && beforeB && afterB.frozen === beforeB.frozen + 150 && afterB.balance === beforeB.balance;
  step("bidder_b funds frozen while leading (+150)", !!bFrozenOk, `balance=${afterB?.balance} frozen=${afterB?.frozen} (before=${beforeB?.frozen})`);
  const ledger = await api("GET", "/api/v1/wallets/me/ledger", null, tokA);
  const rows = ledger.body?.data ?? [];
  step("bidder_a ledger rows exist", rows.length > 0 && rows.some((r) => r.type === "FREEZE") && rows.some((r) => r.type === "UNFREEZE"), `rows=${rows.length} types=${[...new Set(rows.map((r) => r.type))].join(",")}`);

  // 9) detail view shows current price (auth required; page data source)
  const det = await api("GET", `/api/v1/auctions/${aid}`, null, tokA);
  step("auction detail reflects bids", det.body?.data?.currentPrice === 150, `price=${det.body?.data?.currentPrice} status=${det.body?.data?.status}`);

  try { ws.close(); } catch {}
  const fail = results.filter((r) => !r.ok).length;
  console.log(`\nSTARTLOCAL-VERIFY TOTAL=${results.length} PASS=${results.length - fail} FAIL=${fail}`);
  process.exit(fail > 0 ? 1 : 0);
}
main().catch((e) => { console.error("verify crashed:", e); process.exit(2); });
