# 演示环境与 UI 体验修复验收（DEMO_UX_REVIEW）

日期：2026-10-13。分支 audit/codex-final（基线 2388c88），本地增量提交，不推送、不合并 main。本轮未改动 BidTransaction、WalletRepository、SettlementService、Agent 认证与任何资金/结算逻辑（后端零改动）。

## A. 乱码根因（已查明，证据确凿）

| 检查 | 结果 |
|---|---|
| DB 原始值 | `Docker??B1-SETTLING??` 等的 HEX 为 `3F3F...`——**已持久化为字面问号（0x3F）**，非显示层乱码，不可无损恢复 |
| 后端/DB 链路 | 正常：种子用户 `竞拍者A` 在库中为正确 UTF-8（`E7AB9E...`），登录接口全程回显正常 |
| 根因 | 本机验收期 PowerShell 5.1 测试脚本经 `-Headers @{ 'Content-Type'='application/json' }`（无 charset）发送字符串请求体 → PS 5.1 以 ISO-8859-1 编码 → 中文每个字符变 `?` 落库。仓库自带脚本（smoke_e2e.ps1 等）使用 `-ContentType "application/json; charset=utf-8"`，实测**不会**产生乱码 |
| 修复 | ① 结论写入本文与 USER_GUIDE：PowerShell 提交 JSON 必须用 `-ContentType 'application/json; charset=utf-8'`（或 UTF-8 字节体），不得经 -Headers 传无 charset 的 Content-Type；② 新增脚本 demo-docker.ps1 不涉及业务 POST；③ 已实测中文创建不再乱码（下） |
| 中文实测 | 经 Nginx 同源端口 25173 以 UTF-8 创建 `E2E-BROWSER-AUCTION·中文演示名表` → API 回显一致 → DB HEX `E69687...`（正确UTF-8）→ 真实 Edge 浏览器列表/房间正常显示（截图 03/04，DOM 级证据：S9 横幅含中文"竞拍者B"） |
| 既有乱码数据 | 保留不删（审计证据）；其中两个编码试验 DRAFT 已按业务操作「取消」（留痕），其余测试场维持原状 |

## B. 独立干净演示环境（已交付）

- 新增 `scripts/demo-docker.ps1`（up/status/logs/down）+ `.env.demo.example`（`.env.demo` 自动生成随机密码、已入 .gitignore）。
- Compose 项目 `bid-arena-demo`：端口 **25173 前端 / 28090 API / 28091 WS / 23306 MySQL**，独立卷 `bid-arena-demo_mysql-data`；与原开发实例(8090/8091/5173)、验收实例 bid-arena-codex-check(15173/18090/18091/13306) 及其数据卷完全隔离、可并行。
- 实测种子状态：24 用户（admin/bidder_a/bidder_b/agent/20 bots）、24 钱包各 1000、**列表仅 1 条 DRAFT**（演示拍品·经典机械腕表）。
- 进入：`scripts/demo-docker.ps1 -Action up` → http://localhost:25173；回到原测试环境：直接访问 http://localhost:15173（两套并存，无需切换操作）。
- 测试隔离：仓库自动化测试（test-all.ps1 / demo-audit.mjs）自建 `bid_arena_codex_*` 库并自起后端；模拟器直连演示库时自建场次描述为 "simulator created"，默认「仅演示拍品」过滤器自动隐藏。
- 透明记录：验证期浏览器 E2E 在演示库产生 1 场成交数据，验证完成后对本轮自建的 bid-arena-demo 卷执行了一次 `down -v` 重建（该卷仅含本轮种子+E2E 数据，无任何用户/审计数据；既有 bid-arena-codex-check 卷未触碰），最终交付纯净演示态。彻底重建命令已写入 USER_GUIDE 第8节供本人手动执行。

## C. UI 改动（最小范围，3 个视图）

