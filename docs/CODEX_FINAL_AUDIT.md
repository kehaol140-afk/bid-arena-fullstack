# Codex 最终独立审计与交付加固

日期：2026-10-12。项目 E:/全栈测试-拍卖间/bid-arena-fullstack。依据完整阅读并逐页核对的《全栈评测-拍卖间》PDF（5页）。起点60c0589、工作区干净；先完成只读审计并提交243c56e，再补回归及必要修复。分支audit/codex-final；不push、不合并main。

## 1. 结论及原始需求

已确认的资金锁序、跨场requestId、取消状态、事件信封、缺号恢复、OpenAPI、Agent示例及展示问题已最小修复。MySQL关键并发、失败回滚、双JVM唯一结算、受限Token Agent真实竞拍已有独立运行证据。保留现有架构和Vue风格，无收费LLM/新基础设施/真实支付。

**不建议现在直接宣布“全部交付条件已满足”**：Docker真实部署/Java17容器、本人设计确认与3–5分钟录屏仍NOT_VERIFIED；多实例WS即时跨进程推送不支持。可交用户检查的本地审计版本，补齐上述条件再正式提交。未发现本轮测试后仍复现的已确认P0，但有限测试不等于所有故障均被穷举证明。

PASS＝实际运行或明确标注的源码检查通过；FAIL＝实际缺陷/失败；NOT_VERIFIED＝缺有效证据。源码存在、测试文件存在、前任报告PASS都不是运行PASS。下面的PASS限定本轮已测试场景。

| 原PDF需求 | 关键实现与独立证据 | 状态 |
|---|---|---|
| Vue3/TS可操作界面、至少一个组件/Store测试 | frontend/src；24项Vitest、真实Edge E2E、构建 | PASS |
| Java17目标/Solon3.x、HTTP/WS | pom release17；Java21实跑；WS真实连接 | PASS（目标及实跑）；Java17运行NOT_VERIFIED |
| MySQL8唯一事实源、自动迁移种子 | MySQL8.0.45真实InnoDB；V1/V2、DatabaseInitializer，新库启动 | PASS |
| 默认100/10/180s、钱包1000、DRAFT手动启动 | JUnit defaultAuctionIsDraft180Seconds；HTTP新库及SQL检查 | PASS |
| 创建/启动/取消与完整状态机 | AdminAuctionController、Auction/SettlementService；取消、恢复及结算回归 | PASS |
| 出价、资金差额、旧领先者释放、失败无副作用 | BidTransaction、WalletRepository；真实并发与SQL故障注入 | PASS |
| 严格截止、最后5秒+10秒/最多3次 | 等号边界JUnit；两组模拟狙击/第4次不延时 | PASS |
| requestId唯一、冲突、响应丢失 | 用户钱包串行化+唯一键；跨场/不同金额/并发/截断HTTP响应 | PASS |
| 唯一结果、无人出价、重复任务/两个实例 | 结果主键/拍卖锁；JUnit8并发、真实双JVM Scanner | PASS |
| 已提交SETTLING重启恢复、事务异常回滚 | SQL触发器回滚及Scanner新进程恢复 | PASS；断电/fsync中途NOT_VERIFIED |
| 所有指定HTTP业务、方法区分、角色鉴权 | final-audit实际HTTP、同路径GET/POST、两模拟/浏览器 | PASS（已测试契约）；非法输入穷举NOT_VERIFIED |
| 可实际访问OpenAPI | /openapi.json动态生成Swagger2；14个规定操作、body、安全定义 | PASS；Swagger网页UI未提供/非本轮证明对象 |
| WS信封/seq/服务器时间/私有拒绝/恢复 | HTTP/WS双连接、模拟SYNC；Vitest房间/缺口/去重/旧快照 | PASS（单实例）；即时跨实例广播NOT_VERIFIED |
| 受限Agent Token与独立自主竞拍示例 | Agent API+独立AGENT种子+auction-agent.mjs；真正竞拍成交PAY | PASS |
| Token一次明文、摘要、权限/范围/有效期/吊销/限流 | HTTP+SQL；15并发请求配额5得到5成功/10个429 | PASS |
| Agent无管理员/他人钱包/DB改结果权限 | Agent Token普通路由拒绝；自身wallet无userId；脚本无SQL/管理员工具 | PASS |
| 20人全部场景、确定seed、余额/流水/结果对账 | 两次全新库seed42/7，各42项，原断言保留 | PASS |
| .env/Compose/SQL/一键入口 | 配置检查、scripts/test-all.ps1；真实本地一键执行 | PASS（本地）；Compose运行NOT_VERIFIED |
| README/五份指定文档、真实错误、Git历史 | 根文档及DEBUG_LOG、初始/最终审计；真实增量本地提交 | PASS（文件内容）；本人主导设计/比例待确认 |
| 本人录屏与答辩 | docs/DEMO_RECORDING提供步骤，不自动录制 | NOT_VERIFIED |

