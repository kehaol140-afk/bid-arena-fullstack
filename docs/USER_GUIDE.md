# Bid Arena 用户操作手册（演示环境版）

日期：2026-10-13。本文所有命令与路径均依据仓库真实实现核对，未编造。推荐使用独立Docker演示环境；如需回到原验收/测试环境见第8节。

## 0. 启动与账号

启动演示环境（首次会自动构建镜像、执行迁移并播种）：

```powershell
cd E:\全栈测试-拍卖间\bid-arena-fullstack
powershell -ExecutionPolicy Bypass -File scripts/demo-docker.ps1 -Action up
```

浏览器访问 **http://localhost:25173**（HTTP API 与 WebSocket 由 Nginx 同源代理，无需额外端口）。

| 角色 | 邮箱 | 密码 | 说明 |
|---|---|---|---|
| 管理员 | admin@example.com | Admin123456! | 创建/启动/取消拍卖、签发Agent Token |
| 真人A | bidder_a@example.com | Test123456! | 演示竞拍者A（竞拍者A） |
| 真人B | bidder_b@example.com | Test123456! | 演示竞拍者B（竞拍者B） |
| Agent | auction_agent@example.com | Test123456! | 独立AGENT账号，用受限Token竞拍 |

新库初始状态：每人钱包 1000 积分、1 个 DRAFT 演示拍品（演示拍品·经典机械腕表）。列表默认勾选「仅演示拍品」，只显示种子拍品和描述以 `[DEMO]` 开头的拍卖；取消勾选可查看全部。

## 1. 管理员：创建并启动拍卖

1. 用管理员账号登录 → 左侧进入「拍卖管理」。
2. 页面顶部有完整流程提示。点右上「+ 创建拍卖」，填写标题/描述/起拍价/最小加价/时长（3~3600秒，默认180秒）。
   - 演示建议：描述以 `[DEMO]` 开头（如 `[DEMO] 答辩演示拍品`），这样会出现在默认演示列表；时长可先用 180 秒。
   - 标题支持中文（前后端全链路 UTF-8）。
3. 创建后状态为 **DRAFT（待启动，不倒计时）**，提示框给出编号链接。
4. 在列表中对该场点「**启动**」→ 状态变「竞拍中」，倒计时开始，参与者即可加入出价。
5. 中止演示点「取消」（二次确认）→ 状态 CANCELLED，全部冻结立即释放，不扣款。

## 2. 两个真人在独立浏览器中竞拍

1. 浏览器A（如正常窗口）登录 bidder_a@example.com；浏览器B（如无痕窗口/另一浏览器）登录 bidder_b@example.com。
2. 双方进入同一场拍卖房间。房间内「出价」面板有明确步骤提示：
   - **第一步**：点「加入本场竞拍」（仅竞拍中可加入，重复加入幂等）。
   - **第二步**：输入金额（界面实时显示「最低可出价 = 当前价 + 最小加价」），点「确认出价」。
3. 一方出价后，另一方页面通过 WebSocket 实时刷新价格/领先者/出价历史（房间标题旁「实时同步」徽章=消息通道在线；拍卖业务状态以「待启动/竞拍中/已成交」徽章为准，两者含义不同）。
4. 被超越的一方会收到提示「你已被超越，冻结金额已释放，可继续出价」。

## 3. 钱包冻结、释放与结算的查看

- 房间右侧「我的钱包」实时显示 可用/冻结中；点「查看钱包与流水」进入钱包页。
- 每次出价产生一条 **冻结(FREEZE)** 流水（连续加价只冻结差额）；被超越产生 **解冻(UNFREEZE)**；到期结算赢家产生 **扣款(PAY)**；无人出价/取消不扣款。
- 资金语义：本系统为**积分消耗模型**——赢家冻结额转为扣款（积分消耗）、其余参与者全额解冻，成交积分不转入任何管理员或卖家账户（演示用，无真实支付）。
- 对账关系：所有冻结最终要么解冻要么扣款（Σ冻结−Σ解冻−Σ扣款=0），成交结果每场唯一。

## 4. 最后五秒延时（+10秒，最多3次）演示法

1. 建议管理员专门建一场短时长拍卖（如 30~60 秒）用于演示延时。
2. 两个真人提前加入。当房间倒计时进入最后 5 秒内（倒计时变红），任一参与者出价成功 → 顶部反馈「出价成功！触发最后时刻延时 +10s（第 n/3 次）」，截止时间自动后延，房间「延时」格显示 n/3。
3. 同一场最多触发 3 次；第 4 次最后时刻出价被接受但不再延时。

## 5. 管理员签发 Agent Token

