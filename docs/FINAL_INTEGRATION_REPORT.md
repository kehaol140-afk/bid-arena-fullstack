# Bid Arena 最终集成测试报告（FINAL_INTEGRATION_REPORT）

- 日期：2026-10-12
- 分支：`main`；本轮起点 `670ffb4`，终点 `194261e`（本报告提交前最新）
- 测试库：`bid_arena_sim`（20人模拟，每轮 DROP/CREATE 重建）、`bid_arena_test`（冒烟/边界/Agent/浏览器）；开发库 `bid_arena` 全程未动
- 环境：JDK 21.0.2 / Maven 3.9.9 / MySQL 8.0.45 / Node 22.18 / 无 Docker（主机未安装）

---

## 1. 实际运行命令

```powershell
# 后端构建（JAVA_HOME=D:\New Folder\jdk12）
& "C:\Users\lenovo\tools\apache-maven-3.9.9\bin\mvn.cmd" -q -DskipTests package -f backend\pom.xml

# 任务1：20人模拟（自启动后端 8190/8191 + bid_arena_sim，单次调用完成启动→模拟→停止）
powershell scripts\run_sim20-style 一次性脚本（等价：自启动后端后）
  node --experimental-strip-types simulator\src\main.ts --baseUrl=http://127.0.0.1:8190 --wsBase=ws://127.0.0.1:8191 --bots=20 --seed=42   # 与 --seed=7
# 报告：simulator/reports/sim-run-2026-10-12T04-25-44-332Z.json（seed42）
#       simulator/reports/sim-run-2026-10-12T04-30-23-635Z.json（seed7）

# 回归
mvn -q test -f backend\pom.xml                                   # JUnit 2/2
powershell scripts\smoke_e2e.ps1 -Db bid_arena_test              # 18/18
powershell scripts\edge_checks.ps1                               # 12/12

# 任务2：浏览器真实联调（headless Edge + 原生 CDP，零依赖）
powershell scripts\browser_e2e.ps1                               # 9/9，截图 docs/e2e_screenshots/*.png
cd frontend; npm run test                                        # Vitest 20/20
cd frontend; npm run build                                       # vue-tsc + vite PASS

# 任务3：Agent API
powershell scripts\agent_api_checks.ps1                          # 18/18

# 任务4：Docker
powershell scripts\check-compose.ps1                             # 静态 PASS；runtime NOT_VERIFIED
```

## 2. 任务1：20人模拟结果 ✅

**seed=42 与 seed=7 均：PASS=41 FAIL=0 NOT_VERIFIED=1，exit=0**
（唯一 NOT_VERIFIED：P2-2 列表倒序——检查时点库中仅 1 场拍卖无法判定；已用 HTTP 实测补偿验证 ids=4,3,2,1 降序）

覆盖并通过（两轮一致）：20 用户登录/登出失效/错误密码、20 人 join 幂等+计数、10 次递增出价、
3人同价并发恰 1 成功、相邻价并发、**4路同 requestId 并发全 200 且库中恰 1 条（3 重放）**、
串行幂等重放、同号冲突 2005、低价 2002、拒绝无副作用、余额不足（边界+巨额）、迟到 2004/终态 2001、
**WS 连接即推 CONNECTION_STATE+SNAPSHOT、在线 seq 单调无缺口、断线重连 SYNC 补发+快照、快照与 HTTP 一致**、
最后5秒延时 3 次逐次校验+AUCTION_EXTENDED 落库+第4次不延时、到期自动结算、result 正确、
FINISHED 后拒单、20人冻结回收+余额守恒、流水恒等式、成交唯一且等于最高出价。

**本轮暴露并修复的 3 个真实缺陷（均为阻塞主流程，修复后全绿）：**

| 缺陷 | 根因 | 修复 | commit |
|---|---|---|---|
| QA-005 WS 任何端口不监听（历史阻塞） | SolonApp 默认 `_enableWebSocket=false`，NettyWsPlugin.start 见 false 直接 return；反汇编 NettyWsPlugin/SolonApp 证实 | App.main builder 中 `app.enableWebSocket(true)` | 2c92d42 |
| WS 连接秒断（sessions NPE） | WsConfig 构造期 `Solon.context().getBean` 早于 bean 就绪 → 字段恒 null，onOpen 即 NPE | 改为首个连接惰性解析 resolveBeans() | 2c92d42 |
| 并发同 requestId 出价 MySQL 1213 死锁×3（500） | requestId 幂等检查（FOR UPDATE 空区间 gap 锁）位于拍卖行锁之前：4 事务各持 bids 索引 gap 锁 → 领先者 INSERT 插入意向锁被阻 → 后续事务又在等拍卖行锁 → 环形等待 | 幂等检查移入拍卖行锁之后（串行化点内锁定读可见已提交行 → 干净重放路径） | 2c92d42 |
| （伴随发现）GET /bids 缺 request_id 字段 | BidVO 未含 requestId/createdAt，违反 API_CONTRACT §3 | BidVO 补字段并在 list/agent 响应填充 | 2c92d42 |