## 2. 已确认缺陷与严重等级

| ID | 等级 / 缺陷 | 复现或源码证据 / 修复 |
|---|---|---|
| C0-01 | P0 跨场钱包逆序锁、死锁无完整重试 | 实际1213及确定钱包锁序测试失败；升序锁+事务外最多3尝试 |
| C0-02 | P0 requestId跨场错误200、INSERT冲突吞掉副作用风险 | 跨场同amount回归失败；INSERT catch路径前已有资金写为源码确认风险（未捏造历史资金损失）。绑定场/金额、删除吞异常、全回滚+并发回归 |
| C1-01 | P1 cancel实际写FINISHED | 实测取消状态失败；markCancelled与唯一取消结果、冻结释放 |
| C1-02 | P1 join.type覆盖PARTICIPANT_JOINED | 实测HUMAN；改participantType，事件信封完整 |
| C1-03 | P1 缺号先推进seq、错误房间/旧快照 | 3项新前端失败；暂停增量、权威快照、房间和seq保护 |
| C1-04 | P1 无实际OpenAPI | 原路径404、首次生成paths空；用现有Solon文档依赖/注解动态生成 |
| C1-05 | P1 缺真正Agent运行方式 | 只有API/模拟器；增加独立受限Token预算策略，不访问DB |
| C1-06 | P1 Agent scope空格、限流计数原子性、停用用户凭证 | scope与session回归失败；规范化、ACTIVE门禁、计数事务；并发配额实测 |
| C1-07 | P1 amount缺失/非法格式500 | 实际NPE/StatusException；明确整数与范围、400/1005，无写入 |
| C1-08 | P1 Compose项目冲突、无WS升级代理、硬编码端口 | 源码确认；去固定容器名、Nginx WS/API/OpenAPI、同源WS、健康检查 |
| C1-09 | P1 测试证据/五份文件缺失 | 文件/类实际不存在、弱断言；补真实回归、统一新库入口及诚实文档 |
| C1-10 | P1 stop-local可能误停复用服务 | wrapper=0仍Stop listener的源码确认；listener也须归属，模拟进程命令回归不触碰用户进程 |
| C2-01 | P2 领跑者undefined、列表成交信息缺失 | 回归实际失败；完整服务摘要及Vue fallback |
| C2-02 | P2 测试污染/中文标题问号 | 原数据及脚本编码确认；UTF-8请求、每次新库、显式可关闭演示筛选，不删除旧数据 |

业务缺陷与测试工具错误分开记录。审计自身异常类型、javapath进程、checked catch编译、8460 Bound端口、浏览器导航等待和B缺join夹具问题见DEBUG_LOG及audit-evidence/REGRESSION_BASELINE，均保留失败证据，不能算生产缺陷来夸大修复。

## 3. 修改文件及原因

- backend/bid/BidService、新增BidTransaction：仅分离事务外重试协调与原事务引擎；统一锁序、requestId、溢出/回滚。WalletRepository、V2索引配合；SettlementService仅修正锁说明，未重写结算架构。
- AuctionRepository/Service：正确CANCELLED、participantType、完整摘要、只读一致快照。DatabaseInitializer：命名锁串行种子、独立Agent、保留DRAFT、补未建钱包但不重置余额。
- SessionRepository/AgentTokenRepository/Service：ACTIVE边界、scope规范化、原子配额。AgentController增加仅本人钱包；各Controller补JSON Body与既有Swagger注解。BidRequest/GlobalExceptionInterceptor控制非法金额及绑定错误；OpenApiController实际规范出口。
- WsConfig：房间存在性、有效会话、摘要凭证、消息再认证、服务一致快照。广播与数据库事务的先后约定仍保留。
- frontend AuctionCard/List/Room、demoAuctions、auctionChannel/wsUrl/vite：最小展示、取消、演示筛选、权威恢复及同源代理；新增/强化前端回归，没有重做视觉系统。
- compose/Dockerfile/Nginx/.dockerignore：隔离名、健康检查、代理/WS与构建上下文；容器运行不冒充通过。
- scripts：独立Agent、HTTP/真实MySQL审计、隔离模拟/浏览器、一键入口、工具回归/脱敏证据导出；既有PowerShell请求用UTF-8；start/stop修端口代理与归属。浏览器join、反馈、WS与流水断言增强，导航等待同时验证真实路由。
- README、DESIGN、DECISIONS、AI_USAGE、DEBUG_LOG、AGENT_TOOL_SPEC、DEMO_RECORDING、审计与证据文件；REQUIREMENTS加历史误引用说明，不改历史PASS记录伪造。

