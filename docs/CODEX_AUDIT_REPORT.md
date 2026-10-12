# Codex 首轮独立审计（修复前基线）

日期：2026-10-12。分支：`audit/codex-final`。起点：`60c0589`。初始工作区干净。

依据：完整阅读并逐页核对 `E:/全栈测试-拍卖间/全栈评测-拍卖间.pdf`（5 页）。本报告在业务修复前生成；后续执行结果见 `CODEX_FINAL_AUDIT.md`。PASS 仅表示本轮证据支持的具体检查，不能由源码存在或前任 PASS 标签推导。

## 环境与证据口径

- 实测 MySQL `8.0.45` 可连接。现有 8090/8091/5173 服务和 `bid_arena` 数据库正在使用，后续测试使用新的专用库及独立端口。
- 代码为 Solon 3.10.7、Java release 17、Vue 3 + TypeScript + Pinia、MySQL/InnoDB、原生 WebSocket、Node 22 模拟器。当前主机 Java 为 21；Java 17 容器运行另行验证。
- Git 历史有真实行为变化；`main` 本地领先 origin/main 8 个提交。本轮不推送、不合并 main。
- 现存 JUnit 报告只有 `Bug1FindDueIdsRegressionIT` 的 2 项成功记录；需求表引用的 AuctionFlowIT/AuthIT/BidTransactionIT/WalletIT 等类并不存在。
- 前任模拟器/浏览器/Agent 报告作为历史证据保存。本轮尚未运行这些测试，不列为独立 PASS。既有前端缺号测试只断言发送 SYNC，却允许客户端立即接受跳号事件，未证明缺口恢复正确。

## 原始需求审计矩阵

| ID / PDF | 需求 | 关键源码 / 测试是否存在 | 修复前独立状态 / 证据 |
|---|---|---|---|
| T1 p1 | Vue 3 + TS 可操作界面 | frontend/src/views；Vitest 与 browser_e2e 存在 | NOT_VERIFIED：本轮浏览器与构建待执行 |
| T2 p1 | Java 17 + Solon 3.x / HTTP + WS | backend/pom.xml、App.java、WsConfig.java | PASS：源码栈确认；Java17运行 NOT_VERIFIED |
| T3 p1 | MySQL8 唯一事实源 | V1__init_schema.sql、各 Repository、@Tran | PASS：真实 MySQL8；事务正确性待专项验证 |
| T4 p1,p4 | Compose 快速启动 / 自动迁移种子 | compose、Dockerfiles、DatabaseInitializer | NOT_VERIFIED：容器实际启动待确认 |
| R1 p2 | DRAFT→RUNNING→SETTLING→FINISHED，取消进入 CANCELLED | AuctionService.cancel / markFinished | FAIL：cancel 调用 markFinished，实际写 FINISHED |
| R2 p2 | 默认 100/10/180s/1000；种子 DRAFT 手动启动 | migration、create、seed | PASS：默认值与不自动启动源码明确；新库启动待测 |
| R3 p2 | 新增冻结差额不超过 available | BidService、WalletRepository | NOT_VERIFIED：单用户加价、跨场共享钱包待实测 |
| R4 p2 | receivedAt < endTime，等号迟到 | BidService.placeBid | NOT_VERIFIED：源码严格 >= 拒绝；边界和结算竞争待测 |
| R5 p2 | requestId 唯一生效 / 冲突可识别 | bids 唯一(user_id,request_id) | FAIL：重放仅核对 amount，未核对 auctionId；跨场错误成功 |
| R6 p2 | 确定领先者 / 同场并发 | auction FOR UPDATE、sim concurrent | NOT_VERIFIED：真实并发待独立执行 |
| R7 p2 | 旧领先者释放 / 差额冻结 / 失败无副作用 | BidService、ledger、holds | NOT_VERIFIED：异常回滚与流水专项待测 |
| R8 p2 | 钱包非负 / available 非负 / 流水一致 | wallets CHECK；hold/ledger | NOT_VERIFIED：CHECK 存在；并发对账未独立验证 |
| R9 p2 | 最后5s +10s，以最新 endTime，最多3次 | BidService | NOT_VERIFIED：源码存在，原模拟器场景存在，待复跑 |
| R10 p2 | 唯一结果 / 重复扫描 / 双实例 | SettlementService / result主键 | NOT_VERIFIED：真实双实例、重复结算待测 |
| R11 p2 | 崩溃后继续结算 / 无人出价不扣款 | 两阶段 claim/finalize、Scanner | NOT_VERIFIED：恢复/崩溃注入待测 |
| R12 p2 | 广播失败不回滚 DB / 快照恢复 | Controller提交后广播、quiet catch | NOT_VERIFIED：发送失败与实际提交待验证 |
| D1 p2,p3 | 用户/钱包/流水/拍卖/参与者/出价/结果/Token | V1 schema | PASS：8类事实及唯一键/CHECK存在；运行不变量另列 |
| H1 p3 | 登录 / me / wallet | Auth/User/Wallet Controller | NOT_VERIFIED：本轮独立HTTP待执行 |
| H2 p3 | 管理员建场/启动/取消/发Token | Admin Controllers | NOT_VERIFIED：身份与路由/绑定待执行 |
| H3 p3 | 列表/详情/join/GET及POST bids | Auction/Bid Controller | NOT_VERIFIED：相同路径不同方法待实测 |
| H4 p3 | 实际可访问 OpenAPI | 仅依赖和 app.yml | FAIL：/swagger、/swagger-ui、/swagger/v2、/v2/api-docs、/swagger/v2/api-docs、/swagger-ui/index.html 均404，未发现Docket |
| E1 p3 | 信封 type/auctionId/seq/serverTime | EventFactory + AuctionService.join | FAIL：join数据把信封type覆盖为 HUMAN/AGENT |
| E2 p3 | seq单调/去重/缺号取权威快照 | AuctionChannel.dispatch | FAIL：跳号先sync后推进lastSeq，缺失事件随后被去重丢掉 |
| E3 p3 | 拒绝仅本人 / WS鉴权与房间范围 | BidController、WsConfig | NOT_VERIFIED：实际双连接/无效认证待测；只在连接时认证 |
| A1 p1,p3 | 竞拍Agent受限token + 独立身份 | Agent API；seed无AGENT用户 | FAIL：缺独立Agent可运行示例与操作规范 |
| A2 p3 | 明文一次 / DB安全摘要 | AgentTokenService sha256 | NOT_VERIFIED：源码符合；本轮DB/日志/历史扫描待执行 |
| A3 p3 | 范围/read/bid/有效期/吊销/频率 | AgentAuthInterceptor、repo | NOT_VERIFIED：独立HTTP及并发限流待测 |
| A4 p3 | 不可管理/他人钱包/直改DB；正常BidService | 独立路由认证，AgentController | NOT_VERIFIED：代码复用存在；真实最小权限演示待补 |
| S1 p3,p4 | 20人全部指定场景与结果对账 | simulator/src/phases | NOT_VERIFIED：历史报告41PASS×2；本轮待独立复跑 |
| S2 p4 | 真实MySQL关键并发/结算集成 | JUnit仅2项；HTTP脚本存在 | FAIL：跨场锁序、失败注入、两实例等缺关键回归 |
| S3 p4 | 至少一个Vue Store/组件测试 | frontend/src/**/__tests__ | NOT_VERIFIED：测试存在，待本轮执行 |
| Q1 p4 | .env/Compose/migration/seed/一键测试 | 根目录文件、脚本 | FAIL：无统一一键测试入口；脚本固定路径/端口/测试库有污染风险 |
| Q2 p4 | 完整README演示路径 | README仍称simulator工作区 | FAIL：缺独立Agent流程；测试拍卖混入演示列表 |
| DOC p4 | DESIGN/DECISIONS/AI_USAGE/DEBUG_LOG/AGENT_TOOL_SPEC | 根目录均不存在 | FAIL：五份强制文档缺失；本人决定不得代填 |
| G1 p4,p5 | 有意义提交历史 / 仓库 | git log/branch | PASS：本地真实迭代历史；未推送内容与录屏待本人提交 |
| G2 p4,p5 | 3–5分钟录屏 / 本人答辩 | 无录屏证据 | NOT_VERIFIED：本轮只提供步骤，需本人录制与确认 |

