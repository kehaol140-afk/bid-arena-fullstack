# API_CONTRACT — Bid Arena 公开接口契约（按当前真实代码记录）

> 基准：backend 源码 @ 检查点提交（见 PARALLEL_HANDOFF.md）。
> 通用约定：
> - Base URL：`http://<host>:8090`（本地开发）；Docker 部署时按 compose 映射。
> - 所有响应统一包装：`{"code": <int>, "message": "<string>", "data": <T|null>}`；`code=0` 成功，非 0 见错误码表。
> - 业务错误 HTTP 状态：400/401/403/404/409/429/500，与 ErrorCode 对应（见 §6）。
> - 认证：`Authorization: Bearer <token>`；用户会话 token（登录签发）与 Agent Token（`bat_` 前缀）两套体系，路径互不通用。
> - 时间字段一律 epoch 毫秒（long）；金额一律整数积分（long）。

## 1. 认证与用户（已实现 ✅）

### POST /api/v1/auth/login （无需认证）
请求：
```json
{"email": "bidder_a@example.com", "password": "Test123456!"}
```
成功（200）：
```json
{"code":0,"message":"ok","data":{"token":"<64位hex会话token>","user":{"id":2,"email":"bidder_a@example.com","displayName":"竞拍者A","role":"USER"}}}
```
失败（401）：`code=1001`，统一报「邮箱或密码错误」（不泄漏账号存在性）。

### POST /api/v1/auth/logout （Bearer 用户token）
成功：`{"code":0,"message":"ok","data":null}`（删除会话）。

### GET /api/v1/users/me （Bearer 用户token）
```json
{"code":0,"message":"ok","data":{"id":2,"email":"...","displayName":"...","role":"USER"}}
```

## 2. 钱包（已实现 ✅）

### GET /api/v1/wallets/me
```json
{"code":0,"message":"ok","data":{"userId":2,"balance":1000,"frozen":0,"available":1000}}
```
规则：`available = balance - frozen`；仅能查本人（越权路径不存在）。

### GET /api/v1/wallets/me/ledger
返回本人流水（最新优先，最多 200 条）：
```json
{"code":0,"data":[{"id":1,"auctionId":1,"requestId":"r-001","type":"FREEZE","amount":110,"balanceAfter":1000,"frozenAfter":110,"remark":"bid 110 on auction 1","createdAt":1791617868468}]}
```
`type ∈ FREEZE | UNFREEZE | PAY | REFUND | GRANT`；`amount` 正=冻结/入账方向，负=扣款。

## 3. 拍卖（用户侧，已实现 ✅）

### GET /api/v1/auctions
列表（id 倒序）。元素字段同 detail，但 `participants` 为空、含 `participantCount`。

### GET /api/v1/auctions/{id}
```json
{"code":0,"data":{
  "id":1,"title":"演示拍品·经典机械腕表（DRAFT）","description":"...","status":"DRAFT",
  "startPrice":100,"minIncrement":10,"currentPrice":100,
  "currentLeaderId":null,"currentLeaderName":null,
  "durationSeconds":180,"startedAt":null,"endTime":null,
  "extendCount":0,"maxExtends":3,"seq":0,"settleReason":null,"createdAt":1791617900000,
  "participantCount":0,
  "participants":[{"userId":2,"displayName":"竞拍者A","type":"HUMAN","joinedAt":1791617900000}],
  "result":null
}}
```
说明：`currentPrice` 无人出价时=起拍价；`result` 仅 FINISHED/CANCELLED 时非空：
```json
"result":{"winnerId":2,"winnerName":"竞拍者A","finalPrice":150,"reason":"EXPIRED","settledAt":1791618000000}
```
（CANCELLED 时 `winnerId=null, finalPrice=0`。）

### POST /api/v1/auctions/{id}/join （Bearer 用户token）
仅 RUNNING 可加入；重复 join 幂等成功。成功：`{"code":0,"data":null}`。