## 4. 实际新增回归与执行证据

完整入口：`powershell -ExecutionPolicy Bypass -File scripts/test-all.ps1`（本机传-JavaHome 'D:\New Folder\jdk12'及-MavenHome 'C:\Users\lenovo\tools\apache-maven-3.9.9'）。Node22.18、真实MySQL8.0.45、Java21.0.2/Maven3.9.9。所有测试库每次新建bid_arena_codex_*，保留供复核；不删用户库、不改现有服务。

最后完整入口已实际退出0，日志`logs/codex-test-all-complete.log`明确记录`[PASS] independent audit suite finished`，JUnit库`bid_arena_codex_junit_20261012211242`。汇总由scripts/export-audit-evidence.ps1从实际JUnit XML/TAP/Vitest日志导出，不读取含凭证的XML properties；见audit-evidence/suite-summary.json。补充诊断的--dto-only结果单独命名，不取代13组完整HTTP证据。

| 实际执行 | 最新状态 / 数量 | 可核查证据 |
|---|---|---|
| 后端真实MySQL JUnit | PASS 22/22（新增FinalAuditRegressionIT20+原有2） | audit-evidence/junit-summary.json、backend/target/surefire-reports |
| 前端Vitest | PASS 24/24；build PASS | logs/codex-test-all-complete.log、frontend测试源码 |
| HTTP/MySQL/Agent/WS/双实例恢复 | PASS 13/13检查组（不是13个单断言） | audit-evidence/http-mysql-audit.json及时间戳报告 |
| Agent策略及stop归属单元回归 | PASS 4/4（HTTP/进程故障采用受控替身） | scripts/audit-tools.test.mjs、完整入口日志 |
| 20人seed42 | PASS 42/42、FAIL0、NOT_VERIFIED0 | audit-evidence/sim-seed42.json、demo-seed42-runtime.json |
| 20人seed7 | PASS 42/42、FAIL0、NOT_VERIFIED0 | audit-evidence/sim-seed7.json、demo-seed7-runtime.json |
| Edge实际浏览器及外围SQL | PASS 9/9；参与者2、唯一150成交结果 | browser-results.json、demo-browser-runtime.json、browser-screenshots |
| Compose配置静态检查 | PASS 34/34；SnakeYAML语法/服务名PASS | scripts/check-compose.ps1、logs/codex-compose-static.log；非容器证据 |
| Docker config/up/登录/WS/结算/重启持久化 | NOT_VERIFIED | Docker CLI及Desktop不可用，不启动、不安装、不清卷 |
| Java17容器实际运行 | NOT_VERIFIED | 本轮只有Java21运行、release17编译；容器镜像指定17不等于运行证据 |
| 前任Agent18/冒烟18/边界12等旧入口原标签 | NOT_VERIFIED（未按原入口全部复跑） | 不复用前任PASS；本轮独立检查覆盖实际关键路径 |

新增20个MySQL回归的方法与逐项PASS在junit-summary：跨场ID、金额冲突/重放、取消、join、摘要、默认DRAFT、截止/延长、差额/释放/拒绝、出价SQL故障、同价并发/8个重试、确定钱包顺序、跨场request竞态、8个结算/无人出价/恢复、结算SQL故障、跨场可用资金、1213最多3次、出价到期竞争、scope规范化、停用会话、提交后广播故障。真实资金/状态/流水断言未降低。旧Scanner入口2项不是唯一并发证据。

## 5. P0资金/并发/结算逐项

