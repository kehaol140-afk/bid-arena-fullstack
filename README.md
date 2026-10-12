# bid-arena-simulator（Bid Arena QA / DevOps 工作区）

分支 `feat/simulator`：多人拍卖模拟器、黑盒/端到端测试、Docker 编排与验收文档。
后端为 `backend/`（Solon 3.10.7 检查点快照，由主仓库并行开发，本分支不修改）；`frontend/` 由前端团队并行交付。

## 一键本地启动 / 停止（Windows 演示，推荐）

前置：JDK 17+、Maven、Node >=22.6、MySQL 8 运行中（root 密码默认 `123456`，可用参数覆盖）。

```powershell
cd E:\全栈测试-拍卖间\bid-arena-fullstack

# 启动（依赖检查 -> 自动构建(如需) -> 端口检查 -> Solon 后端 8090/8091 -> 等待迁移+种子+健康检查 -> Vue 前端 5173）
powershell -ExecutionPolicy Bypass -File scripts\start-local.ps1

# 停止（只停本脚本启动/记录的进程；不动其他 Java/Node 程序；不碰数据库与文件）
powershell -ExecutionPolicy Bypass -File scripts\stop-local.ps1
```

启动成功后访问与账号：

| 项 | 值 |
|---|---|
| 浏览器入口 | http://localhost:5173 |
| 后端健康检查 | http://127.0.0.1:8090/api/v1/health |
| WebSocket | ws://127.0.0.1:8091/ws/auction |
| 管理员 | admin@example.com / Admin123456!（ADMIN） |
| 真人用户 | bidder_a@example.com、bidder_b@example.com / Test123456! |
| 模拟用户 | bot_01..bot_20@example.com / Test123456! |

演示流程：管理员登录 → 创建拍卖（可设 3~3600s 时长）→ 启动拍卖 → 切换 bidder_a/b 登录 → 进入拍卖间“加入”→ 出价；页面实时显示价格、被超通知、钱包余额/冻结/流水变化。

常用参数（可选）：`-Database bid_arena`（默认，绝不重置已有数据）、`-DbPassword <密码>`、`-HttpPort 8090 -WsPort 8091 -FrontendPort 5173`（前端代理默认指向 8090，改后端端口需同步 `frontend/vite.config.ts`）。

行为说明与排错：

- **幂等安全**：不重置/不删除数据库；启动时仅执行 Flyway 迁移 + 幂等种子（已存在账号/钱包不重复创建）。
- **防重复启动**：端口已被本栈占用且健康时直接复用；被无关进程占用则报错退出并提示 PID。
- **日志**：后端 `logs\backend-*.log`、前端 `logs\frontend-*.log`、应用日志 `logs\solon.log`，停止后保留。
- **失败提示**：MySQL 未启动/密码错误、端口冲突、健康检查超时等均给出明确原因与日志 tail。
- **已知干扰**：本共享机上偶发外部进程对新启动的 java 发送 Ctrl+C（QA-004，日志特征为仅含 `^C` 的 2 字节日志）；脚本内置 5 次重试，重跑即可。
- 栈运行时快速自检（管理员登录/建场/启动/出价/WS 推送/资金冻结解冻，14 项）：

```powershell
node scripts\verify-demo.mjs
```

## 5 分钟启动（本地 PowerShell，无需 Docker）

```powershell
# 0) 前置：JDK 17+、Maven、Node >=22.6、MySQL 8 运行中（root 密码按本机）
cd E:\全栈测试-拍卖间\bid-arena-fullstack

# 1) 构建后端（首次约 1-2 分钟）
& "C:\Users\lenovo\tools\apache-maven-3.9.9\bin\mvn.cmd" -q -DskipTests -f backend\pom.xml package

# 2) 准备隔离测试库（一次性；绝不触碰共享库 bid_arena）
& "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe" -uroot -p<密码> -e "CREATE DATABASE IF NOT EXISTS bid_arena_sim CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

# 3) 一键：启动后端（8190/8191 + bid_arena_sim，自动迁移+种子）→ 跑 20 人模拟 → 停止
npm install   # 仅 typescript（devDependency，运行时零依赖）
powershell -ExecutionPolicy Bypass -File scripts\run-sim-local.ps1 -SimArgs @('--auctionId=1','--bots=20','--seed=42')

# 4) 查看结果：控制台三态汇总 + simulator/reports/*.json（40 项检查，PASS/FAIL/NOT_VERIFIED）
```

对**已运行**的后端直接模拟（默认 8090/8091）：

```powershell
npm run simulate:auction -- --auctionId=1 --bots=20 --seed=42
```

## 5 分钟启动（Docker，评审环境）

```powershell
cp .env.example .env         # 修改 MYSQL_ROOT_PASSWORD
docker compose up -d --build # mysql(healthcheck) -> backend(healthcheck)，自动 Flyway 迁移+幂等种子
docker compose ps            # 双服务 healthy
Invoke-RestMethod http://localhost:8090/api/v1/health
# 前端就绪后：docker compose --profile full up -d --build
```

> 注：开发机未安装 Docker，Compose 已过 22 项静态校验 + YAML 解析，容器拉起为 NOT_VERIFIED（docs/QA_BLOCKERS.md QA-006）。

## 种子账号（DatabaseInitializer 幂等种子）

| 账号 | 密码 | 角色 |
|---|---|---|
| admin@example.com | Admin123456! | ADMIN |
| bidder_a/b@example.com、bot_01..bot_20@example.com | Test123456! | USER |

钱包初始 1000 积分；拍卖默认 起拍 100 / 最小加价 10 / 时长 180s（可创建 3~3600s 测试拍卖）。

## 目录

```
simulator/        Node22+TS 零依赖模拟器（npm run simulate:auction）
scripts/          start-local.ps1 / stop-local.ps1（本地演示一键启停）
                  run-sim-local.ps1（一键 QA）/ verify-demo.mjs（栈自检 14 项）
                  check-compose.ps1（静态校验）/ stop-backend.ps1 / browser_e2e.*
docker/           backend.Dockerfile（多阶段构建）
docs/             API_CONTRACT / TEST_CASE_MATRIX / SIMULATION_TEST_REPORT / QA_BLOCKERS
docker-compose.yml mysql8 + solon backend（+frontend @profile full）
```

## 当前质量快照（2026-10-12 本地演示轮，详见 docs/SIMULATION_TEST_REPORT.md）

- 一键本地栈 `start-local.ps1` / `stop-local.ps1`：冷启动、复用、停止、端口释放全链路实测通过
- 栈自检 verify-demo.mjs：14/14（管理员登录/建场/启动、真人出价、WS 跨用户推送、资金冻结/解冻/流水）
- 浏览器 E2E（headless Edge + CDP）：9/9（UI 登录/列表/房间/加入/UI 出价/WS 实时推送/钱包视图/成交结算）
- 前端 Vitest：20/20；20 人模拟 seed=42 / seed=7 均 41 PASS；Agent API 18/18；后端冒烟 18/18
- 历史阻塞 QA-001/QA-005 已修复（登录 401、WS 未监听）；QA-004 外部 ^C 干扰由启动脚本内置重试缓解
