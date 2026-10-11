# PARALLEL_HANDOFF — 并行开发交接文档（检查点快照）

> 生成时间：2026-10-11 19:15（本地）
> 本文档由主开发 Agent（OpenCode + GLM 5.3）在切换并行开发模式前的进度审计中生成。
> 审计前状态：后端核心代码已完成并编译通过、Flyway 迁移与种子已在本机 MySQL 验证、发现 1 个真实运行时缺陷（见「当前阻塞」）。

## 1. Git 检查点

| 项 | 值 |
|---|---|
| 分支 | `main` |
| 远端 | `https://github.com/kehaol140-afk/bid-arena-fullstack.git` |
| 基线提交 | `ec2e2ac Initial commit`（仓库初始，仅空 README） |
| 本检查点提交 | 见 `git log -1`（本文档随 `feat: backend core (auth/auction/bid/settlement/agent/ws) + migration + seed` 提交，提交后本文档将更新 hash）|
| 推送状态 | 提交后立即 push（若认证失败保留本地，如实报告） |

**提交后请以 `git log -1 --format=%H` 的输出为准更新本节。**

## 2. 环境事实（本机实测）

| 组件 | 状态 | 说明 |
|---|---|---|
| Java | 21.0.2（编译目标 17） | `maven.compiler.release=17`，满足任务书 Java 17 要求 |
| Maven | 3.9.9 | 安装于 `C:\Users\lenovo\tools\apache-maven-3.9.9`（PATH 无 mvn，用完整路径调用） |
| Node/npm | 22.18.0 / 10.9.3 | 可用 |
| MySQL | 8.0.45（本机服务 MySQL80） | root 密码 `123456`（本机开发库，非仓库内容）；库 `bid_arena` |
| Docker | **未安装** | docker-compose.yml 尚未编写；评审环境需验证，本机 NOT_VERIFIED |
| 端口 | 8080 被其他应用占用 | 后端已改用 HTTP 8090 / WS 8091 |

## 3. 已完成模块（真实实现，非占位）

### 后端（backend/，Solon 3.10.7，编译通过）

| 模块 | 文件 | 状态 | 验证程度 |
|---|---|---|---|
| 应用入口/初始化 | App.java, config/DbConfig.java, config/DatabaseInitializer.java | ✅ 完成 | 启动成功、Flyway V1 迁移 success、23 用户+23 钱包+1 DRAFT 演示拍品种子实测落库 |
| 认证 | auth/*（BCrypt、session 表、Bearer 拦截、Admin 拦截） | ✅ 代码完成 | 编译通过；登录接口**未做 HTTP 冒烟**（审计时服务已停） |
| 用户/钱包 | user/*, wallet/* | ✅ 代码完成 | 编译通过；接口未冒烟 |
| 拍卖状态机 | auction/*（DRAFT→RUNNING→SETTLING→FINISHED / CANCELLED，start/cancel/join） | ✅ 代码完成 | 编译通过；逻辑未集成测试 |
| 出价事务引擎 | bid/BidService.java（16 步单事务、FOR UPDATE、requestId 幂等、差额冻结、5s 延时同事务） | ✅ 代码完成 | 编译通过；**并发/资金断言未测试**（这是最高风险未验证区） |
| 结算 | settlement/*（两阶段 tryClaim/finalize、唯一结果约束、定时扫描器） | ✅ 代码完成 | 编译通过；扫描器存在 NPE 缺陷（见阻塞#1） |
| Agent Token | agent/*（签发/吊销/范围/scope/过期/频率，sha256 摘要存储） | ✅ 代码完成 | 编译通过；未测试 |
| WebSocket | websocket/*（/ws/auction，快照/事件广播/SYNC 补发） | ✅ 代码完成 | 编译通过；**未做连接冒烟**，WsConfig 中 `Solon.context().getBean` 的启动时序**未验证** |
| 统一异常/错误码 | common/* | ✅ 完成 | 编译通过 |
| OpenAPI | solon-docs-openapi2 依赖 + app.yml 配置 | 🔶 依赖就绪 | **/swagger 路径未验证是否可用**；Controller 未加 @Api 注解 |

### 数据库（已验证）

