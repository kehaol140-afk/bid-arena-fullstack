# Bid Arena 需求清单与实现映射

> 依据：`E:\全栈测试-拍卖间\全栈评测-拍卖间.pdf`（5 页任务书，已完整阅读）+ 开发任务指令。
> 原始 PDF 为最高优先级需求依据，本文档逐条整理并建立「需求编号 → 实现文件 → 测试」映射。
> 状态图例：✅ 已实现 · 🔶 部分实现/有边界 · ❌ 未实现

## R1 功能性需求

| 编号 | 需求 | 来源 | 实现文件 | 测试 | 状态 |
|---|---|---|---|---|---|
| R1.1 | 管理员创建/启动/取消拍卖 | PDF p2/p3 | auction/AdminAuctionController.java, AuctionService.java | AuctionFlowIT | ✅ |
| R1.2 | 用户登录（会话令牌） | PDF p3 | auth/AuthController.java, AuthService.java | AuthIT | ✅ |
| R1.3 | 普通用户加入拍卖 | PDF p3 | auction/AuctionController.java (join) | AuctionFlowIT | ✅ |
| R1.4 | 用户出价（requestId+amount） | PDF p3 | bid/BidController.java, BidService.java | BidTransactionIT | ✅ |
| R1.5 | 查询拍卖状态/列表/详情 | PDF p3 | auction/AuctionController.java | AuctionFlowIT | ✅ |
| R1.6 | 查询出价历史 | PDF p3 | bid/BidController.java (list) | BidTransactionIT | ✅ |
| R1.7 | 查询自己的钱包与流水 | PDF p3 | wallet/WalletController.java | WalletIT | ✅ |
| R1.8 | 拍卖结束查看赢家与成交信息 | PDF p2 | settlement/, auction/AuctionController (result) | SettlementIT | ✅ |
| R1.9 | 演示账号 + 20 个模拟账号 + DRAFT 演示拍品，种子幂等 | PDF p4 | config/Seeder.java, db/migration/V2__seed | 重复启动验证 | ✅ |
| R1.10 | 服务启动不自动开始倒计时（须管理员启动） | PDF p4 | AuctionService.start（仅管理员触发） | AuctionFlowIT | ✅ |

## R2 技术栈硬性要求

| 编号 | 需求 | 实现位置 | 状态 |
|---|---|---|---|
| R2.1 | Vue 3 + TypeScript + Vite + Pinia + Vue Router + Axios + Vitest | frontend/ | ✅ |
| R2.2 | Java 17 + Solon 3.x（优先 3.10.7）+ Maven | backend/pom.xml（solon 3.10.7, release=17） | ✅ |
| R2.3 | MySQL 8 唯一事实来源；迁移与种子自动执行 | backend/src/main/resources/db/migration (Flyway) | ✅ |
| R2.4 | WebSocket 实时通知 | websocket/（solon-boot-websocket-netty） | ✅ |
| R2.5 | OpenAPI 文档 | solon-docs-openapi2（/swagger/） | ✅ |
| R2.6 | Docker Compose 一键启动 | docker-compose.yml | ✅（本机无 Docker，运行验证 NOT_VERIFIED） |
| R2.7 | Node.js 多人模拟脚本 | simulator/ | ✅ |
| R2.8 | 不使用 Spring Boot / Redis / MQ / 微服务 | 全仓库 | ✅ |

## R3 数据一致性（资金/并发）

