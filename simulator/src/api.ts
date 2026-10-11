/**
 * Bid Arena HTTP API 黑盒客户端。
 * 严格按 docs/API_CONTRACT.md 调用公开接口；不做任何直连数据库或改业务数据的操作。
 * 业务错误（code!=0）不抛异常，原样返回给断言层判定，保证 FAIL/PASS 基于真实响应。
 */

export interface ApiResult<T> {
  code: number;
  message: string;
  data: T | null;
}

export interface ApiResponse<T> {
  http: number;
  ok: boolean; // HTTP 2xx
  body: ApiResult<T>;
  elapsedMs: number;
}

export interface LoginData {
  token: string;
  user: { id: number; email: string; displayName: string; role: string };
}

export interface WalletData {
  userId: number;
  balance: number;
  frozen: number;
  available: number;
}

export interface LedgerEntry {
  id: number;
  auctionId: number;
  requestId: string | null;
  type: "FREEZE" | "UNFREEZE" | "PAY" | "REFUND" | "GRANT";
  amount: number;
  balanceAfter: number;
  frozenAfter: number;
  remark: string;
  createdAt: number;
}

export interface AuctionDetail {
  id: number;
  title: string;
  description: string | null;
  status: "DRAFT" | "RUNNING" | "SETTLING" | "FINISHED" | "CANCELLED";
  startPrice: number;
  minIncrement: number;
  currentPrice: number;
  currentLeaderId: number | null;
  currentLeaderName: string | null;
  durationSeconds: number;
  startedAt: number | null;
  endTime: number | null;
  extendCount: number;
  maxExtends: number;
  seq: number;
  settleReason: string | null;
  createdAt: number;
  participantCount?: number;
  participants?: { userId: number; displayName: string; type: string; joinedAt?: number }[];
  result: { winnerId: number | null; winnerName: string | null; finalPrice: number; reason: string; settledAt: number } | null;
}

export interface BidData {
  bidId: number;
  auctionId: number;
  userId: number;
  amount: number;
  seq: number;
  idempotentReplay: boolean;
  currentPrice: number;
  endTime: number;
  extended: boolean;
  extendCount: number;
  serverTime: number;
}

export interface BidRow {
  id: number;
  auctionId: number;
  userId: number;
  amount: number;
  requestId: string;
  seq: number;
  createdAt: number;
}

export interface EventRow {
  seq: number;
  payload: string;
}

export class NetworkError extends Error {
  readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.cause = cause;
  }
}

export class ApiClient {
  private token: string | null = null;
  private readonly timeoutMs = 10_000;
  readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  setToken(t: string | null): void {
    this.token = t;
  }

  /** 发送请求。仅网络层故障抛 NetworkError；HTTP/业务码原样返回。 */
  async call<T>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
    const t0 = Date.now();
    let res: Response;
    try {
      res = await fetch(this.baseUrl + path, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      throw new NetworkError(`${method} ${path} 网络失败: ${(e as Error).message}`, e);
    }
    let parsed: ApiResult<T>;
    try {
      parsed = (await res.json()) as ApiResult<T>;
    } catch {
      parsed = { code: -1, message: `非 JSON 响应(HTTP ${res.status})`, data: null };
    }
    return { http: res.status, ok: res.ok, body: parsed, elapsedMs: Date.now() - t0 };
  }

  // ---- 认证 ----
  login(email: string, password: string) {
    return this.call<LoginData>("POST", "/api/v1/auth/login", { email, password });
  }
  logout() {
    return this.call<null>("POST", "/api/v1/auth/logout");
  }
  me() {
    return this.call<LoginData["user"]>("GET", "/api/v1/users/me");
  }

  // ---- 钱包 ----
  wallet() {
    return this.call<WalletData>("GET", "/api/v1/wallets/me");
  }
  ledger() {
    return this.call<LedgerEntry[]>("GET", "/api/v1/wallets/me/ledger");
  }

  // ---- 拍卖（用户侧）----
  auctions() {
    return this.call<AuctionDetail[]>("GET", "/api/v1/auctions");
  }
  auctionDetail(id: number) {
    return this.call<AuctionDetail>("GET", `/api/v1/auctions/${id}`);
  }
  join(id: number) {
    return this.call<null>("POST", `/api/v1/auctions/${id}/join`);
  }
  bid(id: number, requestId: string, amount: number) {
    return this.call<BidData>("POST", `/api/v1/auctions/${id}/bids`, { requestId, amount });
  }
  bids(id: number) {
    return this.call<BidRow[]>("GET", `/api/v1/auctions/${id}/bids`);
  }
  events(id: number, since = 0) {
    return this.call<EventRow[]>("GET", `/api/v1/auctions/${id}/events?since=${since}`);
  }

  // ---- 管理员 ----
  adminCreateAuction(req: { title: string; description?: string; startPrice: number; minIncrement: number; durationSeconds: number }) {
    return this.call<{ auctionId: number }>("POST", "/api/v1/admin/auctions", req);
  }
  adminStartAuction(id: number) {
    return this.call<AuctionDetail>("POST", `/api/v1/admin/auctions/${id}/start`);
  }
  adminCancelAuction(id: number) {
    return this.call<AuctionDetail>("POST", `/api/v1/admin/auctions/${id}/cancel`);
  }

  // ---- 健康 ----
  health() {
    return this.call<{ status: string; time: number }>("GET", "/api/v1/health");
  }
}
