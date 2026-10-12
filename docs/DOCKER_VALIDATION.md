# Bid Arena Docker 真实部署与最终工程验收

日期：2026-10-12。执行者：OpenCode/GLM（本轮Docker验收；非Codex）。仓库 E:/全栈测试-拍卖间/bid-arena-fullstack，分支 audit/codex-final，起点 bffeba7（工作区干净）。本报告只记录本轮实际执行的结果；未执行的项目明确标 NOT_VERIFIED，不以静态检查或前任标签代替运行证据。

## 1. 环境与版本

| 项 | 实际值 |
|---|---|
| Docker Engine | 29.8.2（Docker Desktop 4.95.0，linux/amd64，context=desktop-linux，Linux容器模式） |
| Docker Compose | v5.6.0（Compose V2） |
| 镜像拉取验证 | `docker run --rm hello-world` 实际输出 "Hello from Docker!" |
| 容器内 Java | OpenJDK 17.0.20.1（Temurin-17.0.20.1+1，eclipse-temurin:17-jre，Ubuntu 26.04.1）——`docker exec ... java -version` 实测 |
| 容器内 MySQL | 8.0.46（mysql:8.0 官方镜像） |
| CLI 说明 | docker.exe 不在系统PATH，位于 `%LOCALAPPDATA%\Programs\DockerDesktop\resources\bin`，本轮会话内前置该目录后使用 |

## 2. 隔离部署（不触碰原开发环境）

原开发实例端口 8090/8091/5173 本轮全程未修改（验收结束时 netstat 显示这三个端口无监听，即原实例当时并未在运行；本验收未启动也未停止任何 80xx/5173 进程）。全部操作使用独立项目与端口：

```
# .env（随机生成 MYSQL_ROOT_PASSWORD，不入Git；.gitignore 已覆盖）
MYSQL_PORT=13306
BACKEND_HTTP_PORT=18090
BACKEND_WS_PORT=18091
FRONTEND_PORT=15173

docker compose -p bid-arena-codex-check --profile full config     # 校验通过
docker compose -p bid-arena-codex-check --profile full build      # backend+frontend 均成功
docker compose -p bid-arena-codex-check --profile full up -d
docker compose -p bid-arena-codex-check --profile full ps
docker compose -p bid-arena-codex-check --profile full logs --tail 100
```

- 项目名 `bid-arena-codex-check`，数据卷 `bid-arena-codex-check_mysql-data`（CreatedAt 2026-10-12T14:55:04Z）。
- 构建产物：`bid-arena-codex-check-backend:latest`（7a0cfc1fc6a5，478MB，多阶段 maven:3.9-eclipse-temurin-17 构建）、`bid-arena-codex-check-frontend:latest`（0b6c354caa68，74MB，node:22-alpine 构建 + nginx:1.27-alpine 运行）、`mysql:8.0`（7dcddc01f13b）。
- 未执行 `down -v`、`system prune`、删除镜像或卷；未对仓库硬编码任何真实密码。

## 3. 容器服务状态（最终）

| 容器 | 状态 | 端口 |
|---|---|---|
| bid-arena-codex-check-mysql-1 | healthy（mysqladmin ping） | 13306→3306 |
| bid-arena-codex-check-backend-1 | healthy（/api/v1/health status=UP，迁移+种子门禁后） | 18090→8090，18091→8091 |
| bid-arena-codex-check-frontend-1 | healthy（nginx 首页 200） | 15173→80 |

## 4. 功能验收结果（17项全部PASS）

验收方式：真实HTTP请求（PowerShell + .NET ClientWebSocket）+ `docker exec` 直连容器MySQL核对 + 容器日志。脚本暂存于本机临时目录（不入仓库），关键断言与原始输出摘录如下。

