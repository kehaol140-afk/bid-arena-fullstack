# 竞拍Agent公开工具与安全操作

Coding Agent（OpenCode/GLM/Codex）负责开发；竞拍Agent使用受限Token自主读取/竞价。scripts/auction-agent.mjs是Node22零依赖可运行的确定性竞拍者，不访问数据库、不持管理员凭证、不要求LLM。

## 管理员一次性准备

管理员登录POST /api/v1/auth/login，创建description以[DEMO]开头的拍卖或使用种子DRAFT。普通账号bidder_a/b与独立auction_agent@example.com均已种子初始化（Test123456!）；管理员admin@example.com/Admin123456!。Agent用户id可通过其登录响应.user.id确认，勿猜固定id。

管理员POST /api/v1/admin/agent-tokens，Authorization: Bearer <管理员会话>，JSON：

```json
{"userId":24,"auctionId":1,"scopes":"auction:read,auction:bid","expiresInSeconds":3600,"rateLimitPerMin":120}
```

将示例id替换实际响应值。响应data.token只在创建返回一次，库里仅SHA256。后续GET /api/v1/admin/agent-tokens?userId=实际Agent用户id不能恢复明文。POST /api/v1/admin/agent-tokens/{tokenId}/revoke吊销。管理员凭证不得传给竞拍脚本。

推荐在自己的PowerShell会话用Read-Host -AsSecureString输入刚获得的Token，临时转入环境而不输出：

```powershell
$agentSecret = Read-Host '输入受限Agent Token（不显示）' -AsSecureString
$env:AUCTION_AGENT_TOKEN = [System.Net.NetworkCredential]::new('', $agentSecret).Password
$env:BID_API_BASE = 'http://127.0.0.1:8090'
$env:AUCTION_AGENT_BUDGET = '300'
$env:AUCTION_AGENT_POLL_MS = '3000'
$env:AUCTION_AGENT_MAX_RUNTIME_MS = '300000'
try { node scripts/auction-agent.mjs } finally { Remove-Item Env:AUCTION_AGENT_TOKEN }
```

预算是本场最终价格上限，不是反复把每次出价累加；已有领先冻结只增差额。先运行Agent可等待DRAFT，再管理员手动启动。不要将真实Token写到.env、命令参数、Git、日志、报告或录屏；环境仍可能被同权限本机进程读取，使用隔离账户/终端。录屏避开签发响应。

## Agent工具契约

所有工具Authorization: Bearer环境Token，Content-Type: application/json。机器可读规范GET /openapi.json（Swagger/OpenAPI2）；JSON响应code/data/message，HTTP状态独立检查。

| 方法 / 路径 | 范围及输入 | 行为 |
|---|---|---|
| GET /api/v1/agent/me | 有效Token | 返回自身userId、auctionId、scopes、过期时间及配额 |
| GET /api/v1/agent/auctions/{id} | auction:read，id须绑定场 | 当前价、最小增量、截止时间、领先者、状态、seq/result |
| GET /api/v1/agent/wallet | auction:read，无userId参数 | 只返回本人balance/frozen/available |
| GET /api/v1/agent/auctions/{id}/bids | auction:read，绑定场 | 公开竞价历史 |
| POST /api/v1/agent/auctions/{id}/join | auction:bid，{} | 幂等加入，participant_type=AGENT |
| POST /api/v1/agent/auctions/{id}/bids | auction:bid，requestId唯一字符串、amount整数 | 复用正常BidService事务，旧requestId不得改场/改金额 |

示例策略：查询身份和场状态；非RUNNING等待；已领先等待；新价=currentPrice+minIncrement；不超过预算且新增冻结不超过available时join、出价；终态/预算耗尽停止。每个新决策UUID，网络错误/响应丢失及2008使用原requestId重试。竞争拒绝2001–2004刷新；401停止；429遵守Retry-After等待；403或其他错误停止。默认30次/分钟配额容易被高频读取耗尽，演示建议管理员设120或调慢轮询。

若现场用Coding Agent作为竞拍决策者，只授予上述HTTP工具和环境Token，禁止SQL、管理接口、读取别人凭证及修改服务代码；由本人检查拍卖id/预算/有效期，结束立即吊销Token。代码开发权限不应与竞拍运行权限混用。