| 项 | 改动 | 文件 |
|---|---|---|
| 管理员流程提示 | 顶部新增演示流程说明（创建DRAFT→启动倒计时→自动结算/取消释放；[DEMO] 描述说明；Agent Token 入口指引） | AdminAuctionsView.vue |
| 先加入再出价 | 未加入时改为「第一步：加入 / 第二步：出价」两步提示（金色强调步骤） | AuctionRoomView.vue |
| 资金冻结说明 | 出价面板新增冻结/解冻/扣款规则一行说明，指向右侧钱包 | AuctionRoomView.vue |
| WS 状态与业务状态区分 | 通道徽章「实时」→「实时同步」（连接中→同步连接中等），tooltip 明示"消息通道状态，不代表拍卖进行中"；业务状态徽章（待启动/竞拍中/…）保持独立 | AuctionRoomView.vue |
| 演示过滤提示 | 「仅演示拍品」复选框加 tooltip 说明过滤规则 | AuctionListView.vue |
| undefined/NaN | 检查全部涉及组件（Card/Room/Countdown/format），现有 fallback（`用户 #id`、`--`、null 守卫）完备，未发现新风险；本轮改动未引入任何直接渲染未经守卫的值 | — |

延时（+10s 第n/3次反馈）、成交横幅（赢家/成交价/无人出价）、取消横幅（冻结已释放）为既有实现，经本轮浏览器实测确认反馈清晰（截图 06/07/09）。

## D. 用户手册

新增 docs/USER_GUIDE.md：账号表、管理员创建/启动/取消、双浏览器真人竞拍、钱包冻结/解冻/扣款查看、最后五秒延时演示法、Agent Token 签发、auction-agent.mjs 安全执行（临时环境变量+用完即清）、20人模拟两种方式（隔离推荐/实时观看）、Docker 演示环境启停与环境切换、常见问题（含乱码与徽章语义）。所有命令对照仓库实现（demo-docker.ps1、browser_e2e.mjs 环境变量、simulator config.ts 的 baseUrl/wsBase/seed/bots 参数、test-all.ps1）核实。

## E. 验证结果（全部实际执行）

| 验证 | 结果 | 证据 |
|---|---|---|
| Vue build | PASS | `npm --prefix frontend run build` 成功（新 chunk AuctionRoomView-SoUFowcm.js 等） |
| Vitest | PASS 24/24 | 7 个测试文件全过，无断言依赖被改文案 |
| 真实浏览器操作 | PASS 9/9 | scripts/browser_e2e.mjs（headless Edge/CDP）指向 25173/28090：登录、列表、房间、UI加入、UI出价110、WS推送150+被超提示、钱包、自动结算横幅「得主 竞拍者B 成交价150」；截图 docs/e2e_screenshots/docker-demo/01~09 |
| WebSocket 实时更新 | PASS | E2E S7：B 经HTTP出价，A 浏览器页面价格/横幅经 WS 实时变化（经 Nginx /ws/ 升级） |
| 中文标题不乱码 | PASS | 创建→API回显→DB HEX→浏览器显示全链路（见A节） |
| 管理员/用户权限 | PASS | 普通用户调 admin 创建/签发Token=403，启动路由=404；管理员=200 |
| 演示环境纯净度 | PASS | 重置后列表仅 1 条 DRAFT 种子拍品 |
| 后端回归 | 未重跑（不必要） | 本轮后端零改动；Codex 轮 MySQL JUnit 22/22 与 Docker 17/17 验收仍有效（docs/DOCKER_VALIDATION.md） |
| 资金/结算业务 | 未改动 | git diff 仅 3 个 Vue 视图 + 文档 + 脚本 + .gitignore |

## 遗留说明

- 既有乱码标题按字面问号留存于 bid-arena-codex-check 测试库（审计数据不删）；演示环境无此数据。
- 多实例 WS 即时跨进程广播、断电级故障注入等边界沿用前轮结论（NOT_VERIFIED），本轮未涉及。
- E2E 截图为程序化 DOM 断言+截图留档；本人现场讲解建议按 USER_GUIDE 流程预演一遍。