- V1__init_schema.sql：11 张业务表 + flyway_schema_history，全部 InnoDB、utf8mb4。
- 迁移历史：仅 rank=1 (V1, success=1)，**无半完成迁移**。
- 种子实测：users=23（admin×1 + bidder_a/b×2 + bot_01..20×20）、wallets=23（各 1000 积分）、auctions=1（DRAFT 演示拍品，未自动倒计时 ✅）。
- 种子幂等：实现按 email 唯一键跳过；**二次重启的幂等行为尚未实测**（审计中断前未完成该验证）。

## 4. 未完成模块（尚未开始）

| 模块 | 说明 |
|---|---|
| frontend/（Vue 3 + TS + Vite + Pinia + Router + Axios + Vitest） | **完全未开始**（目录不存在） |
| simulator/（20 人模拟脚本 npm run simulate:auction） | 完全未开始 |
| backend/src/test/（JUnit + 真实 MySQL 集成测试） | 完全未开始（任务书要求的 11 类用例见 docs/REQUIREMENTS.md R6） |
| docker-compose.yml / Dockerfile / .env.example | 完全未开始（本机无 Docker，需评审环境验证） |
| 根目录文档 README/DESIGN/DECISIONS/AI_USAGE/DEBUG_LOG/AGENT_TOOL_SPEC/CODEX_HANDOFF/TEST_REPORT | 未开始（README 仅有 Initial commit 的空标题） |
| WebSocket 端到端冒烟（连接→快照→出价→事件→断线重连） | 未执行 |

## 5. 已知缺陷与阻塞（真实，未修复）

1. **[BUG-1 高优先级] SettlementScanner 每秒 NPE**
   - 现象：日志 `settlement scan error` / `NullPointerException: Cannot invoke "java.util.List.size()" because "ids" is null`
   - 根因：Solon SqlUtils `queryValueList()` 在**零行结果时返回 null 而非空 List**；`AuctionRepository.findDueIds()`（约 line 43 附近，`List<Number> ids = ...queryValueList()` 之后未判空）直接使用。
   - 影响：定时结算扫描每轮在「无到期拍卖」时抛 NPE（被 catch，服务不死），**有到期拍卖时同样在 findDueIds 空结果场景失败**；结算主链路未被验证。
   - 建议修复：`if (ids == null) return List.of();`（一行防御），随后补结算集成测试。适合第一个接手的 Agent。
2. **[风险] SqlUtils 数值类型裸强转**：`queryValue()` 返回 `rs.getObject(1)` 裸强转，MySQL BIGINT/COUNT 实际给 `BigInteger`，凡 `Long x = queryValue()` 都会 CCE。已在全部现有调用点改用 `Number` 中转（本轮已修复 8 处）。**新增代码必须遵守此约定**（可写入 AGENTS.md）。
3. **[未验证] WsConfig 中通过 `Solon.context().getBean(...)` 获取依赖**：listener 在 WebSocketRouter 注册时构造，字段通过静态上下文拉取，启动时序未验证，可能存在启动早期 NPE 风险。
4. **[未验证] OpenAPI /swagger 页面**：依赖已引入，未确认 UI 可访问。
5. **[未冒烟] 登录→建拍卖→启动→出价→结算 全链路**：代码完成但没有一次端到端 HTTP 验证。

## 6. API 契约摘要（详见 docs/API_CONTRACT.md）

已实现 17 个端点（用户会话 Bearer 10 个 + 管理员 5 个 + Agent 6 个 + health），统一 `ApiResult{code,message,data}` 包装；WebSocket 信封 `{type,auctionId,seq,serverTime,...}`。完整请求/响应字段见 API_CONTRACT.md（按当前真实代码编写，未实现的标了 PLAN）。

## 7. 数据模型（V1，全部已建）