| # | 验收项 | 结果 | 实际证据 |
|---|---|---|---|
| 1 | Java17真实运行 | PASS | 容器内 `java -version`：17.0.20.1 Temurin（JVM实际以17运行，非仅编译目标） |
| 2 | Solon后端正常启动 | PASS | /api/v1/health `{"status":"UP"}`；日志含 Flyway/种子完成 |
| 3 | MySQL8正常启动 | PASS | mysql:8.0 healthy；SELECT VERSION()=8.0.46；utf8mb4/UTC参数生效 |
| 4 | 自动Flyway迁移 | PASS | 日志实际执行 V1 init schema、V2 hold lookup index；flyway_schema_history 2行 success=1 |
| 5 | 自动创建种子用户 | PASS | users=24；auction_agent@example.com=AGENT/ACTIVE；admin/bidder_a/b 均可登录 |
| 6 | 创建DRAFT演示拍卖 | PASS | 初始化日志 "created demo DRAFT auction"；SQL DRAFT计数≥1 |
| 7 | 管理员登录 | PASS | admin@example.com → role=ADMIN，Bearer会话可用 |
| 8 | 创建并启动拍卖 | PASS | POST admin/auctions → DRAFT；POST /start → RUNNING，endTime>startTime |
| 9 | 两个普通用户加入 | PASS | bidder_a/b join 后 auction_participants=2 |
| 10 | 出价、冻结、释放 | PASS | a出110：frozen=110；b出150：a frozen=0、b frozen=150、hold对账一致（差额冻结语义正确） |
| 11 | WebSocket连接与实时更新 | PASS | 直连18091与经nginx15173/ws/升级两条路径均收到 CONNECTION_STATE→AUCTION_SNAPSHOT→BID_ACCEPTED（信封含seq/serverTime/auctionId） |
| 12 | 最后五秒延时 | PASS | 8秒场内4次狙击：extendsSeen=3、db extend_count=3（第4次不再延时，上限3生效） |
| 13 | Agent Token签发与受限Agent出价 | PASS | 管理员签发绑定auctionId的read+bid Token；DB仅存SHA256摘要；Agent Token访问admin/普通钱包路由均401；`node scripts/auction-agent.mjs` 实际以110出价并成交（winner=agent用户，FINISHED） |
| 14 | 自动结算 | PASS | 到期后Scanner（1s间隔）自动FINISHED，无需人工 |
| 15 | 资金流水及唯一成交记录 | PASS | auction_results每场恰1行；PAY恰1笔；不变式 ΣFREEZE−ΣUNFREEZE+ΣPAY−holds=0 成立（例：280−110−170=0）；结算后三方frozen全为0 |
| 16 | 容器重启后数据持久化 | PASS | `compose restart`（含MySQL重启）后：auctions/results/users/bids/ledger计数全等、wallets逐行MD5哈希一致、DRAFT仍在、重启前签发的会话Token仍可用、nginx/后端恢复healthy |
| 17 | 已到期未结算状态的恢复 | PASS | 停backend→SQL将已出价场置为SETTLING（模拟两阶段结算间崩溃）→重启backend→Scanner自动恢复为FINISHED；3次重复验证（auction 30/31/32）：均唯一result(winner=2,110)、恰1笔PAY=-110、残留holds=0 |

补充核对：nginx同源代理 `/api/v1`、`/openapi.json`（实际返回Swagger2 JSON）、`/ws/`升级均工作；首页HTML正常（title="Bid Arena · 竞拍大厅"）；backend日志0处明文bat_ Token；nginx /ws/ access_log off 生效（0条token=记录）。

## 5. 自动迁移与种子

新卷首次启动：Flyway V1→V2 实际执行（约1.1s）→ DatabaseInitializer 幂等种子（24用户、演示DRAFT场、钱包1000）。重启后再启动日志仍为 "seed done (idempotent)"，未重置任何余额。

## 6. 出现的错误与处置（均为验收工具/测试夹具问题，无项目代码缺陷）

1. docker CLI 不在PATH（用户级Docker Desktop安装）→ 会话内前置resources\bin，不改系统。
2. 验收脚本初版缺陷：事件名误写BID_PLACED（实际BID_ACCEPTED）、ledger列名误用entry_type（实际type）、extends_count（实际extend_count）、PowerShell大小写不敏感变量覆盖、A2先join后start。逐一修正后全PASS——这些是测试脚本错误，不是后端缺陷。
3. 多次半途失败迭代耗尽测试钱包 → 以带 `GRANT` 流水的SQL夹具为用户2/3/4各补2000（账实一致，remark注明来源；该库为本验收独立新建卷，无用户数据）。
4. PowerShell 5.1 对docker compose stderr的2>&1合并偶发死锁 → 改用Start-Process重定向执行restart；`docker compose restart` 本身正常。
5. 400"userId与auctionId必填"一次 → 上述变量覆盖所致，服务端校验行为正确。

## 7. 未验证边界（NOT_VERIFIED）

- 多实例后端WS即时跨进程广播（沿用Codex结论：DB资金唯一结算已测，跨实例事件需SYNC/轮询兜底）。
- 断电/fsync中途、网络分区、MySQL主从故障、长时高压（沿用Codex边界）。
- 生产TLS/WSS部署与公网安全加固（本轮为本地HTTP明文评审环境）。
- 真实浏览器人工操作录屏（本轮以协议级HTTP/WS验证容器链路；浏览器E2E沿用Codex本地轮证据，未在Docker端口重跑）。
- Swagger网页UI（仅提供/openapi.json，与Codex轮一致）。
- Compose down后重新up的长周期数据保留（只做了restart级验证；未执行down -v按约束）。

## 8. 结论

Docker隔离部署真实可用：Java17容器实际运行、迁移/种子/业务闭环/结算/恢复/持久化17项全部通过。Codex审计中的"Docker/Java17 NOT_VERIFIED"两项在本轮补齐为PASS。剩余未验证边界见上节，不影响单实例部署交付结论。