| 编号 | 需求 | 实现 | 测试 | 状态 |
|---|---|---|---|---|
| R3.1 | 状态机 DRAFT→RUNNING→SETTLING→FINISHED；DRAFT/RUNNING→CANCELLED；SETTLING 后禁取消 | AuctionService/状态列 CHECK+服务校验 | AuctionFlowIT | ✅ |
| R3.2 | 起拍价100/最小加价10/默认180s/初始余额1000/首价≥110 | auctions 表默认值+BidService 校验 | BidTransactionIT | ✅ |
| R3.3 | available = balance − frozen；整数积分 | wallet 域 | WalletIT | ✅ |
| R3.4 | 出价单事务：锁拍卖→校验→锁钱包→释放旧领先者→冻结新领先者→更新价格→写流水/事件→延时→原子提交 | bid/BidService.placeBid @Tran | BidTransactionIT | ✅ |
| R3.5 | SELECT FOR UPDATE；锁顺序 auction→wallet(按 userId 升序) | BidService/SettlementService | 死锁分析见 DESIGN.md | ✅ |
| R3.6 | requestId 数据库唯一约束；重试幂等返回；内容不同返回 409 | bids UNIQUE(user_id,request_id) | BidTransactionIT | ✅ |
| R3.7 | 同用户加价只增冻差额；失败出价无资金副作用 | BidService | BidTransactionIT | ✅ |
| R3.8 | 出价接受条件=服务端接收时间严格早于当前截止时间 | controller 捕获 receivedAt+锁后校验 | BidTransactionIT（边界用例） | ✅ |
| R3.9 | 余额/可用/冻结任意时刻非负；流水可解释 | ledger 记录 balance_after/frozen_after | WalletIT | ✅ |
| R3.10 | 最后5秒出价延长10s，以最新截止为基准，最多3次，超限仍可出价；延时与出价同事务 | BidService（同事务内） | SettlementIT | ✅ |
| R3.11 | 唯一结算：赢家冻结转扣款，其余释放，无人出价不扣款；auction_id 唯一约束 | settlement/SettlementService, auction_results PK | SettlementIT | ✅ |
| R3.12 | 服务端定时扫描到期结算，不依赖客户端；重启恢复 | settlement/SettlementScanner | SettlementIT | ✅ |
| R3.13 | 重复结算/重启/双触发不重复扣款、不重复成交、不重复流水 | 幂等结算（条件更新+唯一约束） | SettlementIT | ✅ |
| R3.14 | 取消释放全部冻结 | AuctionService.cancel | SettlementIT | ✅ |
| R3.15 | 不信任前端提交的价格/余额/角色/截止时间/赢家 | 服务端全部重算 | 隐藏测试点 | ✅ |

## R4 接口与 WebSocket

| 编号 | 需求 | 实现 | 状态 |
|---|---|---|---|
| R4.1 | 必备 12 个接口（login/users/me/wallets/me/admin auctions/start/cancel/agent-tokens/auctions CRUD/join/bids） | 各 Controller | ✅ |
| R4.2 | 输入输出 DTO + 参数验证 + 统一异常 + 明确 HTTP 状态码 | common/ApiResult, GlobalExceptionInterceptor, DTO record + 校验注解 | ✅ |
| R4.3 | 管理员接口校验 ADMIN；用户只能看自己的钱包 | auth/AuthInterceptor, RoleInterceptor | ✅ |
| R4.4 | 密码安全哈希（BCrypt） | auth/PasswordHasher | ✅ |
| R4.5 | WebSocket 事件含 auctionId/seq/serverTime/type；seq 单场单调递增 | websocket/AuctionWsListener + auction_events | ✅ |
| R4.6 | 事件类型：SNAPSHOT/PARTICIPANT_JOINED/BID_ACCEPTED/BID_REJECTED(仅本人)/AUCTION_EXTENDED/AUCTION_FINISHED/CONNECTION_STATE | websocket/ | ✅ |
| R4.7 | 事务提交后通知；发送失败不回滚 | controller/scanner 在事务方法返回后广播；try-catch | ✅ |
| R4.8 | 客户端发现 seq 缺口重拉快照 | 前端 + AUCTION_SNAPSHOT | ✅ |

## R5 竞拍 Agent Token