## 缺陷及建议顺序

### P0

1. **C0-01 跨拍卖钱包锁序反转**：BidService先锁bidder再锁oldLeader，而不是userId升序。A在场1领先、B在场2领先，交叉出价可形成钱包环形等待。没有事务级死锁重试。先补真实MySQL并发回归，再统一钱包/持仓锁序并增加有限全事务重试。
2. **C0-02 requestId跨场重放与副作用风险**：既有检查未核对auctionId；INSERT唯一键异常被捕获后直接返回“无副作用”，但此前已经写钱包、持仓、价格和事件。需绑定(userId,requestId)到auctionId+amount，并保证冲突路径完整回滚。

### P1

3. **C1-01 取消终态错误**：应进入CANCELLED，且FINISHED事件应携带finalPrice=0；取消需验证冻结全部释放及唯一结果。
4. **C1-02 join覆盖事件类型**：payload `type=HUMAN/AGENT`覆盖PARTICIPANT_JOINED，前端不识别。改为participantType并加回归。
5. **C1-03 缺号恢复错误**：客户端推进seq后丢弃补发的历史；应等待权威快照或完整恢复，拒绝跨auction/旧快照。
6. **C1-04 OpenAPI未交付**：依赖存在不代表文档存在；补可访问机器可读规范和测试，使用既有Solon能力。
7. **C1-05 Agent完整演示缺失**：补环境变量Token、预算策略、唯一requestId、429/401/冲突处理的最小脚本；独立AGENT身份需可安全初始化。
8. **C1-06 Compose隔离与WS代理**：固定container_name破坏多项目隔离；Nginx缺WS Upgrade代理；前端硬编码8091不随端口映射。Docker runtime未验证时保留NOT_VERIFIED。
9. **C1-07 测试证据与交付文档不完整**：缺真实回归及五份文档；现有测试含过弱断言与不存在的测试类引用。保留历史报告，新增独立证据，不篡改PASS。

### P2

10. **C2-01 列表undefined/缺赢家**：AuctionService.toSummary只提供base+计数，无currentLeaderName/result；AuctionCard直接字符串插值。补完整摘要及fallback测试。
11. **C2-02 测试污染/标题编码**：现有演示库确有E2E等短场与问号标题。保留用户数据，后续回归隔离测试库，提供可明确选择演示数据的安全筛选；PowerShell JSON发送按UTF-8 bytes。

## 验证与范围边界

计划顺序：先P0真实复现与资金回归→P1状态机/事件/API/Agent→部署静态和可用运行时→P2最小展示→文档及本地提交。大规模架构变化（跨实例主动WS分发等）仅记录边界；两个实例的数据库唯一结算需实际测试。Docker、录屏、本人设计解释若缺证据仍为NOT_VERIFIED。本报告不意味着正式交付就绪。