| 用户专项项 | 实际证据与限定 | 状态 |
|---|---|---|
| 1 事务边界 | 代理事务+SQL失败触发器后所有写回滚 | PASS |
| 2 FOR UPDATE/锁序 | auction→升序wallet；独立连接锁低ID、探测高ID不提前占用 | PASS |
| 3 同场并发 | 同价恰一成功、相邻价最高及seq；两模拟 | PASS |
| 4 跨场共享钱包 | 同用户两场各6000，只一场可冻结，非负/holds一致 | PASS |
| 5 同request并发重试 | 8个线程/模拟4个请求、一个bid/资金生效 | PASS |
| 6 同ID不同金额/场 | 409/2005、完整无副作用 | PASS |
| 7 同用户连续加价 | 只增差额，钱包/ledger检查 | PASS |
| 8 旧领先者释放 | 真人及模拟出价，UNFREEZE/hold检查 | PASS |
| 9 失败无副作用 | 低价/余额不足/冲突/非法金额前后状态数组一致 | PASS |
| 10 异常整体回滚 | bids/result的SIGNAL45000，钱包/持仓/ledger/seq回滚 | PASS |
| 11 严格截止 | receivedAt==deadline拒绝；<deadline与结算竞争结果一致 | PASS |
| 12 5秒延长/3次 | 精确+10000ms，第四次接受但不延长 | PASS |
| 13 出价/结算竞争 | barrier真实线程，唯一result/PAY/最高有效出价 | PASS |
| 14 重复定时/结算任务 | 8并发finalize及反复scanner，一个PAY/result | PASS |
| 15 两应用实例 | 两个独立JVM共享独立MySQL库扫描同到期场 | PASS |
| 16 数据库死锁与重试 | 原1213复现；升序回归；触发器1213最多3次整笔回滚 | PASS（未长时随机高压穷举） |
| 17 结算崩溃恢复 | 停止自己JVM后提交SETTLING夹具，再新JVM恢复 | PASS（阶段恢复）；事务提交/fsync瞬间断电NOT_VERIFIED |
| 18 提交成功但响应丢失 | 本地代理确认上游提交后断开客户端，原ID重试1个bid/冻结 | PASS |
| 19 无人出价 | null赢家/0价格/0PAY，唯一结果 | PASS |
| 20 取消冻结释放 | CANCELLED、0冻结、唯一取消结果、无PAY | PASS |
| 广播失败不回滚 | 真MySQL先提交，替换广播器抛网络故障，捕获后DB全部状态不变 | PASS（网络故障为受控注入） |

各轮查balance>=0、frozen>=0、balance-frozen>=0；wallet.frozen等于各hold合计；HTTP新库balance与初始1000+PAY/REFUND/GRANT相符；模拟FREEZE/UNFREEZE/PAY对账。result主键及并发检查证明测试场一场一结果；没有仅靠Mock或单线程宣布并发安全。

## 6. 竞拍Agent完整验证

管理员为种子独立AGENT用户签发read+bid Token；摘要SQL与列表无明文验证；管理员/普通钱包路由拒绝；跨auction拒绝、read-only不能join/bid、bid-only不能read；过期/吊销401；15并发配额5严格5成功/10限流。实际auction-agent.mjs用环境AUCTION_AGENT_TOKEN、预算150，经公开API以130出价、AGENT参与记录，最终赢家为该用户且PAY一次。脚本没有SQL/管理员凭证；测试框架的管理员与故障SQL夹具不属于竞拍Agent能力。

策略回归额外检查401停止、429等待、竞争刷新、新决策新UUID、响应断开重用原body/requestId、预算耗尽无POST。真正Token只在内存/临时环境；Git历史及本轮日志/JSON扫描未见完整bat_64hex凭证。前缀用于管理员识别，不可用来认证。公开演示密码必须在生产替换。

## 7. Docker Compose

本机没有Docker CLI/Desktop；未执行实际docker compose config/up/build/容器登录/WS/自动结算/重启持久化。静态34项和SnakeYAML不等于Compose引擎验证或镜像构建成功。已修固定container_name、Nginx WS升级/同源、健康门禁，具名卷自动随-p项目隔离，保留MySQL数据。

安装Docker Desktop+WSL2/Linux containers后，本人按README使用-p bid-arena-codex-check、新卷和13306/18090/18091/15173，先--profile full config，再up --build -d，ps/logs、真人/Agent竞价、WS、结算、restart后结果/钱包/ledger、SETTLING恢复。不能down -v或清现有卷。未执行前仍NOT_VERIFIED，不能宣称评审5分钟启动已确认。

## 8. Vue/WebSocket与演示体验

保留原界面；领先者姓名/用户编号fallback、成交赢家完整、CANCELLED展示；原乱码行未重写，新UTF-8标题实际HTTP回读。默认显式演示筛选并可关掉看全部，测试库彻底隔离，不删用户数据。种子保留未启动DRAFT；[DEMO]新场默认180秒。

实际Edge：A UI登录/join/出110；B正常API join/出150；A页面收到被超通知；钱包两条真实freeze/unfreeze；真实自动结算得主B及150；外围SQL两个participants及一result。B操作是HTTP驱动，不冒称两个浏览器全手动；本人双真人录屏仍需完成。

