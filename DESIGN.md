# Bid Arena 实际设计

依据原始《全栈评测-拍卖间》5页任务书及本轮源码审计，日期2026-10-12。测试结论以 docs/CODEX_FINAL_AUDIT.md 为准。

## 架构与事实源

Vue3/TypeScript/Pinia/Vite；Java release17、Solon3.10.7；MySQL8/InnoDB为唯一业务事实源；Flyway自动迁移；Node22确定性竞拍Agent及20人模拟器。无Redis、支付、聊天、推荐或LLM依赖。前端经Vite或Nginx同源代理HTTP与WS，后端HTTP8090、WS8091。

users、wallets、wallet_holds、wallet_ledger、auctions、auction_participants、bids、auction_results、auction_events、sessions、agent_tokens及限流计数均在MySQL。金额为整数积分；数据库CHECK保护balance/frozen/available非负；auction_results主键auction_id保护唯一成交；bids唯一(user_id,request_id)。V2增加拍卖持仓检索索引，不重置历史数据。

## 出价事务与锁

BidController/AgentController捕获服务器receivedAt并调用相同BidService。BidService是事务外协调器，调用独立受Solon代理的BidTransaction，避免同类调用绕过@Tran。事务采用READ COMMITTED。

锁顺序：auction FOR UPDATE → 相关wallets按userId升序FOR UPDATE → requestId查询及持仓写入。拍卖锁串行化同场竞价；出价者钱包锁串行化该用户跨场requestId与可用资金。所有出价/取消/结算遵循钱包升序，不能先锁持仓再反向等待钱包。

已存在requestId必须同时匹配auctionId与amount，否则409/2005；匹配则只返回重放、不重复改资金。新请求验证RUNNING、receivedAt严格小于最新end_time、新价至少currentPrice+minIncrement（检查整数溢出）。同一领先者只冻结差额；换领先者释放旧持仓、冻结新价；价格、bid、ledger、hold、seq与events原子提交。INSERT异常不能吞掉后返回成功。

仅SQL1213/1205进行最多3次完整事务尝试（20/40ms退避），不是在已失败事务里重试SQL。耗尽返回409/2008，客户端以同requestId重试；其他异常整笔回滚。重试保留原receivedAt。最后5秒触发+10秒，以最新end_time计算，maxExtends默认3。

## 结算、取消与恢复

RUNNING到期CAS到SETTLING是已提交的小事务；第二事务锁拍卖、读取该场持仓、按userId升序锁钱包、赢家PAY/其他UNFREEZE、唯一result、FINISHED及事件一起提交。重复扫描/两个实例由拍卖锁、状态及结果主键共同保护。无人出价结果winner=null/finalPrice=0，无PAY。取消仅允许DRAFT/RUNNING，释放冻结、唯一取消结果、状态CANCELLED，不扣款。

Scanner持续扫描到期RUNNING和滞留SETTLING，失败后下一轮继续。HTTP数据库提交后响应丢失，凭requestId查已提交结果；服务器停止后的SETTLING恢复已实测。没有做断电/fsync中途故障实验，也不能据此承诺存储系统级零数据损失。MySQL持久性/备份由部署方负责。

## WebSocket及多实例边界

EventFactory信封type/auctionId/seq/serverTime；事务内持久化事件并递增seq，Controller或Scanner在代理Service返回（提交）后broadcastSince。网络发送best-effort，异常不回滚已提交资金。join额外字段为participantType，不能覆盖type。BID_REJECTED只发当前房间本人连接，不写公开事件。

连接校验有效会话、ACTIVE用户及存在的auctionId；存摘要不存明文；每次SYNC/PING重新校验。前端25秒心跳，因此已连接会话吊销到主动检查存在窗口，不是瞬时全局踢下线。凭证放WS查询串，需HTTPS/WSS和日志脱敏；Nginx /ws/已关闭access_log。

前端按房间过滤、seq去重、拒绝旧快照；遇缺号暂停应用增量，发SYNC并HTTP取权威快照；断线指数退避。HTTP/events和权威detail可补恢复。客户端快照HTTP回退的serverTime为本机估计，不应被视为服务器精确时钟。

WS连接注册表是单进程内存，两个实例不会主动跨进程推送彼此事件。MySQL状态/事件对两实例可见，SYNC及房间HTTP轮询恢复最终状态：断线时3秒，连接健康时约21秒兜底。部署推荐单后端或黏性路由；需要即时跨实例推送时另行设计数据库事件轮询/消息总线，不在本轮重构范围。

## 认证与竞拍Agent

登录bcrypt密码、随机会话摘要；用户停用后Session/Agent查询拒绝。管理员签发高熵Token，返回一次明文，库里SHA256摘要；Token绑定用户、auctionId、read/bid范围、过期/吊销/每分钟配额。计数UPDATE+SELECT在同一事务里以行锁串行化，不能并发读到同一旧计数绕过限流。

Agent只能访问/api/v1/agent；不能拿该Token调用管理员、普通用户钱包或他人钱包。/agent/wallet无userId参数，只返回绑定用户的钱包。示例仅受限HTTP API，预算上限、最小加价、唯一UUID、429/401/冲突及传输重试，详细工具边界见AGENT_TOOL_SPEC.md。Coding Agent是开发工具，不等同于竞拍Agent。

## 部署与测试边界

Compose full包含MySQL8、Java17 Solon、Vue/Nginx；具名卷随项目隔离，健康检查与依赖门禁等待迁移种子就绪。无固定container_name；宿主端口可覆盖。初始化通过数据库命名锁串行化幂等种子，不改已有钱包余额；启动保留一场DRAFT供手动开始。

本轮本机Java21编译release17并实际运行；Docker/Java17容器未实际启动，不能用静态配置代替验证。scripts/test-all.ps1使用每次新建的bid_arena_codex_*库与独立端口，不重置用户bid_arena。前端演示筛选只认固定种子标题或description的[DEMO]前缀，可关闭；不删除历史测试拍卖。
