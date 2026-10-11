# API_QUESTIONS — 前端联调中发现的问题与疑问

> 依据 docs/API_CONTRACT.md 实现，以下为前端开发过程中发现的歧义/待确认点。
> 前端已按「防御式解析」处理，后端确认后可收紧。

## Q0. 【高优先级·阻塞联调】运行中的后端登录接口拒绝正确凭据（2026-10-11 20:35 实测）

后端已在线（`GET /api/v1/health` → UP，进程 20:32:59 启动，`target\classes` 运行），但：

```
curl -X POST http://localhost:8090/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"bidder_a@example.com","password":"Test123456!"}'
→ {"code":1001,"message":"未认证或会话已过期: 邮箱或密码错误"}
```

已排除的前端/数据因素（证据）：
1. 空请求体 `{}` → `{"code":1005,"message":"参数校验失败: email 与 password 必填"}`，说明 JSON body 绑定正常；
2. MySQL `bid_arena.users` 中 `bidder_a@example.com` status=ACTIVE，password_hash 为 `$2a$10$` 60 字符；
   用 bcryptjs 独立验证 `Test123456!` → **true**（admin/`Admin123456!` 亦 true）；
3. `bid_arena_sim` / `bid_arena_test` 三个库的种子哈希均能通过 bcryptjs 验证（排除连错库，除非另有第 4 个库）；
4. form-urlencoded 与 JSON 两种编码均失败。

推测方向（供后端排查）：
- 运行实例的编译产物早于当前源码（PasswordHasher/AuthService 曾有变更）；
- 运行时 favre BCrypt 在该 JVM（命令行显示 `D:\New Folder\jdk12`）下的兼容问题；
- GlobalExceptionInterceptor 将 1001 消息二次包装（`未认证或会话已过期: 邮箱或密码错误`）说明异常链路本身也待整理。

**影响**：前端无法完成真实登录→出价 E2E 验证（登录页/列表/房间逻辑已由 20 个前端测试覆盖，接口字段以契约为准）。

## Q0.1 【文档不一致】管理员种子密码

`docs/API_CONTRACT.md` 与任务书示例均为 `Test123456!`，但后端种子代码
（`DatabaseInitializer.java` L46）管理员使用 **`Admin123456!`**（数据库哈希已验证）。
前端登录页演示按钮已按实际密码填充。请统一文档或种子。

## Q1. WS `PARTICIPANT_JOINED` 的 payload `type` 与信封 `type` 字段同名冲突（中）

契约 §7：
- 信封四必含字段之一是 `type`（事件类型，如 `PARTICIPANT_JOINED`）
- 而 `PARTICIPANT_JOINED` 的 payload 又写作 `{userId, type}`（HUMAN|AGENT）

同一个 JSON 对象中出现两个 `type` 键。若后端将 payload 平铺进信封（Map 合并），会导致：
- JSON 序列化重复键（Jackson 行为取决于配置：报错或后者覆盖前者）
- 若被覆盖，客户端将无法依据 `type` 分发事件（收到的是 `HUMAN` 而非 `PARTICIPANT_JOINED`）

**前端处理**：`WsParticipantJoined.participantType`（src/types/index.ts），运行时若收到
`type === 'HUMAN' | 'AGENT'` 的消息会无法分发（当前按契约字面实现）。
**请后端确认实际报文**：payload 中的参与者类型是否改名为 `participantType` / `userType`，或嵌套在 `participant` 对象中？

## Q2. HTTP `/api/v1/auctions/{id}/events` 的 `payload` 具体结构（低）

契约 §3：`[{seq,payload}]`，payload 为「原始 JSON 字符串」。
前端假设 payload 反序列化后即完整事件信封（含 `type/auctionId/seq/serverTime`），并强制 `seq = 外层 seq` 后回放。
若 payload 实际只含事件体（无 `type`），回放将失效，需改为 `{type: <推断>, ...payload}`。
**请提供一条真实样例报文**（任一拍卖 `GET /events` 输出即可）。

## Q3. WS 断开时服务端是否会回 `CONNECTION_STATE.rejected`（低）

契约定义了 `CONNECTION_STATE: {state: connected|rejected|ping}`，但未说明 token 无效时：
- 是直接 close（什么 code？），还是先发一条 `rejected` 再 close？
前端当前两种都兼容：close code `4001` 或 reason 含 `rejected` 停止重连；收到 `state=rejected` 事件也在 UI 提示后不再重连。
若后端用其他 close code 拒绝（如 1008/4000），前端会误判为网络断开并持续重连（无害但浪费）。

## Q4. 列表页 `GET /api/v1/auctions` 是否只返回全量（最多 200 条）（低）

当前无分页（契约 §9 已注明 PLAN）。前端全量渲染。拍卖数量大时建议加 page/size；
在此之前前端不做虚拟滚动（演示规模无必要）。

## Q5. `BID_REJECTED` 是否计入 seq（信息）

契约注明「拒绝不落库、不广播（仅本人）」。前端对 `BID_REJECTED` 不做 seq 连续性校验、不推进 lastSeq。
若后端实际为拒绝事件也分配了 seq，请告知（前端逻辑仍兼容，仅去重窗口略保守）。

## Q6. CORS（信息）

开发环境前端走 Vite 代理（同源 `/api` → `http://localhost:8090`），生产若前后端分域部署，
需后端开启 CORS 或由 nginx 反代同源。当前 Solon 未见 CORS 配置，分域直连会被浏览器拦截。

## Q7. 观察到的环境事实（非接口问题）

- 联调窗口内 `localhost:8090/8091` 未启动（后端由并行 Agent 负责），因此 HTTP/WS 联调为
  基于契约的实现 + 单元/组件测试（mock axios/WS），真实联调待后端可用后进行。
- WS 端口与 HTTP 端口不同（8090/8091），前端通过 `VITE_WS_BASE` 配置，生产部署文档已注明。