### POST /api/v1/auctions/{id}/bids （Bearer 用户token）——核心
请求：
```json
{"requestId":"client-uuid-001","amount":110}
```
成功（200）：
```json
{"code":0,"data":{"bidId":1,"auctionId":1,"userId":2,"amount":110,"seq":2,
  "idempotentReplay":false,"currentPrice":110,"endTime":1791618100000,
  "extended":false,"extendCount":0,"serverTime":1791617900123}}
```
- `seq`：本次出价（含可能的延时）后的最新事件序号。
- `idempotentReplay=true`：同 requestId+同金额 的重复提交，返回原出价，不产生新扣款/事件。
- 同 requestId 不同金额 → 409 `code=2005`。
- 拒绝（4xx，`data=null`）并**仅向本人 WebSocket 推送 BID_REJECTED**：
  - `code=2001`（409）非 RUNNING；`code=2002`（400）低于最小合法价；`code=2003`（400）可用余额不足；`code=2004`（409）迟到（服务端接收时间未严格早于截止）；`code=1005`（400）参数缺失。

### GET /api/v1/auctions/{id}/bids
出价历史（seq 倒序，最多 200）：`[{id,auctionId,userId,amount,requestId,seq,createdAt}]`（`createdAt` 即服务端时间）。

### GET /api/v1/auctions/{id}/events?since=0
持久化事件回放（HTTP 兜底，断线缺号恢复用）：`[{seq,payload}]`，`payload` 为原始 JSON 字符串。

## 4. 管理员（Bearer 用户token + role=ADMIN，已实现 ✅）

### POST /api/v1/admin/auctions
```json
{"title":"测试拍品","description":"可选","startPrice":100,"minIncrement":10,"durationSeconds":180}
```
→ `{"code":0,"data":{"auctionId":2}}`。校验：价格>0；duration 3~3600（默认 180，允许短时长测试拍卖）。创建后为 DRAFT，不自动倒计时。

### POST /api/v1/admin/auctions/{id}/start
DRAFT→RUNNING（其他状态 409 `code=2007`）。返回启动后的 detail（含 `endTime`）。

### POST /api/v1/admin/auctions/{id}/cancel
仅 DRAFT/RUNNING 可取消（SETTLING 之后 409）；释放本场全部冻结、写唯一成交记录（reason=CANCELLED, winner=null, finalPrice=0）。返回 detail。

### POST /api/v1/admin/agent-tokens
```json
{"userId":5,"auctionId":1,"scopes":"auction:read,auction:bid","expiresInSeconds":3600,"rateLimitPerMin":30}
```
→ `{"code":0,"data":{"tokenId":1,"token":"bat_<64hex>","userId":5,"auctionId":1,"scopes":"...","expiresAt":1791621500000,"rateLimitPerMin":30}}`
**明文 token 仅此一次返回；库中只存 sha256 摘要。**

### GET /api/v1/admin/agent-tokens?userId=5
列表（不含明文，仅 `tokenPrefix` 前 11 位）：`[{tokenId,tokenPrefix,userId,auctionId,scopes,expiresAt,revoked,rateLimitPerMin}]`。

### POST /api/v1/admin/agent-tokens/{id}/revoke
→ `{"code":0,"data":null}`。吊销后立即失效。

## 5. 竞拍 Agent API（Bearer Agent Token，已实现 ✅）

路径前缀 `/api/v1/agent`，与用户会话互不通用。拦截器校验：存在/未吊销/未过期/固定窗口频率（默认 30/min，超限 429 `code=3004`）。每个端点再校验 auctionId 范围 + scope。

| 方法/路径 | scope | 行为 |
|---|---|---|
| GET /api/v1/agent/me | - | 返回 token 信息 `{tokenId,userId,auctionId,scopes,expiresAt,rateLimitPerMin}` |
| GET /api/v1/agent/auctions/{id} | auction:read | 同 §3 detail（范围不符 403 `code=3002`） |
| GET /api/v1/agent/auctions/{id}/bids | auction:read | 同 §3 出价历史 |
| POST /api/v1/agent/auctions/{id}/join | auction:bid | 加入（participant_type=AGENT） |
| POST /api/v1/agent/auctions/{id}/bids | auction:bid | 出价，请求/响应同 §3（复用 BidService，事务语义一致） |

