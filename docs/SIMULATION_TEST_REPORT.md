# SIMULATION_TEST_REPORT — 20 人拍卖模拟真实运行报告

> 运行者：Agent-SIM（feat/simulator 分支）
> 日期：2026-10-11（本地）
> 被测：bid-arena-simulator 仓库 backend @ commit cae084b（Solon 3.10.7 检查点快照）
> 结论先行：**模拟器 40 项检查全部按真实响应判定；当前后端存在 P0 级缺陷 QA-001（登录全量失败），导致 38 项无法验证（NOT_VERIFIED）；已获得 1 项 PASS、1 项真实 FAIL。后端修复后无需改模拟器代码，直接重跑即可回归。**

## 1. 执行方式（可复现命令）

```powershell
# 前置：本机 MySQL80 运行中；Node >= 22.6；后端已构建（脚本会自动 mvn package）
cd E:\全栈测试-拍卖间\bid-arena-simulator
npm install            # 仅 devDependencies（typescript），运行时零依赖

# 方式一（推荐）：一键拉起隔离后端（WMI 分离进程 + 端口 8190/8191 + 独立库 bid_arena_sim）并运行模拟
powershell -ExecutionPolicy Bypass -File scripts\run-sim-local.ps1 -SimArgs @('--auctionId=1','--bots=20','--seed=42')

# 方式二：对已运行的后端直接运行（默认 http://127.0.0.1:8090）
npm run simulate:auction -- --auctionId=1 --bots=20 --seed=42 --json=simulator/reports/run.json
```

- 判定语义：**PASS**=对真实后端响应断言成立；**FAIL**=真实响应违反契约；**NOT_VERIFIED**=前置条件不满足（附原因）。
- 退出码：0=无 FAIL；1=存在 FAIL；2=后端不可达。
- 模拟器只调用公开 HTTP/WS 接口（docs/API_CONTRACT.md 全集），**零直连数据库、零业务数据修改**。

## 2. 真实运行结果（2026-10-11 21:44，bid_arena_sim 全新种子）

```
PASS=1  FAIL=1  NOT_VERIFIED=38   总体判定: FAIL（因后端 QA-001，非模拟器缺陷）
```

| 检查 | 场景 | 结果 | 说明 |
|---|---|---|---|
| P0-1 | 健康预检 | **PASS** | `GET /api/v1/health` → code=0, status=UP |
| P1-1 | 管理员登录 | **FAIL** | 401/1001「邮箱或密码错误」→ **QA-001**（见下） |
| P1-2..P1-5 | 认证冒烟（me/错密码/20 bot 登录/登出失效） | NOT_VERIFIED | 依赖登录 |
| P2-1..P2-3 | 拍卖列表/详情契约 | NOT_VERIFIED | 接口需 Bearer（QA-001） |
| P3-1/P3-2 | 主拍卖就绪 + 钱包基线 | NOT_VERIFIED | 依赖管理员登录 |
| P4-1..P4-4 | 20 用户加入/计数/幂等 join/无资金变动 | NOT_VERIFIED | 前置失败 |
| P5-1/P5-2 | 递增出价（价格/领先者/seq） | NOT_VERIFIED | 前置失败 |
| P6-1 | 两人+并发**同价**：恰一成功其余 2002 | NOT_VERIFIED | 前置失败 |
| P6-2 | 并发**相邻价**：终价为高价 | NOT_VERIFIED | 前置失败 |
| P6-3/P6-4 | 同 requestId 并发重放唯一落库；detail/bids 一致 | NOT_VERIFIED | 前置失败 |
| P7-1/P7-2 | requestId 重试幂等 / 2005 冲突 | NOT_VERIFIED | 前置失败 |
| P7-3/P7-4 | 金额过低（2002）/ 拒绝无副作用 | NOT_VERIFIED | 前置失败 |
| P8-1..P8-3 | 最后5秒狙击延时 / AUCTION_EXTENDED / 上限3次 | NOT_VERIFIED | 前置失败 |
| P9-1..P9-4 | WS 连接/seq 连续/断线重连 SYNC/快照一致 | NOT_VERIFIED | QA-001 + QA-005 |
| P10-1..P10-3 | 余额不足（边界 2003）/ 无副作用 | NOT_VERIFIED | 依赖管理员登录 |
| P10-4 | 迟到出价（2004/2001） | NOT_VERIFIED | 依赖管理员登录 |
| P11-1..P11-3 | 到期自动结算 / result 正确 / 终态拒单 2001 | NOT_VERIFIED | 前置失败 |
| P12-1..P12-3 | 钱包冻结回收/余额守恒/流水可解释/成交唯一 | NOT_VERIFIED | 前置失败 |

