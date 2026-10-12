# Bid Arena 集成修复第一轮门禁报告（R0 / R1 / R2）

- 日期：2026-10-12
- 分支：`main`（本地领先 origin/main 15 commits，未 push）
- 最终 commit：`ea82eae`
- 工程师：OpenCode 集成修复（第一轮）
- 数据库：本机 MySQL 8.0.45。开发库 `bid_arena` 未动；全部 HTTP/DB 验证在独立测试库 `bid_arena_test`（每轮破坏性验证前 DROP/CREATE 重建，由 Flyway V1 + 启动幂等种子自动恢复）

---

## R0 环境确认 ✅

| 项 | 结果 |
|---|---|
| main 最新合并 | `864ea3d`（simulator）、`a5bd396`（Vue 前端）均已并入 |
| Java | 21.0.2（路径 `D:\New Folder\jdk12\bin`，目录名误导实为 JDK21） |
| Maven | 3.9.9（`C:\Users\lenovo\tools\apache-maven-3.9.9`，不在 PATH） |
| MySQL | 8.0.45 root@localhost:3306，库：bid_arena（开发）/ bid_arena_sim / bid_arena_test，三库 Flyway V1 均成功 |
| 旧进程 | 发现 2 个遗留后端（PID 29460/66832，来自 `target\classes`）占用 8090/8091，已用 `scripts/stop-backend.ps1` 停止 |
| 编译 | `mvn -q compile` EXIT=0 |
| 未提交遗留 | A 的 `pom.xml`（-parameters）、`CamelRowConverterFactory.java`、`scripts/smoke_e2e.ps1` 已验证有效并提交（0367d66） |
| 前端/模拟器 | 已在仓库（frontend/、simulator/），本轮未改动 |

## R1 BUG-3 出价路由冲突 ✅（已修复并回归）

**根因**：Solon 中裸 `@Mapping`（无方法注解）匹配任意 HTTP 方法，且优先于同路径的 `@Post` 映射。
`BidController.list`（BidController.java:56）与 `@Post place` 同挂 `/api/v1/auctions/{id}/bids`，
POST 出价被 `list` 拦截 → 返回 `{"code":0,"data":[]}` 假成功，不落库、不冻结。

**修复前复现**（真实 HTTP + MySQL，bid_arena_test）：

```
POST /api/v1/auctions/2/bids  → {"code":0,"message":"ok","data":[]}   # data 是数组 = list 处理器
DB: bids WHERE auction_id=2 → 0 行; wallets.user2.frozen = 0
```

**修复**：所有读语义 handler 显式加 `@Get`（commit 79455b6）：
- `BidController.list`（本 bug）
- `AgentController.bids`（与 `@Post bid` 同路径，同样的坑，预防性修复）
- `AdminAgentTokenController.list`（与 `@Post create` 同路径，同上）
- `AuctionController.list/detail/events`、`WalletController.me/ledger`、`UserController.me`、`HealthController`（显式化）

**修复后真实回归**（六项证据齐全）：

```
POST /bids → data:{bidId:1, currentPrice:110, seq:3}        # 真正调用 BidService
DB: bid_count=1; request_id=bug3-repro-3 已保存
DB: auctions → price=110, leader=2                          # 最高价合法变化
DB: wallets.user2 → frozen=110                              # 领先者冻结正确
GET /bids → count=1                                         # 可读回新出价
```

## R2 完整出价与结算冒烟 ✅（18/18 PASS）

**过程中发现并修复的两个真实阻塞**（commit ea82eae）：

1. **空库启动竞态**：`Solon.start()` 返回后 HTTP 立即监听，但 Flyway 迁移+种子还在进行。
   health 返回 UP → 冒烟立即登录 → `users` 表不存在 → 500。A 之前"6/11"的部分失败与此有关。
   修复：`App.dbReady` 标志 + `HealthController` 在种子完成前返回 `status=STARTING`；
   冒烟就绪判定改为 `status -eq "UP"`。
2. **smoke_e2e.ps1 三处脚本 bug**：settle 轮询用空 header 导致 401（`/api/**` 需认证是正确后端语义）；
   FAIL 计数未 `@()` 包裹（单条 FAIL 时 `$fail` 为空 → 有 FAIL 也 exit 0 的假 PASS）；
   catch 块 `Get-Process java | Stop-Process` 会误杀共享机上其他 agent 的 Java 进程。

**最终结果**（`scripts/smoke_e2e.ps1 -Db bid_arena_test`，真实 HTTP + MySQL）：

