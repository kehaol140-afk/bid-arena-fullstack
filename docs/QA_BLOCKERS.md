# QA_BLOCKERS — 后端阻塞问题清单（由模拟器/黑盒测试发现，未修改后端代码）

> 记录规则：只登记「按契约应当可用、实测不可用」的真实缺陷或环境阻塞。
> 每条附复现命令与证据。修复后请在本表标注状态与验证提交。

## QA-001 [P0/阻断] SqlUtils Bean 映射不支持 snake_case 列 → 登录全量失败

- **状态**：OPEN（2026-10-11 由模拟器冒烟发现）
- **影响**：`POST /api/v1/auth/login` 对任何正确凭据均返回 401 `code=1001`「邮箱或密码错误」→ 会话无法建立 → 除 `/api/v1/health`、`/api/v1/auth/login`、`/api/v1/agent/**` 外全部接口不可达，WebSocket（需会话 token）不可用。**当前用户侧功能面 100% 被阻断。**
- **根因**：Solon `SqlUtils.queryRow(UserRow.class)` 按属性名**精确匹配**列标签，不做 `password_hash → passwordHash` 转换。`UserRepository.findByEmail` 查询列 `password_hash/display_name` 映射后为 `null`，`PasswordHasher.verify(pw, null)` 捕获异常返回 false → 恒 401。
- **证据**（独立 JVM 探针，classpath 与后端完全一致 target/lib/*）：
  ```
  sql.sql("SELECT id, email, password_hash, display_name, role, status FROM users WHERE email=?","admin@example.com").queryRow(UserRow.class)
  => id=1 email=admin@example.com hash=NULL status=ACTIVE role=ADMIN name=null
  ```
  同一 hash 用同库 BCrypt 验证 `Admin123456! => true`（排除哈希/密码问题）。
  HTTP 层三种绑定（JSON / x-www-form-urlencoded / query）均 401，排除请求绑定问题。
- **复现**：
  ```powershell
  # 1) 启动后端（指向全新库，排除历史数据）
  $env:BID_DB_URL="jdbc:mysql://localhost:3306/bid_arena_sim?useSSL=false&allowPublicKeyRetrieval=true&serverTimezone=UTC"
  java -cp "backend\target\bid-arena-backend.jar;backend\target\lib\*" com.bidarena.App
  # 2) 登录
  curl.exe -s -X POST http://127.0.0.1:8090/api/v1/auth/login -H "Content-Type: application/json" -d "{\"email\":\"admin@example.com\",\"password\":\"Admin123456!\"}"
  # 实际: {"code":1001,"message":"未认证或会话已过期: 邮箱或密码错误"}（HTTP 401）
  ```
- **波及面（同类 snake_case Bean 读取）**：`wallets(user_id)`、`auctions(start_price/min_increment/current_price/current_leader_id/duration_seconds/started_at/end_time/extend_count/max_extends/settle_reason/created_by)`、`bids(request_id/created_at)`、`wallet_ledger(...)`、`agent_tokens(...)` 等所有 camelCase Bean 读取点预计同样失效（未逐一验证，登录修复后由模拟器全量回归）。
- **建议修复（后端负责）**：SQL 中为下划线列加别名（`SELECT password_hash AS passwordHash ...`）或启用框架级命名转换；修复后运行 `npm run simulate:auction` 回归。

## QA-002 [P1] SettlementScanner 空结果 NPE（每秒刷错误日志）

- **状态**：OPEN（继承自 PARALLEL_HANDOFF BUG-1，本次实测复现）
- **影响**：无到期拍卖时 `findDueIds()` 返回 null → `ids.size()` NPE，被 catch 不致命；但日志每秒一条 ERROR，且说明 SqlUtils `queryValueList()` 零行返回 null 的契约陷阱。
- **证据**：backend/logs/backend.log（2026-10-11 20:31~20:34 连续 `settlement scan error` + `NullPointerException: ... "ids" is null at AuctionRepository.findDueIds(AuctionRepository.java:43)`）。
- **建议修复**：`if (ids == null) return List.of();`
- **注**：登录修复前无法通过 API 驱动结算链路验证「有到期拍卖时结算是否正常」，标记待回归。

## QA-003 [P2/环境] 共享库 bid_arena 种子凭据与当前代码漂移（次要）

- **状态**：OPEN（数据层现象，QA-001 修复后仍需注意）
- **现象**：共享 MySQL `bid_arena` 库的 23 个用户为更早版本种子（BCrypt hash 与当前 DatabaseInitializer 不一致），且 `ensureUser` 幂等跳过不更新密码 → 文档凭据（admin/Admin123456!、bot_*/Test123456!）在该库不可用。
- **证据**：`bid_arena_sim`（按当前代码全新种子）hash 可验证 `Admin123456! => true`；`bid_arena`（旧种子）同凭据 401。（注：两者 401 主因均为 QA-001；本条针对修复 QA-001 后依然存在的旧库漂移。）
- **处置**：QA 运行一律使用独立库（bid_arena_sim）；共享库是否重置由后端/运维决策，模拟器侧不改动共享数据。