机器可读报告：`simulator/reports/c2-full.json`（40 条记录，含逐条证据字段）。

## 3. FAIL 根因（摘要，全文见 docs/QA_BLOCKERS.md）

- **QA-001（P0）**：Solon `SqlUtils.queryRow(Bean)` 不做 `password_hash→passwordHash` 映射 → 登录恒 401。
  独立 JVM 探针证据：`queryRow(UserRow) => hash=NULL status=ACTIVE`；同 hash 用同库 BCrypt 验证 `Admin123456!=>true`。
  在**全新库 bid_arena_sim**（当前代码种子）与共享库 bid_arena_sim 均复现 → 排除数据问题，属代码缺陷。
- **QA-005（P0）**：WebSocket 未监听任何端口（netstat 无监听 + 三端口连接探测失败）→ WS 场景双重阻塞。
- **QA-002（P1）**：SettlementScanner 空结果 NPE（日志每秒一条，复现于 backend/logs/sim-backend-*.log）。

## 4. 模拟器实现覆盖对照（需求 → 检查项）

| 需求场景 | 检查项 | 实现 |
|---|---|---|
| 20 用户加入 | P4-1..4 | phases/join.ts |
| 正常递增出价 | P5-1..2 | phases/increment.ts |
| 两人并发同价及相邻价格 | P6-1..4 | phases/concurrent.ts（真并发：同轮 Promise.all） |
| requestId 重试 | P7-1..2 | phases/idempotency.ts（串行重放 + 同号并发竞速 P6-3） |
| 余额不足 | P10-1..3 | phases/aux_funds_late.ts（辅助拍卖精确边界：冻结后仅剩 10，加价 20 → 2003） |
| 金额过低 | P7-3 | 低于最小加价 & 等于当前价 → 2002 |
| 迟到出价 | P10-4 | 过期后 250ms 出价 → 2004（结算抢先则 2001，如实记录） |
| 最后5秒狙击延时 | P8-1/P8-2 | endTime-3.5s 出价 → +10s + AUCTION_EXTENDED 同事务落库 |
| 延时上限 3 次 | P8-3 | 第 4 次：仍接受但 extended=false |
| 断线重连 | P9-1..4 | phases/reconnect.ts（断线制造缺口 → SYNC 补发 + 快照对齐 HTTP） |
| 结果与钱包核对 | P11 + P12 | 结算结果 + 20 人基线相对全量对账（冻结回收/余额守恒/流水恒等式/成交唯一） |

## 5. 回归指引（后端修复 QA-001/QA-005 后）

1. `git pull` 后端修复 → `mvn -q -DskipTests package`
2. 重跑方式一命令；期望 P1..P12 转为 PASS（若有业务缺陷将如实 FAIL）。
3. 模拟器本身无需任何改动；场景与断言已按契约冻结。

## 6. 环境备注（诚实声明）

- 本机多 Agent 共享：8090/8091 常被其他 Agent 占用且有进程互杀现象（QA-004），故 QA 运行采用 8190/8191 + WMI 分离启动 + 独立库 bid_arena_sim；对共享库 bid_arena 与他人进程零接触。
- 首次 smoke（20:31）与本报告运行均如上执行；所有 NOT_VERIFIED 均给出前置失败原因，无臆测通过。
