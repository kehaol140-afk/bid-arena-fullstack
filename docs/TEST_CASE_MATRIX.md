# TEST_CASE_MATRIX — 黑盒测试用例矩阵（对齐全栈评测-拍卖间.pdf 需求）

> 由 Agent-SIM 维护；自动化检查 ID 对应 `npm run simulate:auction` 输出（simulator/src/phases/*）。
> 状态基于 2026-10-11 真实运行（见 docs/SIMULATION_TEST_REPORT.md）：
> **PASS**=实测通过 · **FAIL**=实测发现缺陷 · **NOT_VERIFIED**=被 QA-001/QA-005 阻塞 · **MANUAL**=需人工。
> 复现命令统一为：`npm run simulate:auction -- --auctionId=1 --bots=20 --seed=42`（或 scripts\run-sim-local.ps1，见 README）。

## A. 认证与账号（PDF p3）

| 用例 | 前置 | 步骤 | 预期 | 自动化 | 状态 |
|---|---|---|---|---|---|
| A1 管理员登录 | 服务启动+种子 | POST /auth/login admin | 200, role=ADMIN | P1-1 | **FAIL**（QA-001） |
| A2 用户登录 | 同上 | bot_01..20 登录 | 全部 200 + token | P1-4 | NOT_VERIFIED |
| A3 错误密码 | — | 错密码登录 | 401/1001，不泄漏存在性 | P1-3 | NOT_VERIFIED |
| A4 登出失效 | A2 | logout 后旧 token 访问 | 401/1001 | P1-5 | NOT_VERIFIED |
| A5 /users/me 归属 | A2 | 查本人信息 | 返回本人 email/id | P1-2 | NOT_VERIFIED |

## B. 拍卖生命周期（PDF p2/p3/p4）

| 用例 | 步骤 | 预期 | 自动化 | 状态 |
|---|---|---|---|---|
| B1 管理员创建拍卖 | POST /admin/auctions | code=0 + auctionId；价格>0、时长 3~3600 校验 | P3-1 | NOT_VERIFIED |
| B2 启动（DRAFT→RUNNING） | POST /admin/auctions/{id}/start | RUNNING + endTime；不自动倒计时（R1.10） | P3-1 | NOT_VERIFIED |
| B3 20 用户加入 | join ×20 | participantCount=20 | P4-1/2 | NOT_VERIFIED |
| B4 重复 join 幂等 | 二次 join | 200 且计数不变 | P4-3 | NOT_VERIFIED |
| B5 加入不产生资金变动 | 对比钱包 | balance/frozen 不变 | P4-4 | NOT_VERIFIED |
| B6 列表/详情契约 | GET auctions | 字段齐全、id 倒序 | P2-1..3 | NOT_VERIFIED |

## C. 出价与资金（PDF p3 / R3.x）

| 用例 | 步骤 | 预期 | 自动化 | 状态 |
|---|---|---|---|---|
| C1 正常递增出价 | round-robin 加价 ×10 | 全 200；价格/领先者/seq 正确 | P5-1/2 | NOT_VERIFIED |
| C2 并发同价（两人+） | 3 人同时出相同价 | 恰 1 成功，其余 2002 | P6-1 | NOT_VERIFIED |
| C3 并发相邻价 | 同时出 p+10 / p+20 | 终价 p+20；失败者 2002 | P6-2 | NOT_VERIFIED |
| C4 requestId 重试（串行） | 同号同金额重发 | idempotentReplay=true、bidId 不变、无新出价/流水 | P7-1 | NOT_VERIFIED |
| C5 requestId 冲突 | 同号不同金额 | 409/2005 | P7-2 | NOT_VERIFIED |
| C6 requestId 并发竞速 | 4 并发同号同额 | 全 200、库中恰 1 条 | P6-3 | NOT_VERIFIED |
| C7 金额过低 | p+inc−1 与 p | 400/2002 | P7-3 | NOT_VERIFIED |
| C8 余额不足（边界） | 冻结至可用 10 后加价 20 | 400/2003 | P10-1 | NOT_VERIFIED |
| C9 余额不足（巨额） | 出价 10×余额 | 400/2003 | P10-2 | NOT_VERIFIED |
| C10 拒绝无副作用 | 拒后对比 | 价格/领先者/seq/冻结不变 | P7-4/P10-3 | NOT_VERIFIED |
| C11 detail 与 bids 一致 | 并发后核对 | currentPrice==最高出价、seq 无重复 | P6-4 | NOT_VERIFIED |

## D. 时间边界与狙击（PDF p3 / R3.8/R3.10）

| 用例 | 步骤 | 预期 | 自动化 | 状态 |
|---|---|---|---|---|
| D1 最后5秒出价延时 | endTime−3.5s 出价 | extended=true、endTime+10s、extendCount+1 | P8-1 | NOT_VERIFIED |
| D2 延时事件同事务 | 查 events | AUCTION_EXTENDED 落库 ×3 | P8-2 | NOT_VERIFIED |
| D3 延时上限 3 次 | 第 4 次狙击 | 仍 200 但不延时 | P8-3 | NOT_VERIFIED |
| D4 迟到出价 | 过期后 250ms | 409/2004（若已被结算→2001，如实记录） | P10-4 | NOT_VERIFIED |
| D5 终态拒单 | FINISHED 后出价 | 409/2001 | P11-3 | NOT_VERIFIED |

## E. 结算与对账（PDF p2 / R3.11-R3.14）

| 用例 | 步骤 | 预期 | 自动化 | 状态 |
|---|---|---|---|---|
| E1 服务端自动结算 | 等到期（无客户端触发） | RUNNING→FINISHED | P11-1 | NOT_VERIFIED |
| E2 结果正确性 | result vs 结算前 | winner/price/reason=EXPIRED 一致 | P11-2 | NOT_VERIFIED |
| E3 冻结回收 | 20 人结算后钱包 | frozen 回到基线 | P12-1 | NOT_VERIFIED |
| E4 余额守恒 | 逐人核对 | balance == 基线 − 成交支付 | P12-1 | NOT_VERIFIED |
| E5 流水可解释 | ledger 恒等式 | ΣFREEZE−ΣUNFREEZE=最终持仓；赢家恰 1 条 PAY | P12-2 | NOT_VERIFIED |
| E6 成交唯一 | result vs bids | finalPrice==最高出价且为赢家本人 | P12-3 | NOT_VERIFIED |

## F. WebSocket 实时性（PDF p3 / R4.5-R4.8）

| 用例 | 步骤 | 预期 | 自动化 | 状态 |
|---|---|---|---|---|
| F1 连接即推 | WS 连接 | CONNECTION_STATE + AUCTION_SNAPSHOT | P9-1 | NOT_VERIFIED（QA-001+005） |
| F2 seq 单调无缺口 | 全程监听 | 信封四要素、连续递增 | P9-2 | NOT_VERIFIED（同上） |
| F3 断线重连 SYNC | 断线→重连→SYNC:n | 缺口补发 + 最新快照 | P9-3 | NOT_VERIFIED（同上） |
| F4 快照权威性 | WS vs HTTP | 价格/领先者/状态/截止一致 | P9-4 | NOT_VERIFIED（同上） |

## G. 运维与交付（PDF p4 / R2.6/R8.1）

| 用例 | 步骤 | 预期 | 自动化 | 状态 |
|---|---|---|---|---|
| G1 健康检查 | GET /api/v1/health | code=0, status=UP | P0-1 | **PASS** |
| G2 Compose 静态 | scripts\check-compose.ps1 | 22 项静态断言全过 | check-compose | **PASS** |
| G3 Compose 拉起 | docker compose up | 双服务 healthy | — | NOT_VERIFIED（QA-006，本机无 Docker） |
| G4 一键模拟 | run-sim-local.ps1 | 报告 40 检查三态输出 | 全部 | **PASS**（工具链）+ 场景见上 |
| G5 演示录屏 | 人工 | 3-5 分钟 | — | MANUAL |

## H. 汇总（2026-10-11 真实运行）

```
自动化 40 项：PASS=1  FAIL=1  NOT_VERIFIED=38
FAIL  → QA-001（登录映射缺陷，P0）
阻塞  → QA-001（认证面）/ QA-005（WS）/ QA-006（Docker 运行时）
```

后端修复 QA-001/QA-005 后：重跑同一命令即可将 B/C/D/E/F 矩阵行转为实测结论，无需改模拟器。