WS真实认证/房间范围、信封/seq/时间、拒绝只本人、在线提交可见、断线SYNC末尾快照；前端增量去重/缺号等待/旧快照/跨场测试。单进程事件广播；两个实例共享DB但不主动互推。健康WS时房间HTTP约21秒兜底、断线3秒；多实例实时性不能记PASS。会话重认证在消息/PING发生，前端25秒心跳，非瞬时踢出；TLS、代理日志和终端凭证安全由部署配置补齐。

## 9. HTTP/OpenAPI一致性

直接真实请求验证规定路径及GET/POST同名路由，明确@Body JSON，业务错误按HTTP+code检查，管理员/Agent认证分开。非法amount含缺失、分数、非数字、溢出400/1005；失败后SQL无写入。HTTP看似成功的关键出价、取消、结算都有独立MySQL核对。

/openapi.json实际可访问，基于Solon真实Action而非手写假的路径表；SessionBearer/AgentBearer区别明确，required操作和请求body经检查，Nginx/Vite代理配置已补。定义文件保存在openapi-verified.json。没有额外Swagger UI承诺；每一种非法DTO、超长字符串、超大整数其他字段、负载/压测不是穷举验证。

## 10. 文档与Git交付

五份强制根文档已补并核对实际源码/命令；README不是旧simulator分支介绍。AI_USAGE真实标用户说明的OpenCode/GLM背景和本轮Codex工作；至少3本人决定、2本人未采用方案、比例、不能独立解释的代码全部待本人确认，未编造本人判断。DEBUG_LOG保留真实错误及审计工具错误区别。

初始及最终审计、脱敏JSON、测试源码、录屏计划为本地交付；原始日志/构建留本机但不入Git；旧报告保留，REQUIREMENTS误引用加显式说明。Git历史保持，不reset、不删除.git、不伪造历史；仅真实修复/测试/交付文档增量提交。main及其他worktree分支未改变，没有push或自动PR/merge。最终HEAD与git status以本轮结束命令输出为准。

## 11. 剩余风险与未验证项

1. P1交付门槛：Docker/Java17真实运行、全新卷/重启持久化/快速启动待执行；不能用本地Java21通过代替。
2. P1交付门槛：本人AI使用/设计选择确认、代码理解、3–5分钟录屏待补。文档存在不等于本人已确认。
3. 架构边界：多实例即时WS分发不支持（DB资金唯一结算已测）；推荐单实例/黏性路由，扩展需另行设计，不擅自重构。
4. 可靠性边界：未做断电/fsync中途/网络分区/MySQL主从故障/长时高压或所有交错枚举；有限整笔重试耗尽2008需客户端同ID重试，Scanner失败下一轮恢复。
5. 安全边界：本地评审明文HTTP和公开测试密码不是生产安全部署；WS query token需TLS与日志脱敏，现有连接停用有心跳检查窗口。环境Token仍可能被同权限进程读。
6. 演示数据：旧测试/乱码数据保留，仅筛选隐藏；描述无[DEMO]的新场需关闭筛选或正确标记。不应通过清库美化报告。
7. 环境：Windows WPS占用8460的Bound socket已避开但未停；独立端口仍可能被后来进程占用，入口应拒绝而不杀外部进程。新库/日志保留会占空间，人工清理需明确指定。
8. 本轮没有替换现有8090/8091/5173运行进程，因此它们可能还是旧版本；演示前本人确认构建和自己管理的重启。GitHub尚未收到本轮本地提交，这是按用户禁推要求执行。
9. 非阻塞P2展示边界：join实时事件只有用户ID，新参与者姓名可能先显示“用户#ID”，待HTTP/快照对齐；房间底部seq标签也可能到轮询后更新。截图07存在这两点，后台事件seq与Channel去重已独立验证，不应把标签延迟说成事件丢失。历史幂等响应携带原bid/seq，界面仍需权威快照对齐当前状态。

## 12. 现场答辩应解释

请本人演示并解释：为何auction→升序wallet避免环；为何全事务重试必须在@Tran代理外；requestId如何同时约束用户/场/金额及丢响应；为什么差额冻结、旧领先者释放、PAY可由ledger解释；严格receivedAt<endTime与最多3次延时；SETTLING持久阶段与唯一result如何抗重复/双实例；事件在事务内写、提交后广播与快照恢复；Agent Token最小权限/配额/吊销与Coding Agent区别；为何多实例WS只最终可见；哪些条件尚没验证。不能把Codex的解释冒称本人已掌握。

## 13. 提交建议

可检查并接收audit/codex-final本地修复；先由本人复跑入口、安装Docker后完成隔离部署验收、确认AI_USAGE并录屏，再决定正式提交。当前建议为**有条件交付检查，不做无条件正式提交背书**。本轮结束后等待用户检查，不继续自动推送、合并、安装Docker或删除任何库/卷。
