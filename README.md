# bid-arena-simulator（Bid Arena QA / DevOps 工作区）

分支 `feat/simulator`：多人拍卖模拟器、黑盒/端到端测试、Docker 编排与验收文档。
后端为 `backend/`（Solon 3.10.7 检查点快照，由主仓库并行开发，本分支不修改）；`frontend/` 由前端团队并行交付。

## 5 分钟启动（本地 PowerShell，无需 Docker）

```powershell
# 0) 前置：JDK 17+、Maven、Node >=22.6、MySQL 8 运行中（root 密码按本机）
cd E:\全栈测试-拍卖间\bid-arena-simulator

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
scripts/          run-sim-local.ps1（一键 QA）/ check-compose.ps1（静态校验）/ stop-backend.ps1
docker/           backend.Dockerfile（多阶段构建）
docs/             API_CONTRACT / TEST_CASE_MATRIX / SIMULATION_TEST_REPORT / QA_BLOCKERS
docker-compose.yml mysql8 + solon backend（+frontend @profile full）
```

## 当前质量快照（2026-10-11，详见 docs/SIMULATION_TEST_REPORT.md）

- 模拟器 40 项检查：PASS=1（健康检查）/ FAIL=1 / NOT_VERIFIED=38
- **P0 阻塞 QA-001**：后端 SqlUtils Bean 映射不支持 snake_case → 登录全量 401（独立 JVM 探针已定证据）
- **P0 阻塞 QA-005**：WebSocket 未监听任何端口
- 修复后回归：无需改模拟器，重跑同一条命令即可