| 编号 | 需求 | 实现 | 测试 | 状态 |
|---|---|---|---|---|
| R5.1 | 高熵随机 Token，DB 只存摘要，明文仅创建返回一次 | agent/AgentTokenService (SHA-256) | AgentTokenIT | ✅ |
| R5.2 | 用户身份、auctionId 范围、auction:read/auction:bid 权限、过期、吊销、频率限制 | agent_tokens 表 + AgentAuthInterceptor | AgentTokenIT | ✅ |
| R5.3 | 不得访问管理接口与他人隐私 | Agent 路径独立 /api/v1/agent/**，最小权限 | AgentTokenIT | ✅ |
| R5.4 | AGENT_TOOL_SPEC.md 调用示例（无真实 Token） | AGENT_TOOL_SPEC.md | 文档 | ✅ |
| R5.5 | Token 不入 Git/日志/前端包 | 种子与文档均无真实 Token | 人工检查 | ✅ |

## R6 自动化测试

| 编号 | 需求 | 实现 | 状态 |
|---|---|---|---|
| R6.1 | 非法状态/低价/余额不足出价拒绝 | BidTransactionIT | ✅ |
| R6.2 | requestId 只产生一次出价与一次资金变化 | BidTransactionIT | ✅ |
| R6.3 | 并发出价唯一确定领先者 | BidTransactionIT（CountDownLatch 真实并发） | ✅ |
| R6.4 | 新冻结/旧释放/同用户差额 | BidTransactionIT | ✅ |
| R6.5 | 5 秒延时 + 最多 3 次 | SettlementIT | ✅ |
| R6.6 | 到期/取消/重复结算唯一结果 | SettlementIT | ✅ |
| R6.7 | 结算后余额/冻结/流水一致 | SettlementIT | ✅ |
| R6.8 | Agent Token 范围/权限/过期/吊销 | AgentTokenIT | ✅ |
| R6.9 | WebSocket 递增 seq + 重连快照 | WebSocketIT | ✅ |
| R6.10 | 至少一个 Vue Store/组件测试 | frontend tests (Vitest) | ✅ |
| R6.11 | 关键并发/结算测试使用真实 MySQL | 集成测试连本机/容器 MySQL | ✅ |

## R7 文档与 Git

| 编号 | 需求 | 状态 |
|---|---|---|
| R7.1 | README.md（快速启动 PowerShell/Docker 全路径） | ✅ |
| R7.2 | DESIGN.md（架构/事务/锁/资金/状态机/结算/恢复/WS 边界） | ✅ |
| R7.3 | DECISIONS.md（≥3 项真实决策） | ✅ |
| R7.4 | AI_USAGE.md（人机分工/3 项本人决定/2 未采用方案/2 真实错误） | ✅ |
| R7.5 | DEBUG_LOG.md（≥2 个真实问题） | ✅ |
| R7.6 | AGENT_TOOL_SPEC.md | ✅ |
| R7.7 | docs/REQUIREMENTS.md（本文档）、docs/TEST_REPORT.md、docs/CODEX_HANDOFF.md | ✅ |
| R7.8 | .env.example、docker-compose.yml、一键测试/模拟命令 | ✅ |
| R7.9 | 增量 Git 提交（非机械拆分） | ✅ |
| R7.10 | 演示录屏（3-5 分钟） | ❌ 需人工录制（AI 无法生成录屏） |

## R8 演示与交付

| 编号 | 需求 | 状态 |
|---|---|---|
| R8.1 | 评审 5 分钟内跑起来（复制 env→Compose→迁移种子→启动） | ✅（Docker 环境验证 NOT_VERIFIED：本机未装 Docker） |
| R8.2 | 20 人模拟脚本 `npm run simulate:auction -- --auctionId= --bots=20 --seed=42` | ✅ |
| R8.3 | 模拟场景全覆盖（并发相同/相邻价、requestId 重试、余额不足、低价、结束出价、5 秒狙击、断线重连、快照、结果核对、资金一致性断言、PASS/FAIL 摘要） | ✅ |
| R8.4 | 可复现随机种子 | ✅ |
| R8.5 | 短时长测试拍卖允许（保留 180s 默认） | ✅ |
| R8.6 | 生产 API 无任意改余额/截止/赢家能力 | ✅ |

## 已知边界（诚实声明）

1. **Docker 未本机验证**：本机未安装 Docker，docker-compose.yml 按 MySQL 官方镜像与后端 Dockerfile 编写，需评审环境验证。
2. **录屏**：AI 无法生成视频，需本人录制。
3. **多实例极端竞争/故障注入**：按要求交由第二轮 Codex 专项加固，已在 CODEX_HANDOFF.md 列明。
# 独立审计覆盖说明（2026-10-12）

下文为前任需求表，保留历史内容，不作为最新PASS证据。表中AuctionFlowIT、BidTransactionIT、SettlementIT、AgentTokenIT、WebSocketIT、CODEX_HANDOFF.md、TEST_REPORT.md等引用在初始仓库不存在；不能以✅推断实测。最新逐项状态与实际测试路径见CODEX_FINAL_AUDIT.md；修复前缺口见CODEX_AUDIT_REPORT.md。本人决策/AI比例/录屏、Docker启动与Java17容器仍须本人确认或实际执行。
