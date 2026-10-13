# Bid Arena 独立演示环境（Docker Compose 项目 bid-arena-demo）
# 全新数据卷，仅包含种子内容：管理员/两个真人/Agent 用户/20机器人/1个DRAFT演示拍品。
# 不触碰原开发实例(8090/8091/5173)、验收实例 bid-arena-codex-check(13306/18090/18091/15173)
# 及任何已有数据卷。自动化测试一律使用隔离测试库，禁止指向本演示环境。
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File scripts/demo-docker.ps1 -Action up      # 创建/启动（幂等）
#   powershell -ExecutionPolicy Bypass -File scripts/demo-docker.ps1 -Action status  # 查看容器状态
#   powershell -ExecutionPolicy Bypass -File scripts/demo-docker.ps1 -Action logs    # 跟踪最近日志
#   powershell -ExecutionPolicy Bypass -File scripts/demo-docker.ps1 -Action down    # 停止（保留数据卷）
# 访问： http://localhost:25173  （API/WS 由 Nginx 同源代理）
# 彻底重建演示库需人工执行（会删除演示卷 demo 数据，需本人确认，脚本绝不自动执行）：
#   docker compose -p bid-arena-demo --profile full --env-file .env.demo down -v
param(
  [Parameter(Mandatory = $true)][ValidateSet('up', 'status', 'logs', 'down')] [string]$Action
)
$ErrorActionPreference = 'Stop'
$dockerDir = "$env:LOCALAPPDATA\Programs\DockerDesktop\resources\bin"
if (Test-Path $dockerDir) { $env:PATH = "$dockerDir;$env:PATH" }
$repo = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $repo '.env.demo'
$example = Join-Path $repo '.env.demo.example'
$project = 'bid-arena-demo'

try { $null = docker version --format '{{.Server.Version}}' 2>$null }
catch { Write-Error 'Docker Engine 不可用：请先启动 Docker Desktop 并等待其就绪。' }

if (-not (Test-Path $envFile)) {
  if (-not (Test-Path $example)) { Write-Error "缺少 $example" }
  $rng = New-Object Security.Cryptography.RNGCryptoServiceProvider
  $bytes = New-Object byte[] 18
  $rng.GetBytes($bytes)
  $secret = [Convert]::ToBase64String($bytes).Replace('+', '-').Replace('/', '_')
  (Get-Content $example -Raw) -replace 'MYSQL_ROOT_PASSWORD=.*', "MYSQL_ROOT_PASSWORD=$secret" | Set-Content -Encoding ascii $envFile
  Write-Output "已生成 $envFile（随机 MySQL 密码，不入 Git）"
}

switch ($Action) {
  'up' {
    Write-Output "== 启动演示环境（项目 $project，首次会构建镜像并执行迁移+种子） =="
    docker compose -p $project --profile full --env-file $envFile up -d --build
    if ($LASTEXITCODE -ne 0) { Write-Error 'compose up 失败，请查看上方输出' }
    Write-Output ''
    docker compose -p $project --profile full --env-file $envFile ps
    Write-Output ''
    Write-Output '前端: http://localhost:25173   管理员: admin@example.com / Admin123456!'
    Write-Output '真人:   bidder_a@example.com、bidder_b@example.com / Test123456!'
    Write-Output 'Agent:  auction_agent@example.com / Test123456!（签发受限Token见 docs/USER_GUIDE.md）'
  }
  'status' {
    docker compose -p $project --profile full --env-file $envFile ps
  }
  'logs' {
    docker compose -p $project --profile full --env-file $envFile logs --tail 80
  }
  'down' {
    # 仅停止容器，保留命名卷（演示数据不丢）
    docker compose -p $project --profile full --env-file $envFile stop
    docker compose -p $project --profile full --env-file $envFile rm --force
    Write-Output '演示环境已停止（数据卷保留；再次 -Action up 可原样恢复）'
  }
}