错误：`3001`（401）token 无效/过期/吊销；`3002`（403）范围外；`3003`（403）缺权限；`3004`（429）频率超限。

## 6. 错误码总表（已实现 ✅）

| code | HTTP | 含义 |
|---|---|---|
| 0 | 200 | 成功 |
| 1001 | 401 | 未认证/会话过期 |
| 1002 | 403 | 无权限（非 ADMIN 访问管理接口等） |
| 1004 | 404 | 资源不存在 |
| 1005 | 400 | 参数校验失败 |
| 2001 | 409 | 拍卖非 RUNNING |
| 2002 | 400 | 出价低于最小合法价 |
| 2003 | 400 | 可用余额不足 |
| 2004 | 409 | 出价迟到（≥截止时间） |
| 2005 | 409 | requestId 冲突（同号不同内容） |
| 2007 | 409 | 状态迁移非法 |
| 3001/3002/3003/3004 | 401/403/403/429 | Agent 认证/范围/权限/频率 |
| 9999 | 500 | 内部错误（不泄漏细节） |

## 7. WebSocket（已实现 ✅ 代码 / 未冒烟 ⚠）

- 端点：`ws://<host>:8091/ws/auction?token=<用户会话token>&auctionId=<id>`
- 客户端可发：`PING`（回 CONNECTION_STATE）、`SYNC:<lastSeq>`（补发 >lastSeq 的持久化事件 + 最新快照）。
- 服务端事件信封（所有事件必含四字段）：
```json
{"type":"AUCTION_SNAPSHOT","auctionId":1,"seq":3,"serverTime":1791617900000, ...}
```
- `type ∈`
  - `AUCTION_SNAPSHOT`：全量权威状态（status,title,startPrice,minIncrement,currentPrice,currentLeaderId,startTime,endTime,extendCount,maxExtends,settleReason,participants[]）——连接即推、SYNC 后必推。
  - `PARTICIPANT_JOINED`：`{userId,type}`
  - `BID_ACCEPTED`：`{bidderId,amount,currentPrice,leaderId,endTime}`
  - `BID_REJECTED`（仅本人）：`{requestId,reason,message}` —— 拒绝不落库、不广播
  - `AUCTION_EXTENDED`：`{fromTime,toTime,extendCount,reason}`
  - `AUCTION_FINISHED`：`{reason,winnerId,finalPrice}`
  - `AUCTION_STARTED`：`{startTime,endTime,currentPrice}`
  - `CONNECTION_STATE`：`{state: connected|rejected|ping, reason?}`
- `seq` 由 `auctions.seq` 行锁保护递增，单场单调；客户端发现缺口 → `SYNC:<lastSeq>` 或 HTTP `GET /auctions/{id}/events`。
- 可靠性边界：事件先随业务事务写 `auction_events`（原子提交），事务提交后才广播；广播失败不回滚事务。

## 8. 健康检查（已实现 ✅）

`GET /api/v1/health`（免认证）→ `{"code":0,"data":{"status":"UP","time":<ms>}}`

## 9. 计划中 / 未实现（PLAN，勿当作已存在）

| 项 | 状态 |
|---|---|
| OpenAPI UI（/swagger 或 /doc） | 依赖已引入（solon-docs-openapi2），**路径可用性未验证**；前端联调前请先实测 |
| 分页（auctions/bids/ledger 目前固定上限 200） | PLAN：后续加 page/size 参数 |
| Agent 批量出价/代理最高价 | 无此需求，不在范围 |
| 前端静态资源由后端托管 | PLAN：Docker 阶段决定（nginx 独立或后端 static） |