```
users(id,email uk,password_hash,display_name,role[ADMIN|USER|AGENT],status,created_at,updated_at)
sessions(id,token_hash uk,user_id fk,expires_at,created_at)          -- 明文 token 不落库
wallets(id,user_id uk,balance,frozen,version,updated_at)              -- CHECK(非负, frozen<=balance)
wallet_holds(id,user_id+auction_id uk,amount,updated_at)              -- 单场冻结持仓
wallet_ledger(id,user_id,auction_id,request_id,type[FREEZE|UNFREEZE|PAY|REFUND|GRANT],amount,balance_after,frozen_after,remark,created_at)
auctions(id,title,status[DRAFT|RUNNING|SETTLING|FINISHED|CANCELLED],start_price,min_increment,current_price,current_leader_id,duration_seconds,started_at,end_time,extend_count,max_extends,seq,settle_reason,created_by,...)  -- idx(status,end_time)
auction_participants(id,auction_id+user_id uk,participant_type[HUMAN|AGENT],joined_at)
bids(id,auction_id,user_id,amount,request_id,seq,created_at)          -- UNIQUE(user_id,request_id) 幂等键
auction_results(auction_id PK,winner_id,final_price,reason[EXPIRED|CANCELLED],settled_at)  -- PK 即唯一结算约束
agent_tokens(id,token_hash uk,token_prefix,user_id,auction_id,scopes,expires_at,revoked,rate_limit_per_min,request_count,window_started_at,...)
auction_events(id,auction_id+seq uk,type,payload JSON,created_at)     -- 事件溯源/重放
```
约定：**所有时间为 epoch 毫秒 BIGINT**（避免时区歧义），**所有金额为整数积分 BIGINT**。

## 8. 测试现状（真实结果）

| 项 | 结果 |
|---|---|
| `mvn clean compile` | **PASS**（EXIT=0，2026-10-11 审计时） |
| 后端启动 + Flyway + 种子 | **PASS**（users=23, wallets=23, DRAFT 拍品=1；health 接口曾返回 `{"code":0,...,"status":"UP"}`） |
| JUnit 集成测试 | **NOT_RUN**（测试目录为空） |
| 前端测试 | **NOT_RUN**（前端不存在） |
| 模拟脚本 | **NOT_RUN**（不存在） |
| 定时结算扫描 | **FAIL**（BUG-1 NPE，见上） |

## 9. 并行分工建议

### 适合独立 Agent 开发（低冲突）
- **Agent-FE**：`frontend/` 全新目录（Vue3+TS+Vite+Pinia+Router+Axios+原生 WS+Vitest）。契约完全依赖 API_CONTRACT.md；可先用 mock，联调在后端可用时进行。同时产出根 README 的前端启动节。
- **Agent-TEST**：`backend/src/test/`（JUnit5 + solon-test + 本机 MySQL）。只读生产代码 + 新增测试；发现业务 bug 报告而不是改业务代码。优先用例顺序：结算（顺带验证 BUG-1 修复）→ 出价并发/资金 → 延时 → Agent Token → WS seq。
- **Agent-SIM**：`simulator/`（Node TS）。依赖 API_CONTRACT.md + bot_01..20 种子账号（Test123456!）。
- **Agent-DEVOPS**：`Dockerfile`、`docker-compose.yml`、`.env.example`、健康检查。注意本机无 Docker，只能静态产出，验证需评审环境。

### 主 Agent 独占（高风险并发区，禁止并行修改）
- `backend/src/main/java/com/bidarena/bid/BidService.java`（出价事务）
- `backend/src/main/java/com/bidarena/settlement/*`（结算，含 BUG-1 修复）
- `backend/src/main/java/com/bidarena/wallet/WalletRepository.java`（资金 SQL）
- `backend/src/main/resources/db/migration/*`（schema 变更需串行审批）
- `backend/src/main/java/com/bidarena/auction/AuctionService.java`

### 约定（所有 Agent 必须遵守）
1. SqlUtils 数值读取一律 `Number` 中转（见阻塞#2）。
2. `@Tran` 方法禁止同类自调用；广播只能发生在事务方法**返回之后**。
3. 锁顺序恒定：auction 行 → wallet 行（userId 升序）。
4. 时间一律 epoch millis long；金额一律整数积分 long。
5. 不提交 `backend/target/`、`backend/logs/`、`.env`、数据库文件（.gitignore 已配置）。
6. 提交信息反映真实行为变化；禁止 force push / reset --hard。

## 10. 下一步（按优先级）

1. 修复 BUG-1（findDueIds 判空）→ 重启 → 观察扫描器无错。
2. 端到端冒烟：admin 登录→创建（duration=5s）→启动→bidder_a join→出价→到期→自动结算→查 result/wallet/ledger。
3. 并行启动 Agent-FE / Agent-TEST / Agent-SIM / Agent-DEVOPS。
4. 主 Agent 补 OpenAPI 验证、WS 冒烟、DESIGN/DECISIONS 等文档。