**模拟器工具 bug 修复（不动断言）**：`ApiClient.login()` 成功后未 setToken → 全部认证请求裸奔 401（登录修复后暴露）；P9-3 把快照信封的"当前 seq"误计入事件序列（DB 证据：auction_events 无重复 seq）。（commit 3b8ad40）

## 3. 任务2：浏览器端到端结果 ✅ 9/9

headless Edge（CDP 直驱，无 Playwright 依赖）：登录页渲染→bidder_a 真实登录（token 持久化+路由跳转）→
列表→房间（起拍价 100）→UI 加入→UI 出价 110（HTTP）→ **bidder_b 经 API 出价 150 后浏览器内价格实时跳变 + "你已被超越"通知（WebSocket 实时性实证）** →钱包页（余额/冻结/流水）→
到期自动结算后房间显示"🎉 拍卖成交 · 得主 竞拍者B，成交价 150"（WS AUCTION_FINISHED 应用）。
截图 9 张：`docs/e2e_screenshots/01..09*.png`。
前端 Vitest 20/20、`npm run build`（vue-tsc 类型检查）PASS。

## 4. 任务3：Agent API 与 WebSocket 结果 ✅ 18/18

签发（bat_ 前缀 68 字符、明文仅一次）、/agent/me、范围内读、**范围外 403/3002**、只读 token
join/bid **403/3003**、**过期 401/3001**、**吊销即时 401/3001**、**固定窗口限流 5/min 第 6 次 429/3004**、
缺 token/伪造 token 401、用户会话 token 不被 Agent API 接受、Agent 出价复用 BidService 且正确冻结归属钱包（+150）、
**DB 只存 sha256 摘要（实测 hash=sha256(明文)）+ 前 11 位前缀，全文检索 0 命中**。

**泄漏扫描**：后端日志（backend/logs、target、%TEMP% 本轮全部日志）、`git log --all -p` 全历史、
前端 src 与 dist（bat_ 正则）：**全部 0 命中**。dist 中存在演示账号一键填充（LoginView 公开种子凭据，
README 已公开，判定为已知演示特性而非泄漏——见第 6 节）。

WebSocket：模拟器 P9 四项 + 浏览器 S7/S9 双通道真实验证通过（见上）。

## 5. Docker 验证结果 ⚠️ runtime NOT_VERIFIED

- 主机未安装 Docker（诚实记录，不伪造通过）：**容器拉起未执行**
- 静态验证：`scripts/check-compose.ps1` PASS（YAML 解析、mysql8 参数/命名卷、多阶段构建、双健康检查、依赖编排、env 链路）
- 本轮部署改进：backend healthcheck 从 `code:0` 收紧为 `"status":"UP"`（对齐 App.dbReady 门禁，避免空库窗口被编排器判就绪）；
  新增 `frontend/Dockerfile`（node22 构建 + nginx，/api 反代 + SPA fallback，供 `--profile full`）
- 评审环境可复现命令：
  ```powershell
  cp .env.example .env          # 修改 MYSQL_ROOT_PASSWORD
  docker compose up -d --build
  docker compose ps             # mysql + backend 均 healthy（backend 需 status=UP）
  Invoke-RestMethod http://localhost:8090/api/v1/health
  docker compose --profile full up -d --build   # 前端（含 nginx 代理），访问 http://localhost:5173
  ```

## 6. 未修复问题与严重等级