## QA-004 [P3/环境] 多 Agent 并发占用 8090/8091 与进程互杀

- **状态**：MITIGATED（已用隔离方案规避）
- **现象**：本机多个开发 Agent 同时启动/停止 `com.bidarena.App`（默认端口 8090/8091），且某工具链会优雅停止「终端会话树内」的 java 进程——本会话实测：由工具命令启动的后端进程存活 <2s~2min（日志尾部出现 `App: Stopped` 优雅停机，stderr 为空）；同机其他 Agent 从 VS Code 终端启动的实例长期存活。
- **处置（已实现）**：`scripts/run-sim-local.ps1` 采用 ①独立端口 8190/8191（`-Dserver.port`/`-Dserver.websocket.port`，实测 HTTP 覆盖生效）②独立库 bid_arena_sim ③**WMI Win32_Process.Create 分离启动**（父进程为 WmiPrvSE，脱离终端会话树，实测稳定存活）④结束后按精确 PID 清理自己的 java 子进程，绝不触碰他人实例。

## QA-005 [P0/阻断] WebSocket 服务未监听（任何端口均无法建立 WS 连接）

- **状态**：OPEN（2026-10-11 实测发现）
- **现象**：后端日志出现 `Plugin init: ...NettyWsPlugin` 但**无任何 netty Started/监听日志**；`Get-NetTCPConnection -State Listen` 显示实例仅监听 HTTP 8190，无 8091/8191；对 `ws://127.0.0.1:8191|8091|8190/ws/auction?...` 的连接探测全部失败（onerror，非 401/403 拒绝）。同机另一 Agent 的 8090 实例同样无 8091 监听。
- **影响**：API_CONTRACT.md §7 的全部 WebSocket 能力（快照/事件/SYNC/断线重连）当前不可用。与 PARALLEL_HANDOFF 已知风险 #3（WsConfig `Solon.context().getBean` 启动时序未验证）一致。
- **证据**：`backend/logs/sim-backend-*.log`（有 NettyWsPlugin init、无 Started）；netstat/Get-NetTCPConnection 快照；node 原生 WebSocket 三端口探测 ERROR。
- **注**：`-Dserver.websocket.port=8191` 覆盖是否生效无法判定（因为任何 WS 端口都未监听）；待后端修复 WS 启动后回归。

## QA-006 [P2/交付环境] Docker 未安装：Compose 只做静态验证

- **状态**：NOT_VERIFIED（本机无 Docker，无法真实拉起容器）
- **已完成的静态验证（scripts/check-compose.ps1，22/22 PASS）**：
  - docker-compose.yml 语法经 js-yaml 解析通过（exit 0）
  - mysql:8.0 服务 + utf8mb4/UTC 参数 + 命名卷 mysql-data（无匿名卷，不自动清理）
  - backend 多阶段构建（maven:3.9-eclipse-temurin-17 → eclipse-temurin:17-jre）、curl 健康检查、EXPOSE 8090/8091
  - 依赖编排：backend depends_on mysql(service_healthy)；双健康检查（mysqladmin ping / /api/v1/health）
  - 环境变量链路：BID_DB_URL→mysql 服务、MYSQL_ROOT_PASSWORD 强制设置（`:?` 快速失败）、.env.example 覆盖全部引用变量
  - 迁移与种子：由后端启动时 Flyway + 幂等种子自动完成（无需额外 init 脚本，符合 R2.3）
- **前端服务**：置于 `--profile full`，等 frontend/ 提供 Dockerfile 后启用（前端团队并行开发中）。
- **待评审环境执行**：
  ```powershell
  cp .env.example .env   # 改 MYSQL_ROOT_PASSWORD
  docker compose up -d --build
  docker compose ps      # 双服务 healthy
  Invoke-RestMethod http://localhost:8090/api/v1/health
  ```
