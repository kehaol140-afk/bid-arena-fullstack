import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Deterministic bidder: only public restricted-token API; no database or admin access. */
export async function runAgent({
  baseUrl = process.env.BID_API_BASE || 'http://127.0.0.1:8090',
  token = process.env.AUCTION_AGENT_TOKEN,
  budget = Number(process.env.AUCTION_AGENT_BUDGET || 300),
  pollMs = Number(process.env.AUCTION_AGENT_POLL_MS || 3000),
  maxRuntimeMs = Number(process.env.AUCTION_AGENT_MAX_RUNTIME_MS || 240000),
  log = message => console.log(message),
} = {}) {
  if (!token) throw new Error('Set AUCTION_AGENT_TOKEN in the environment (never command arguments).');
  if (!Number.isSafeInteger(budget) || budget <= 0 || pollMs < 100 || maxRuntimeMs <= 0) {
    throw new Error('Budget must be a positive safe integer; poll interval >=100ms and runtime >0.');
  }
  baseUrl = baseUrl.replace(/\/$/, '');
  const until = Date.now() + maxRuntimeMs;
  let accepted = 0, pending = null;
  async function request(method, path, body) {
    for (;;) {
      if (Date.now() >= until) throw new Error('Agent runtime limit reached.');
      let response;
      try {
        response = await fetch(baseUrl + path, { method, headers: {
          Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
        }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(5000) });
      } catch {
        // Retrying this same body retains requestId after a lost HTTP response.
        log('[agent] transport retry'); await sleep(Math.max(pollMs, 500)); continue;
      }
      if (response.status === 401) throw new Error('Agent credential expired, revoked or invalid (401).');
      if (response.status === 429) {
        const wait = Math.max(1000, Number(response.headers.get('Retry-After') || 60) * 1000);
        log('[agent] rate limited; waiting'); await sleep(Math.min(wait, Math.max(1, until-Date.now()))); continue;
      }
      const result = await response.json();
      // Deliberately never log headers, token, raw response or error body.
      return { status: response.status, code: result.code, data: result.data };
    }
  }
  const identity = await request('GET', '/api/v1/agent/me');
  if (identity.code !== 0) throw new Error(`Agent identity rejected (${identity.status}/${identity.code}).`);
  const { auctionId, userId } = identity.data;
  log(`[agent] auction=${auctionId} user=${userId} budget=${budget}`);
  while (Date.now() < until) {
    const read = await request('GET', `/api/v1/agent/auctions/${auctionId}`);
    if (read.code !== 0) throw new Error(`Auction read rejected (${read.status}/${read.code}).`);
    const auction = read.data;
    if (['FINISHED','CANCELLED'].includes(auction.status)) {
      log(`[agent] ended status=${auction.status} winner=${auction.result?.winnerId ?? 'none'} price=${auction.result?.finalPrice ?? 0}`);
      return { accepted, reason: auction.status, auctionId, userId };
    }
    if (auction.status !== 'RUNNING') { await sleep(pollMs); continue; }
    if (auction.currentLeaderId === userId && !pending) { await sleep(pollMs); continue; }
    const wallet = await request('GET', '/api/v1/agent/wallet');
    if (wallet.code !== 0) throw new Error(`Own wallet read rejected (${wallet.status}/${wallet.code}).`);
    const target = auction.currentPrice + auction.minIncrement;
    const held = auction.currentLeaderId === userId ? auction.currentPrice : 0;
    if (!pending && (target > budget || target-held > wallet.data.available)) {
      log('[agent] budget or available funds exhausted');
      return { accepted, reason: 'BUDGET', auctionId, userId };
    }
    const joined = await request('POST', `/api/v1/agent/auctions/${auctionId}/join`, {});
    if (joined.code !== 0) {
      if ([2001,2004].includes(joined.code)) { await sleep(pollMs); continue; }
      throw new Error(`Join rejected (${joined.status}/${joined.code}).`);
    }
    pending ||= { requestId: `agent-${randomUUID()}`, amount: target };
    const bid = await request('POST', `/api/v1/agent/auctions/${auctionId}/bids`, pending);
    if (bid.code === 0) {
      accepted++; log(`[agent] confirmed amount=${pending.amount} requestId=${pending.requestId} replay=${!!bid.data.idempotentReplay}`);
      pending = null;
    } else if (bid.code === 2008) {
      log('[agent] transaction contention; same request retry');
    } else if ([2001,2002,2003,2004].includes(bid.code)) {
      log(`[agent] bid conflict code=${bid.code}; refreshing`); pending = null;
    } else throw new Error(`Bid rejected (${bid.status}/${bid.code}).`);
    await sleep(pollMs);
  }
  throw new Error('Agent runtime limit reached.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runAgent().then(result => console.log(`[agent] summary accepted=${result.accepted} reason=${result.reason}`))
    .catch(error => { console.error(`[agent] ${error.message}`); process.exitCode=1; });
}