| # | 问题 | 等级 | 说明/建议 |
|---|---|---|---|
| 1 | Docker 容器化运行时未验证 | P2-交付 | 本机无 Docker；静态 22 项 PASS + 上述复现命令，评审环境执行即可闭环 |
| 2 | 登录页演示凭据一键填充进 dist | P3-演示 | LoginView 内置 admin/bidder 种子账号填充（凭据在 README 公开）。演示便利特性；生产构建建议剥离（VITE_SHOW_DEMO_ACCOUNTS 开关） |
| 3 | WS 无鉴权心跳/连接数上限 | P3-加固 | WsConfig 只做会话校验；未限制单用户连接数/心跳超时，恶意连接可耗资源。留 Codex 评估 |
| 4 | agent_tokens 限流计数非严格原子 | P3 | countRequest 的 UPDATE+SELECT 非同事务，极端并发下窗口计数可略偏差（功能可用，未见实际触发） |
| 5 | 分页缺失（列表/流水固定 200 条） | P3 | API_CONTRACT §9 已声明 PLAN |
| 6 | 多实例部署未验证（单机单实例语义） | P3 | 拍卖行锁依赖 MySQL，多实例理论可行；WS 广播为单机内存实现，扩容需引入 pub/sub |
| 7 | 共享机环境干扰（QA-004） | P3-环境 | 工具启动的进程会被周期性 ^C；本轮用"单次调用内启动→验证→停止"规避；run-sim-local.ps1 的 WMI 方案在本机不可靠，建议后续统一用一次性脚本模式 |
| 8 | 旧共享库 bid_arena 种子凭据漂移（QA-003） | P3-数据 | 开发库 hash 为旧版本；本轮全程未动该库。运维决策是否重置 |

已解决的历史阻塞（对照 QA_BLOCKERS）：QA-001（BCrypt 映射，上一轮）、QA-002（扫描 NPE，上一轮）、
QA-005（WS 未监听 + WsConfig NPE，本轮 2c92d42）——QA_BLOCKERS.md 状态字段可由 Codex 复核后统一更新。

## 7. 关键代码位置

| 关注点 | 位置 |
|---|---|
| WS 启用开关（QA-005 根因修复） | backend/src/main/java/com/bidarena/App.java（main） |
| WS 监听器/惰性 bean/快照/SYNC | backend/src/main/java/com/bidarena/websocket/WsConfig.java |
| 出价事务（幂等检查在拍卖锁内——死锁修复） | backend/src/main/java/com/bidarena/bid/BidService.java:50-70 |
| 出价 VO（requestId/createdAt 契约） | backend/src/main/java/com/bidarena/bid/dto/BidVO.java + BidController.list |
| 结算扫描器 | backend/src/main/java/com/bidarena/settlement/SettlementScanner.java |
| Agent 认证/范围/限流 | backend/src/main/java/com/bidarena/agent/AgentAuthInterceptor.java、AgentTokenRepository.countRequest |
| health STARTING/UP 门禁 | backend/src/main/java/com/bidarena/App.java（dbReady）+ common/HealthController.java |
| 模拟器 token 修复 | simulator/src/api.ts（login 自动 setToken） |
| 浏览器 E2E | scripts/browser_e2e.mjs + scripts/browser_e2e.ps1 |
| Agent 检查 | scripts/agent_api_checks.ps1 |
| 冒烟/边界回归 | scripts/smoke_e2e.ps1、scripts/edge_checks.ps1 |

## 8. 给 Codex 的最终审计任务建议

1. **并发正确性复核（最高优先）**：对 BidService 锁序调整做形式化复核（auction 锁→钱包锁升序→bids 唯一索引）；
   用更高并发（>4 路同号、跨用户混合）与 jepsen 风格打靶验证无死锁/无幻象出价；检查 settlement 与 bid 并发窗口（SETTLING 期间迟到出价的 2001/2004 边界）。
2. **WS 加固**：单用户连接数上限、心跳空闲剔除、广播失败后的 seq 缺口补偿路径（HTTP /events 已有，验证前端 SYNC 兜底真实触发）。
3. **Agent 限流原子化**：countRequest 改为单条原子 SQL（UPDATE ... RETURNING 或应用层 CAS）并补 429 精确性测试。
4. **安全审计**：会话 token 存储策略（DB 明文 hash 可被离线爆破评估）、Admin 接口防重放、CORS/RateLimit 全局策略、演示凭据生产剥离。
5. **Docker 评审环境实测**：执行第 5 节命令闭环 QA-006；验证 compose healthcheck 在空卷首启的 STARTING→UP 时序。
6. **QA_BLOCKERS/TEST_CASE_MATRIX 状态翻新**：QA-001/002/005 已修复，矩阵 NOT_VERIFIED 行可全部按本轮实测结果更新（41/41）。
7. **数据治理**：bid_arena 共享库旧种子处置、增加 ledger 对账 SQL 到运维手册。

## 结论

五项任务全部完成：模拟 41/41（双种子）、浏览器 9/9、Agent 18/18、既有回归全绿
（smoke 18/18、edge 12/12、JUnit 2/2、Vitest 20/20、build PASS）、Docker 静态 PASS/runtime 如实 NOT_VERIFIED。
三个历史 P0/P1 阻塞（登录映射、WS 监听、出价死锁）已修复并有回归防护。**系统具备进入评审/演示状态的条件。**