1. 管理员进入「拍卖管理 → Agent Token 管理」（或 POST /api/v1/admin/agent-tokens）。
2. 选择用户 `auction_agent@example.com`、绑定目标拍卖编号、勾选范围 `auction:read,auction:bid`、有效期（秒）与每分钟配额（演示建议 120）。
3. **明文 Token 只在创建响应中显示一次**（数据库仅存 SHA256 摘要），立即复制，不要写入 .env、命令行参数、Git 或日志。

## 6. 安全执行竞拍 Agent（scripts/auction-agent.mjs）

在自己专用的 PowerShell 会话（不要把Token交给其他进程）：

```powershell
$env:AUCTION_AGENT_TOKEN = '粘贴刚签发的一次性明文Token'
$env:BID_API_BASE = 'http://127.0.0.1:28090'   # 演示环境后端
$env:AUCTION_AGENT_BUDGET = '300'
$env:AUCTION_AGENT_POLL_MS = '3000'
$env:AUCTION_AGENT_MAX_RUNTIME_MS = '300000'
node scripts/auction-agent.mjs
Remove-Item Env:AUCTION_AGENT_TOKEN   # 用完立即清除
```

行为：轮询绑定场次，加入并以「当前价+最小加价」出价（预算内、UUID幂等、401停止、429等待、传输失败同 requestId 重试）。Agent 只能访问 /api/v1/agent 受限接口，不能碰管理端或他人钱包。演示完成可在管理端吊销该 Token。

## 7. 20 人模拟（两种方式）

方式一（推荐，隔离不污染）：本地一键独立验收入口，自建 `bid_arena_codex_*` 测试库并自起后端，需本机 JDK17+、Maven、MySQL、Node：

```powershell
$env:JAVA_HOME='你的JDK目录'; $env:MAVEN_HOME='你的Maven目录'
powershell -ExecutionPolicy Bypass -File scripts/test-all.ps1
# 或仅20人确定性模拟：node scripts/demo-audit.mjs --seed=42
```

方式二（实时观看，写入演示库）：直接指向演示环境后端（模拟器自建场次描述为 "simulator created"，**不出现在默认演示列表**，取消勾选「仅演示拍品」可见）：

```powershell
npm run simulate:auction -- --baseUrl=http://127.0.0.1:28090 --wsBase=ws://127.0.0.1:28091 --seed=42 --bots=20
```

报告输出在 simulator/reports/（不入 Git）。不要把该命令指向正式演示讲解中的那一场（会新增场次与流水）。

## 8. Docker 演示环境的运行、停止与环境切换

```powershell
powershell -ExecutionPolicy Bypass -File scripts/demo-docker.ps1 -Action status  # 查看状态
powershell -ExecutionPolicy Bypass -File scripts/demo-docker.ps1 -Action logs   # 最近日志
powershell -ExecutionPolicy Bypass -File scripts/demo-docker.ps1 -Action down   # 停止（数据保留）
powershell -ExecutionPolicy Bypass -File scripts/demo-docker.ps1 -Action up     # 再次启动，数据原样恢复
```

- 演示环境：项目 `bid-arena-demo`，端口 25173(前端)/28090(API)/28091(WS)/23306(MySQL)，独立数据卷。
- 原验收/测试环境：项目 `bid-arena-codex-check`，地址 http://localhost:15173（含审计期测试数据，属预期）。两套环境端口不冲突，可同时运行。
- 本地开发实例（若启动）：5173/8090/8091，用 scripts/start-local.ps1 / stop-local.ps1。
- Docker Desktop 未启动时容器不会运行：先打开 Docker Desktop 等其就绪，再 `-Action up`（容器为 unless-stopped，通常随 Desktop 自启）。
- 彻底重建演示库（删除演示数据、恢复出厂）需本人手动执行，脚本绝不自动执行：
  `docker compose -p bid-arena-demo --profile full --env-file .env.demo down -v` 后再 `-Action up`。

## 9. 常见问题

- **列表里有很多测试拍卖**：那是测试/验收环境的数据；演示环境默认「仅演示拍品」已过滤。讲解时使用 http://localhost:25173。
- **标题出现问号**：是历史测试工具以错误编码（ISO-8859-1）提交造成、已按字面问号持久化，不可恢复；浏览器与管理界面创建中文拍品不受影响（已实测）。
- **「实时同步」绿色徽章**：表示页面与服务器 WebSocket 消息通道在线，与拍卖是否进行中无关；拍卖状态看旁边的业务状态徽章。
- **出价被拒**：界面按错误码给出原因（低于最低价、余额不足、已截止、状态不可出价等），按提示调整。