```
backend boot + health                  PASS  UP
admin login                            PASS  role=ADMIN
bidder_a/b login                       PASS  A=id2 B=id3
admin create auction(6s)               PASS  auctionId=2
admin start auction                    PASS  status=RUNNING
A/B join                               PASS  joined
A bid 110                              PASS  price=110
B bid 130                              PASS  price=130
freeze check (A released, B holds 130) PASS  A frozen=0 B frozen=130
ledger check                           PASS  A[UNFREEZE,FREEZE] B[FREEZE]
auto settle after expiry               PASS  FINISHED winner=3 price=130 reason=EXPIRED
post-settle funds (B=870/0, PAY)       PASS  payLedger=1
recovery auction bid 110               PASS
A frozen=110 before crash              PASS
backend killed (simulate crash)        PASS
backend restart                        PASS
scanner resume settle after restart    PASS  FINISHED winner=2 reason=EXPIRED
post-resume funds (A=890/0)            PASS
TOTAL=18 PASS=18 FAIL=0  exit=0
```

**DB 可追溯性**（冒烟后直接查库）：
- `auction_results` 每场恰好 1 条成交（2→winner3@130，3→winner2@110）
- `wallet_ledger` 完整链：FREEZE110→UNFREEZE110（被超价）→FREEZE130→PAY-130（870/0）→FREEZE110→PAY-110（890/0）

**边界检查**（`scripts/edge_checks.ps1`，12/12 PASS，含后端重启）：

| 检查 | 结果 |
|---|---|
| 低于最小加价 105<110 → 2002 BID_TOO_LOW | PASS |
| amount=0 → 1005 VALIDATION | PASS |
| 缺 requestId → 1005 VALIDATION | PASS |
| 合法出价 + DB 恰好 1 行 + frozen=110 | PASS |
| 同 requestId 同金额重试 → idempotentReplay=true，bidId 不变，DB 不新增 | PASS |
| 同 requestId 不同金额 → 2005 IDEMPOTENT_CONFLICT | PASS |
| 超余额 5000 → 2003 INSUFFICIENT_FUNDS（"可用 890"提示正确） | PASS |
| 强制到期后扫描器结算 | PASS |
| 结算后重启后端、扫描器多轮重扫 → PAY=1→1、result_rows=1、余额不变（不重复扣款） | PASS |

**既有测试**：`mvn test` EXIT=0，Bug1FindDueIdsRegressionIT 2/2。

## 修改文件

| 文件 | 变更 | commit |
|---|---|---|
| backend/pom.xml、config/CamelRowConverterFactory.java、scripts/smoke_e2e.ps1 | A 遗留修复落地（-parameters / 驼峰行映射 / 冒烟脚本） | 0367d66 |
| bid/BidController、agent/AgentController、agent/AdminAgentTokenController、auction/AuctionController、wallet/WalletController、user/UserController、common/HealthController | BUG-3：全部读 handler 显式 @Get | 79455b6 |
| App.java、common/HealthController.java | dbReady 门禁：种子完成前 health=STARTING | ea82eae |
| scripts/smoke_e2e.ps1 | 就绪判定/认证轮询/FAIL计数/进程清理 | ea82eae |
| scripts/edge_checks.ps1 | 新增：边界回归脚本 | ea82eae |

## 实际运行的主要命令

```
mvn -q compile                                        # EXIT=0（JAVA_HOME=D:\New Folder\jdk12）
powershell scripts/smoke_e2e.ps1 -Db bid_arena_test   # 18/18 PASS
powershell scripts/edge_checks.ps1 -Root <repo>       # 12/12 PASS
mvn -q test                                           # 2/2 PASS（Bug1 回归 IT）
mysql -uroot bid_arena_test -e "..."                  # 全程 DB 取证
```

## 未完成 / 下一轮遗留

- 模拟器 20 人场景套件未重跑（登录阻塞已解除，具备条件，属下一轮）
- Docker 仅静态验证（无 Docker 环境，维持现状）
- WebSocket 复杂重连、多实例并发、UI 样式、安全审计、20 人压测：按任务边界留待下一轮
- `bid_arena_test` 本轮末尾留存 edge 检查数据（auction 2 FINISHED）；`bid_arena`（开发库）全程未改动
- 本地领先 origin 15 commits，未 push（未获指令）

## 结论：能否进入下一轮模拟测试

**能。** 主链路（登录→建拍→启动→加入→出价→冻结/释放→到期结算→崩溃恢复）与幂等/拒付边界
均通过真实 HTTP + MySQL 验证，出价假成功路由缺陷已修复并有回归脚本防护；
B 报告的"登录 1001 阻塞"与 C 报告的"登录 NOT_VERIFIED"在当前 main + 正确数据库下均不复现。
