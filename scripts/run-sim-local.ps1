# One-command local QA run: start backend (WMI-detached, isolated ports + isolated DB), run simulator, stop backend.
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts/run-sim-local.ps1
#   powershell -ExecutionPolicy Bypass -File scripts/run-sim-local.ps1 -SimArgs @('--auctionId=1','--bots=20','--seed=42')
# Requires: MySQL on localhost:3306, Java 17+, built backend (auto-builds if missing).
# Isolation notes (docs/QA_BLOCKERS.md QA-004):
#   - ports 8190/8191 + database bid_arena_sim to avoid clashing with other agents on 8090/8091 + shared db bid_arena
#   - backend launched via WMI (detached; parent = WmiPrvSE) because terminal-attached java processes
#     get stopped by other agents' tooling on this shared machine
param(
  [int]$HttpPort = 8190,
  [int]$WsPort = 8191,
  [string]$Database = "bid_arena_sim",
  [string]$DbUser = "root",
  [string]$DbPassword = "123456",
  [string]$MavenHome = "C:\Users\lenovo\tools\apache-maven-3.9.9",
  [string]$MySqlExe = "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe",
  [string]$JavaExe = "D:\New Folder\jdk12\bin\java.exe",
  [string[]]$SimArgs = @()
)
$ErrorActionPreference = "Continue" # native tools (mysql/npm/mvn) write warnings to stderr
$root = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $root "backend"
$jar = Join-Path $backend "target\bid-arena-backend.jar"

if (-not (Test-Path (Join-Path $backend "target\classes\com\bidarena\App.class"))) {
  Write-Host "[run-sim] building backend..."
  & (Join-Path $MavenHome "bin\mvn.cmd") -q -DskipTests package 2>$null
  if ($LASTEXITCODE -ne 0) { throw "maven build failed" }
}
if (-not (Test-Path $JavaExe)) { $JavaExe = "java" }

# Ensure isolated database exists (create only; never drop/reset any database)
if (Test-Path $MySqlExe) {
  & $MySqlExe -u $DbUser -p$DbPassword -h 127.0.0.1 -P 3306 -e "CREATE DATABASE IF NOT EXISTS $Database CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;" 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) { Write-Warning "[run-sim] could not ensure db $Database (mysql cli failed); continuing" }
} else {
  Write-Warning "[run-sim] mysql.exe not found at $MySqlExe; ensure db $Database exists manually"
}

$env:BID_DB_URL = "jdbc:mysql://localhost:3306/$Database`?useSSL=false&allowPublicKeyRetrieval=true&serverTimezone=UTC"
$env:BID_DB_USER = $DbUser
$env:BID_DB_PASSWORD = $DbPassword

# NOTE: env vars set here do NOT propagate to WMI-created processes (different session).
# Pass DB config through java system properties instead (Solon reads -D over env defaults via DbConfig? No -
# DbConfig reads env only). Therefore run the backend through cmd with env set inline:
$cp = "$backend\target\classes;$backend\target\lib\*"
$logDir = Join-Path $backend "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Start-DetachedBackend {
  param([string]$LogFile)
  # quote each set (JDBC URL contains '&') ; redirect inside cmd ; whole line runs detached via WMI
  $envBlock = "set `"BID_DB_URL=$env:BID_DB_URL`" && set `"BID_DB_USER=$DbUser`" && set `"BID_DB_PASSWORD=$DbPassword`" && "
  $cmdInner = "$envBlock`"$JavaExe`" -Dserver.port=$HttpPort -Dserver.websocket.port=$WsPort -cp `"$cp`" com.bidarena.App > `"$LogFile`" 2>&1"
  $full = "cmd.exe /c $cmdInner"
  $r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $full }
  return $r
}

$up = $false
$cmdPid = 0
for ($attempt = 1; $attempt -le 3 -and -not $up; $attempt++) {
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $outLog = Join-Path $logDir "sim-backend-$stamp.log"
  $r = Start-DetachedBackend -LogFile $outLog
  if ($r.ReturnValue -ne 0) { Write-Warning "[run-sim] WMI create failed rc=$($r.ReturnValue)"; continue }
  $cmdPid = $r.ProcessId
  Write-Host "[run-sim] attempt $attempt cmdPID=$cmdPid http=127.0.0.1:$HttpPort ws=127.0.0.1:$WsPort db=$Database log=$outLog"
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Milliseconds 800
    try {
      $h = Invoke-RestMethod -Uri "http://127.0.0.1:$HttpPort/api/v1/health" -TimeoutSec 2
      if ($h.code -eq 0 -and $h.data.status -eq "UP") { $up = $true; break }
    } catch { }
  }
}
if (-not $up) { throw "backend failed to become healthy after 3 attempts" }
Write-Host "[run-sim] backend UP (cmdPID=$cmdPid)"

$exitCode = 0
try {
  $allArgs = @("--baseUrl=http://127.0.0.1:$HttpPort", "--wsBase=ws://127.0.0.1:$WsPort") + $SimArgs
  Push-Location $root
  # call node directly: PS5.1 forwards args to npm.cmd unreliably
  & node --experimental-strip-types --disable-warning=ExperimentalWarning simulator\src\main.ts @allArgs
  $exitCode = $LASTEXITCODE
  Pop-Location
} finally {
  # kill only OUR java child (exact child of our cmd wrapper), never other agents' processes
  $children = Get-CimInstance Win32_Process -Filter "ParentProcessId=$cmdPid" -ErrorAction SilentlyContinue
  foreach ($c in $children) { Stop-Process -Id $c.ProcessId -Force -ErrorAction SilentlyContinue; Write-Host "[run-sim] stopped backend java PID=$($c.ProcessId)" }
  Stop-Process -Id $cmdPid -Force -ErrorAction SilentlyContinue
}
Write-Host "[run-sim] simulator exit code: $exitCode"
exit $exitCode
