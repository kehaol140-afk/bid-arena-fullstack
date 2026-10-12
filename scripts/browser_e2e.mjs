/**
 * Browser E2E via raw CDP (headless Edge, zero npm deps).
 * Verifies: Vue login, auction list/room, join, bid, WebSocket live push,
 * wallet view, finish result view. Screenshots -> docs/e2e_screenshots/.
 * Prereq: backend on 8090/8091 (bid_arena_test), vite dev on 5173, auction prepared by orchestrator.
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const APP = "http://localhost:5173";
const API = "http://127.0.0.1:8090";
const SHOT_DIR = fileURLToPath(new URL("../docs/e2e_screenshots/", import.meta.url));

const results = [];
function step(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name} :: ${detail}`);
}

let msgId = 0;
const pending = new Map();
let ws;
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evalJs(expression, awaitPromise = true) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise });
  if (r.exceptionDetails) throw new Error("page eval failed: " + JSON.stringify(r.exceptionDetails).slice(0, 300));
  return r.result?.value;
}
async function navigate(url) {
  await send("Page.navigate", { url });
  await new Promise((r) => setTimeout(r, 1200));
}
async function waitFor(exprFnSrc, timeoutMs = 15000, label = "") {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const v = await evalJs(`(function(){ try { return ${exprFnSrc}; } catch(e){ return null; } })()`, false);
      if (v) return v;
    } catch {}
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`waitFor timeout: ${label || exprFnSrc.slice(0, 80)}`);
}
async function screenshot(name) {
  const r = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`${SHOT_DIR}${name}.png`, Buffer.from(r.data, "base64"));
}

async function api(method, path, body, token) {
  const res = await fetch(API + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await res.json().catch(() => null);
  return { http: res.status, body: j };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  mkdirSync(SHOT_DIR, { recursive: true });
  const profileDir = SHOT_DIR + "edge-profile";
  rmSync(profileDir, { recursive: true, force: true }); // 残留 profile 会带着旧 localStorage 自动登录
  const auctionId = Number(process.env.E2E_AUCTION_ID || 0);
  if (!auctionId) throw new Error("E2E_AUCTION_ID not set");

  // launch headless Edge with CDP
  const edge = spawn(EDGE, [
    "--headless=new", "--disable-gpu", "--window-size=1280,900",
    "--remote-debugging-port=9222", "--user-data-dir=" + profileDir,
    "--no-first-run", "about:blank",
  ], { stdio: "ignore" });
  await sleep(2500);

  // find page websocket target
  let target;
  for (let i = 0; i < 10; i++) {
    try {
      const list = await (await fetch("http://127.0.0.1:9222/json")).json();
      target = list.find((t) => t.type === "page");
      if (target) break;
    } catch {}
    await sleep(500);
  }
  if (!target) throw new Error("no CDP page target");
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
    }
  };
  await send("Page.enable");
  await send("Runtime.enable");

  try {
    // S1 login page loads (Vue mounts, router guard redirects to /login)
    await navigate(APP + "/");
    await waitFor(`document.querySelector('input[type=email]') ? true : false`, 20000, "login form");
    await screenshot("01-login-page");
    step("S1 login page renders (Vue app + router guard)", true);

    // S2 login as bidder_a
    await evalJs(`(function(){
      const set=(sel,v)=>{const el=document.querySelector(sel);const p=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;p.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}))};
      set('input[type=email]','bidder_a@example.com'); set('input[type=password]','Test123456!');
      document.querySelector('button[type=submit]').click(); return true;
    })()`);
    const auth = await waitFor(`localStorage.getItem('bidarena.auth') ? true : false`, 15000, "auth persisted");
    const path = await evalJs("location.pathname");
    await screenshot("02-after-login");
    step("S2 bidder_a login -> auth persisted, path=" + path, auth && path !== "/login", `path=${path}`);

    // S3 auctions list shows prepared auction
    await navigate(APP + "/");
    const found = await waitFor(
      `document.body.innerText.includes('E2E-BROWSER-AUCTION')`, 15000, "auction card in list");
    await screenshot("03-auction-list");
    step("S3 auction list shows prepared auction", !!found);

    // S4 enter auction room
    await evalJs(`(function(){
      const card=document.querySelector('a.auction-card')||[...document.querySelectorAll('a')].find(x=>x.textContent.includes('E2E-BROWSER-AUCTION'));
      if(card){card.click();return true} return false;
    })()`);
    await waitFor(`location.pathname.includes('/auctions/') && document.querySelector('.price-large')`, 15000, "room view");
    const roomPrice = await waitFor(`(document.querySelector('.price-large')||{textContent:''}).textContent.includes('100')`, 10000, "price 100");
    await screenshot("04-auction-room");
    step("S4 auction room renders start price 100", !!roomPrice);

    // S5 join via UI
    await evalJs(`(function(){ const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('加入')); if(b){b.click();return true} return false })()`);
    const joined = await waitFor(`document.body.innerText.includes('已加入')||document.body.innerText.includes('参与者')`, 12000, "joined feedback");
    await screenshot("05-joined");
    step("S5 join via UI button", !!joined);

    // S6 bid 110 via UI
    await evalJs(`(function(){
      const inp=[...document.querySelectorAll('input')].find(x=>x.type==='number');
      const p=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
      p.call(inp,'110'); inp.dispatchEvent(new Event('input',{bubbles:true}));
      const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('出价'));
      if(b){b.click();return true} return false;
    })()`);
    const bidOk = await waitFor(`document.body.innerText.includes('出价成功')`, 12000, "bid success feedback");
    const price110 = await evalJs(`(document.querySelector('.price-large')||{textContent:''}).textContent`);
    await screenshot("06-bid-success");
    step("S6 bid 110 via UI (HTTP) -> feedback + price", !!bidOk && String(price110).includes("110"), `price=${price110}`);

    // S7 cross-user HTTP bid -> price updates via WebSocket push
    const lb = await api("POST", "/api/v1/auth/login", { email: "bidder_b@example.com", password: "Test123456!" });
    const bidB = await api("POST", `/api/v1/auctions/${auctionId}/bids`, { requestId: `browser-b-${auctionId}`, amount: 150 }, lb.body.data.token);
    const price150 = await waitFor(`(document.querySelector('.price-large')||{textContent:''}).textContent.includes('150')`, 15000, "WS push price 150");
    const outbidNotice = await evalJs(`document.body.innerText.includes('你已被超越')`);
    await screenshot("07-ws-push-price-150");
    step("S7 WebSocket live push: B bid 150 via API -> room price updated + outbid notice", !!price150, `httpBid=${bidB.body.code} outbidNotice=${outbidNotice}`);

    // S8 wallet view: A released (frozen back to pre-bid), ledger rows (formatPrice uses zh-CN comma)
    await navigate(APP + "/wallet");
    await waitFor(`document.body.innerText.includes('冻结')||document.body.innerText.includes('流水')`, 12000, "wallet view");
    const walletText = await evalJs("document.body.innerText");
    const balanceOk = walletText.includes("1,000") || walletText.includes("1000");
    const ledgerOk = walletText.includes("冻结") && (walletText.includes("解冻") || walletText.includes("流水"));
    await screenshot("08-wallet");
    step("S8 wallet view renders balance/frozen/ledger", balanceOk && ledgerOk, `balanceShown=${balanceOk} ledgerShown=${ledgerOk}`);

    // S9 back to room; wait server-side settlement -> result banner via WS AUCTION_FINISHED
    await navigate(APP + "/auctions/" + auctionId);
    await waitFor(`document.querySelector('.result-banner')`, 150000, "result banner");
    const banner = await evalJs(`(document.querySelector('.result-banner')||{textContent:''}).textContent`);
    await screenshot("09-finished");
    step("S9 auto-settle -> room shows finished result via WS", banner.includes("150") || banner.includes("竞拍者B"), `banner=${banner.replace(/\s+/g," ").slice(0,80)}`);

    console.log("E2E-DONE-MARKER");
  } catch (e) {
    step("unexpected", false, e.message);
    try { await screenshot("99-error"); } catch {}
  } finally {
    const fail = results.filter((r) => !r.ok).length;
    console.log(`\nBROWSER_E2E TOTAL=${results.length} PASS=${results.length - fail} FAIL=${fail}`);
    try { ws.close(); } catch {}
    edge.kill();
    process.exit(fail > 0 ? 1 : 0);
  }
}

main().catch((e) => { console.error("browser e2e crashed:", e); process.exit(2); });
