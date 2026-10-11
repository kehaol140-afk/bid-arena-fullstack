# Bid Arena Frontend

Vue 3 + TypeScript + Vite + Pinia + Vue Router + Axios + Vitest 实现的实时拍卖前端。

## 快速启动（本地开发）

```powershell
cd E:\全栈测试-拍卖间\bid-arena-frontend\frontend
npm install
npm run dev        # http://localhost:5173
```

- API 通过 Vite 代理转发到 `http://localhost:8090`（免 CORS）；WebSocket 直连 `ws://localhost:8091`
- 环境变量见 `.env.example`（`VITE_API_BASE` 留空即走代理）

## 构建 / 测试

```powershell
npm run build      # vue-tsc 类型检查 + vite 生产构建
npm run test       # vitest（Store / 组件 / WS 通道 20 个用例）
npm run typecheck  # 仅类型检查
```

## 演示账号（种子数据）

| 角色 | 邮箱 | 密码 |
|---|---|---|
| 管理员 | `admin@example.com` | `Admin123456!` |
| 竞拍者 | `bidder_a@example.com` / `bidder_b@example.com` | `Test123456!` |
| 模拟账号 | `bot_01@example.com` .. `bot_20@example.com` | `Test123456!` |

登录页提供一键填充按钮。

## 页面

| 路由 | 说明 |
|---|---|
| `/login` | 登录（会话 token，localStorage 持久化，401 全局拦截） |
| `/auctions` | 拍卖列表（状态过滤、倒计时、8s 轮询） |
| `/auctions/:id` | 竞价房间（加入、出价、实时 WS、参与者、历史、结果） |
| `/wallet` | 钱包（余额/冻结/可用 + 流水） |
| `/admin/auctions` | 管理员：创建/启动/取消拍卖 |
| `/admin/agent-tokens` | 管理员：Agent Token 签发（明文仅一次）/吊销/过滤 |

## 实时与可靠性

- `src/realtime/auctionChannel.ts`：WS 通道（连接即收 SNAPSHOT；25s 心跳；
  指数退避重连 1s→15s；seq 缺口自动 `SYNC:<lastSeq>`；WS 不可用时 HTTP `/events` 回放兜底；
  重复事件按 seq 去重）
- 房间页在 WS 在线时将 3s 轮询降频为 ~21s 安全网

## 目录

```
src/
  api/        # axios 封装 + 契约 API（auth/auction/wallet/admin）
  realtime/   # WebSocket 通道
  stores/     # Pinia（auth/wallet）
  components/ # Countdown / AuctionCard
  views/      # 六个页面
  types/      # 严格对齐 docs/API_CONTRACT.md 的 TS 类型
```

联调问题与歧义记录见 `API_QUESTIONS.md`。
