# Bid Arena 多人实时拍卖

Vue3 + TypeScript + Pinia；Java17目标/Solon3.10.7；MySQL8；WebSocket；Node22模拟器与独立竞拍Agent。MySQL是唯一业务事实源，积分不涉及真实支付。

本轮独立审计：docs/CODEX_AUDIT_REPORT.md（修复前），docs/CODEX_FINAL_AUDIT.md（最终实测与剩余风险）。旧docs中的集成报告是前任历史记录，不等于本轮验证；不存在的历史测试类不能当证据。Docker运行、Java17容器及本人录屏/设计确认未验证，详见最终报告。

## 本地快速启动

前置：Windows PowerShell、JDK17+、Maven3.9+、Node22.6+、MySQL8已启动。先npm ci（根目录及frontend各一次）。脚本默认工具路径针对开发机，可参数覆盖；数据库已存在且用户有建表/迁移权限。开发账号只用于本地评审，公开部署必须替换密码、启用TLS。

```powershell
npm ci
npm --prefix frontend ci
powershell -ExecutionPolicy Bypass -File scripts/start-local.ps1
# http://localhost:5173；API8090，WS8091
powershell -ExecutionPolicy Bypass -File scripts/stop-local.ps1
```

启动不会清空数据库；Flyway迁移与幂等种子保留已有余额。DRAFT需管理员手动启动。start-local支持-Database、-DbUser、-DbPassword、-MavenHome、-MySqlExe及-HttpPort/-WsPort/-FrontendPort；自定义后端端口会传给前端代理。停止只处理本脚本创建的组件，复用的服务不停止。已有服务可能运行旧代码，正式演示请本人确认已构建/重启，审计不会擅停当前8090/8091/5173。

| 本地种子账号 | 密码 / 身份 |
|---|---|
| admin@example.com | Admin123456! / ADMIN |
| bidder_a@example.com、bidder_b@example.com | Test123456! / USER |
| auction_agent@example.com | Test123456! / AGENT |
| bot_01..bot_20@example.com | Test123456! / USER |

新钱包1000；默认起拍100、最小加价10、时长180秒，最后5秒延10秒最多3次。界面默认只显示固定种子或description以[DEMO]开头的场；关闭“仅演示拍卖”可看所有历史数据。新演示场description写[DEMO]，旧测试和乱码场未删除/改写。

## 独立竞拍Agent

管理员为独立AGENT用户签发绑定auctionId、auction:read/auction:bid、有效期和配额的Token。完整操作及脱敏输入见AGENT_TOOL_SPEC.md。仅将其放临时AUCTION_AGENT_TOKEN环境变量，不将管理员Token传给Agent。

```powershell
# 先按AGENT_TOOL_SPEC安全输入AUCTION_AGENT_TOKEN
$env:AUCTION_AGENT_BUDGET='300'
$env:AUCTION_AGENT_POLL_MS='3000'
node scripts/auction-agent.mjs
Remove-Item Env:AUCTION_AGENT_TOKEN
```

不需要收费API/训练。脚本用公开受限HTTP工具读取状态/本人钱包、最小加价、UUID幂等、401停止、429等待、竞争刷新及响应丢失同requestId重试。Coding Agent与竞拍Agent是两回事。

## 一键独立验收

使用真实MySQL，每次新建bid_arena_codex_*库，独立端口8290/8291、8300/8301、8440/8441、8470/8471、8480/8481、Vite5480、EdgeCDP9322。不删除既有库或数据。请保证端口空闲、Node依赖已安装、Edge已安装（浏览器测试）。JAVA_HOME必须指JDK目录，不使用Oracle javapath包装器；MAVEN_HOME指Maven目录。

```powershell
$env:JAVA_HOME='你的JDK目录'
$env:MAVEN_HOME='你的Maven目录'
# 非默认测试密码用环境变量设置BID_TEST_DB_PASSWORD，不写进Git
powershell -ExecutionPolicy Bypass -File scripts/test-all.ps1
```

入口依次运行真实MySQL JUnit+构建、Vitest+构建、HTTP/MySQL/WS/Agent双实例恢复、20人seed42和seed7、实际Edge E2E、Compose静态检查。测试数据库账户需建库、DDL/触发器及performance_schema锁观察权限；只针对独立测试库。任何失败立即非零退出。输出在docs/audit-evidence；原始logs保留本机；新测试库保留供复核，清理需本人明确选择库名。本机默认mysql.exe路径可-MySqlExe覆盖，-DbUser及-DbPassword可覆盖；无Docker时运行时明确NOT_VERIFIED。

对运行中的演示库执行npm run simulate:auction会新增场和资金流水；推荐先用隔离测试入口，不把模拟结果混入普通演示。单独模拟node scripts/demo-audit.mjs --seed=42；浏览器node scripts/demo-audit.mjs --browser（需先设置BID_JAVA_EXE为实际JDK/bin/java.exe）。

## Docker完整启动（待运行时确认）

Windows安装Docker Desktop并启用WSL2/Linux containers，确保Docker Engine运行及docker compose v2可用。本轮主机没有Docker，以下是待执行验收步骤，不是已通过结果。不要使用down -v或删除现有卷。

```powershell
Copy-Item .env.example .env
# 修改.env中的MYSQL_ROOT_PASSWORD；独立项目名生成新的具名卷
$env:MYSQL_PORT='13306'
$env:BACKEND_HTTP_PORT='18090'
$env:BACKEND_WS_PORT='18091'
$env:FRONTEND_PORT='15173'
docker compose -p bid-arena-codex-check --profile full config
docker compose -p bid-arena-codex-check --profile full up --build -d
docker compose -p bid-arena-codex-check --profile full ps
docker compose -p bid-arena-codex-check --profile full logs --tail 100
# 访问http://localhost:15173；Nginx同源代理/api/v1、/openapi.json、/ws/
docker compose -p bid-arena-codex-check --profile full restart
# 按下列部署验收清单核对，再停止；命名卷保留
docker compose -p bid-arena-codex-check --profile full down
```

必须实际核对：mysql/backend/frontend healthy、自动V1/V2+种子、登录、两人出价、浏览器WS连接/序号、到期结算、重启后旧结果/资金/流水仍在、滞留SETTLING恢复。日志不能包含明文Token。默认单后端；多实例资金唯一结算已测，但WS主动广播仅进程内，需SYNC/HTTP轮询恢复，不能声称即时跨实例事件分发。

## 接口及交付文件

GET /openapi.json为实际路由生成的Swagger/OpenAPI2 JSON；本地前端同源代理亦可访问。SessionBearer与AgentBearer分别认证，错误响应HTTP状态及code都需检查。主HTTP包括auth/login/logout、users/me、wallet/ledger、auctions/detail/join/bids/events、admin场与Token；Agent工具完整路径见AGENT_TOOL_SPEC。

DESIGN：锁、事务、失败恢复及WS边界；DECISIONS：本轮决定/未采用方案；AI_USAGE：OpenCode/GLM/Codex来源与本人待确认；DEBUG_LOG：真实错误；docs/DEMO_RECORDING.md：3–5分钟录屏计划。需要本人确认的历史设计和代码比例不代填。

Git工作在audit/codex-final，真实修复本地提交；本轮没有push或合并main。最终提交前需本人完成Docker验收、AI_USAGE确认和录屏，逐项理解资金与恢复设计。
