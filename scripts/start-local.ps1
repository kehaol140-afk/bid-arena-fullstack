# Bid Arena one-click local start (demo): Solon backend (8090/8091) + Vue frontend (5173).
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\start-local.ps1
# Stop with:
#   powershell -ExecutionPolicy Bypass -File scripts\stop-local.ps1
#
# Safety contract:
#   - NEVER resets/drops the database (Flyway migrate + idempotent seed only)
#   - NEVER kills processes it did not start (see stop-local.ps1)
#   - reuses an already-healthy local stack instead of starting duplicates
#   - keeps backend/frontend logs under logs\ for troubleshooting
param(
  [int]$HttpPort = 8090,
  [int]$WsPort = 8091,
  [int]$FrontendPort = 5173,
  [string]$Database = "bid_arena",
  [string]$DbUser = "root",
  [string]$DbPassword = "123456",
  [string]$MavenHome = "C:\Users\lenovo\tools\apache-maven-3.9.9",
  [string]$MySqlExe = "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe"
)
$ErrorActionPreference = "Continue" # native tools (mysql/mvn/npm) write warnings to stderr
$root = Split-Path -Parent $PSScriptRoot
$backendDir = Join-Path $root "backend"
$frontendDir = Join-Path $root "frontend"
$logDir = Join-Path $root "logs"
$stateFile = Join-Path $logDir "local-stack.json"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"

function Fail([string]$reason) {
  Write-Host ""
  Write-Host "[start-local] FAILED: $reason" -ForegroundColor Red
  Write-Host "[start-local] logs: $logDir" -ForegroundColor Yellow
  exit 1
}
function Get-Listener([int]$port) {
  Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
}
function Get-Proc([int]$pid_) {
  Get-CimInstance Win32_Process -Filter "ProcessId=$pid_" -ErrorAction SilentlyContinue
}
function Test-BackendHealthy {
  # NOTE: keep this simple - Invoke-RestMethod is proven fast on 127.0.0.1 here
  # (system proxy bypass list covers 127.*). Do NOT use [Net.Http.HttpWebRequest]:
  # that short type name does not resolve in PS 5.1 and silently breaks the check.
  try {
    $h = Invoke-RestMethod -Uri "http://127.0.0.1:$HttpPort/api/v1/health" -TimeoutSec 2
    return ($h.code -eq 0 -and $h.data.status -eq "UP")
  } catch { return $false }
}
function Test-FrontendUp {
  # vite binds "localhost" only, which on this machine is IPv6 ::1 - so probe
  # localhost first, then 127.0.0.1 as fallback for IPv4-only hosts.
  foreach ($host_ in @("localhost", "127.0.0.1")) {
    try {
      $r = Invoke-WebRequest -UseBasicParsing -Uri "http://${host_}:$FrontendPort/" -TimeoutSec 3
      if ($r.StatusCode -eq 200) { return $true }
    } catch { }
  }
  return $false
}
function Tail-Log([string]$log, [int]$lines = 30) {
  if (Test-Path $log) {
    Write-Host "--- tail of $log ---" -ForegroundColor Yellow
    Get-Content $log -Tail $lines | ForEach-Object { Write-Host "  $_" }
  }
}
# Guarded kill helpers (same rules as stop-local.ps1): only touch processes whose
# command line references this repo. Used for failure-path cleanup before the
# state file exists.
function Stop-IfOursTree([int]$pid_, [string]$label) {
  if ($pid_ -le 0) { return }
  $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$pid_" -ErrorAction SilentlyContinue
  if (-not $proc) { return }
  if ($proc.CommandLine -and $proc.CommandLine -match [regex]::Escape($root)) {
    Stop-Process -Id $pid_ -Force -ErrorAction SilentlyContinue
    Write-Host "[start-local]   cleanup: stopped $label $($proc.Name) PID=$pid_"
  }
}
function Get-Descendants([int]$rootPid) {
  $all = @()
  $frontier = @($rootPid)
  while ($frontier.Count -gt 0) {
    $next = @()
    foreach ($p in $frontier) {
      $kids = Get-CimInstance Win32_Process -Filter "ParentProcessId=$p" -ErrorAction SilentlyContinue
      foreach ($k in $kids) { if ($all -notcontains $k.ProcessId) { $all += $k.ProcessId; $next += $k.ProcessId } }
    }
    $frontier = $next
  }
  [array]::Reverse($all)
  return $all
}

# ---------- 1) dependency checks ----------
Write-Host "[start-local] (1/6) checking dependencies..." -ForegroundColor Cyan

$javaCmd = Get-Command java -ErrorAction SilentlyContinue
if (-not $javaCmd) {
  $fallback = "D:\New Folder\jdk12\bin\java.exe"
  if (Test-Path $fallback) { $JavaExe = $fallback } else { Fail "java not found (need JDK 17+). Install or add to PATH." }
} else { $JavaExe = $javaCmd.Source }
try { $null = & $JavaExe -version 2>&1 } catch { Fail "java -version failed: $_" }

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Fail "node not found (need >=22.6). Install or add to PATH." }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { Fail "npm not found." }

$mvn = Join-Path $MavenHome "bin\mvn.cmd"
if (-not (Test-Path $mvn)) {
  $mvnCmd = Get-Command mvn.cmd -ErrorAction SilentlyContinue
  if ($mvnCmd) { $mvn = $mvnCmd.Source } else { $mvn = $null }
}

if (-not (Test-Path (Join-Path $frontendDir "node_modules"))) {
  Write-Host "[start-local] frontend/node_modules missing -> npm install" -ForegroundColor Yellow
  Push-Location $frontendDir
  & npm install 2>&1 | Out-Null
  Pop-Location
  if ($LASTEXITCODE -ne 0) { Fail "npm install failed in frontend\" }
}

# MySQL: service running + credentials work (only if mysql.exe is available)
$dbChecked = $false
$svc = Get-Service -Name "MySQL80" -ErrorAction SilentlyContinue
if ($svc -and $svc.Status -ne "Running") { Fail "MySQL service '$($svc.Name)' is $($svc.Status). Start it: net start MySQL80" }
if (Test-Path $MySqlExe) {
  & $MySqlExe -u $DbUser "-p$DbPassword" -h 127.0.0.1 -P 3306 -e "SELECT 1;" 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) { Fail "cannot connect to MySQL 127.0.0.1:3306 as $DbUser (wrong password or server down). Check -DbUser/-DbPassword." }
  # ensure database exists (create only; NEVER drop/reset)
  & $MySqlExe -u $DbUser "-p$DbPassword" -h 127.0.0.1 -P 3306 -e "CREATE DATABASE IF NOT EXISTS ``$Database`` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;" 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) { Fail "could not ensure database '$Database' exists (mysql cli failed)." }
  $dbChecked = $true
} else {
  Write-Host "[start-local] WARNING mysql.exe not found; skipping explicit DB check (backend health check will verify)" -ForegroundColor Yellow
}

# ---------- 2) build backend if needed ----------
Write-Host "[start-local] (2/6) checking backend build..." -ForegroundColor Cyan
if (-not (Test-Path (Join-Path $backendDir "target\classes\com\bidarena\App.class"))) {
  if (-not $mvn) { Fail "backend not built and maven not found (looked in $MavenHome and PATH)." }
  Write-Host "[start-local] building backend (first time ~1-2 min)..."
  & $mvn -q -DskipTests -f (Join-Path $backendDir "pom.xml") package
  if ($LASTEXITCODE -ne 0) { Fail "maven build failed (see output above)." }
}

# ---------- 3) port occupancy ----------
Write-Host "[start-local] (3/6) checking ports $HttpPort/$WsPort/$FrontendPort..." -ForegroundColor Cyan
$backendReused = $false
$l1 = Get-Listener $HttpPort; $l2 = Get-Listener $WsPort
if ($l1 -or $l2) {
  $busy = if ($l1) { $l1 } else { $l2 }
  $owner = Get-Proc ($busy.OwningProcess) 2>$null
  $isOurs = $owner -and $owner.CommandLine -match "com\.bidarena\.App"
  if ($isOurs -and (Test-BackendHealthy)) {
    Write-Host "[start-local] backend already running (java PID=$($owner.ProcessId)), reusing - no duplicate started" -ForegroundColor Yellow
    $backendReused = $true
  } else {
    $name = if ($owner) { "$($owner.Name) PID=$($owner.ProcessId)" } else { "PID $($busy.OwningProcess)" }
    Fail "port(s) occupied by a non-bidarena process: $name. Free port $HttpPort/$WsPort or pass -HttpPort/-WsPort (frontend proxy expects 8090)."
  }
}
$frontendReused = $false
$lf = Get-Listener $FrontendPort
if ($lf) {
  $ownerF = Get-Proc ($lf.OwningProcess) 2>$null
  $isVite = $ownerF -and ($ownerF.CommandLine -match "vite" -or $ownerF.CommandLine -match [regex]::Escape($frontendDir))
  if ($isVite) {
    if (Test-FrontendUp) {
      Write-Host "[start-local] frontend dev server already running (node PID=$($ownerF.ProcessId)), reusing" -ForegroundColor Yellow
      $frontendReused = $true
    } else {
      Fail "port $FrontendPort occupied by an unresponsive process (PID $($lf.OwningProcess)). Stop it first."
    }
  } else {
    Fail "port $FrontendPort occupied by $($ownerF.Name) PID=$($ownerF.ProcessId) (not vite). Stop it first."
  }
}

# ---------- 4) start backend + wait for migrate/seed/health ----------
# NOTE: on this shared machine an external watchdog occasionally sends CTRL+C to
# freshly started java processes (see docs/QA_BLOCKERS.md QA-004 and the 2-byte
# "^C" sim-backend logs). run-sim-local.ps1 proved that bursty interference is
# survived by retrying; we do the same (5 attempts, jittered backoff).
# Kill leftover backend java started by one of OUR attempts in this run.
# Match is strict: com.bidarena.App + this repo's classpath + this port, so it can
# only be an orphan of the current start-local run (port check guarantees nothing
# else held the port when we began). Orphans happen when external interference
# (^C) kills the cmd wrapper but not its java child.
function Stop-OurOrphanBackend {
  $orphans = Get-CimInstance Win32_Process -Filter "Name='java.exe'" -ErrorAction SilentlyContinue | Where-Object {
    $_.CommandLine -match "com\.bidarena\.App" -and
    $_.CommandLine -match "-Dserver\.port=$HttpPort" -and
    $_.CommandLine -match [regex]::Escape($backendDir)
  }
  foreach ($o in $orphans) {
    Stop-Process -Id $o.ProcessId -Force -ErrorAction SilentlyContinue
    Write-Host "[start-local]   cleaned up orphan backend java PID=$($o.ProcessId) from a failed attempt"
  }
}

$backendCmdPid = 0
$backendJavaPid = 0
$backendLog = ""
if (-not $backendReused) {
  Write-Host "[start-local] (4/6) starting backend  http=127.0.0.1:$HttpPort ws=127.0.0.1:$WsPort db=$Database..." -ForegroundColor Cyan
  $cp = "$backendDir\target\classes;$backendDir\target\lib\*"
  $dbUrl = "jdbc:mysql://localhost:3306/$Database" + "?useSSL=false&allowPublicKeyRetrieval=true&serverTimezone=UTC"
  $up = $false
  for ($attempt = 1; $attempt -le 5 -and -not $up; $attempt++) {
    if ($attempt -gt 1) {
      Start-Sleep -Seconds (2 + $attempt)
      Stop-OurOrphanBackend
    }
    $backendLog = Join-Path $logDir "backend-$stamp-$attempt.log"
    # WMI-detached start (proven on this machine); env vars must be inlined because
    # WMI children do not inherit this shell's environment. cwd is set to the repo
    # root so logback's ./logs/solon.log lands in the repo logs dir.
    $envBlock = "set `"BID_DB_URL=$dbUrl`" && set `"BID_DB_USER=$DbUser`" && set `"BID_DB_PASSWORD=$DbPassword`" && "
    $cmdInner = "$envBlock`"$JavaExe`" -Dserver.port=$HttpPort -Dserver.websocket.port=$WsPort -cp `"$cp`" com.bidarena.App > `"$backendLog`" 2>&1"
    $r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = "cmd.exe /c $cmdInner"; CurrentDirectory = $root }
    if ($r.ReturnValue -ne 0) { Write-Host "[start-local]   attempt ${attempt}: WMI create failed rc=$($r.ReturnValue)"; continue }
    $backendCmdPid = $r.ProcessId
    Write-Host "[start-local]   attempt $attempt cmd PID=$backendCmdPid log=$backendLog"
    foreach ($i in 1..50) {
      Start-Sleep -Milliseconds 800
      if (Test-BackendHealthy) { $up = $true; break }
    }
    if (-not $up -and $backendCmdPid -gt 0) {
      # clean up this failed attempt before retrying (cmd wrapper + java child)
      $kids = Get-CimInstance Win32_Process -Filter "ParentProcessId=$backendCmdPid" -ErrorAction SilentlyContinue
      foreach ($k in $kids) { if ($k.Name -eq "java.exe" -and $k.CommandLine -match "com\.bidarena\.App") { Stop-Process -Id $k.ProcessId -Force -ErrorAction SilentlyContinue } }
      Stop-Process -Id $backendCmdPid -Force -ErrorAction SilentlyContinue
      $backendCmdPid = 0
    }
  }
  if (-not $up) {
    Stop-OurOrphanBackend
    Tail-Log $backendLog
    Fail "backend did not become healthy after 5 attempts. Common causes: MySQL down / wrong -DbPassword / external interference killed java (look for a 2-byte log containing only ^C, see docs/QA_BLOCKERS.md QA-004) - just re-run this script."
  }
  # record the ACTUAL java pid owning the http port (wrapper cmd may be dead from ^C)
  $l = Get-Listener $HttpPort
  if ($l) { $backendJavaPid = $l.OwningProcess }
  # health UP == migrate+seed done; also verify the WebSocket port is listening
  Start-Sleep -Seconds 1
  if (-not (Get-Listener $WsPort)) {
    Tail-Log $backendLog
    Fail "backend healthy but WebSocket port $WsPort is NOT listening (regression QA-005?). See log above."
  }
  Write-Host "[start-local] backend UP (migration+seed done, java PID=$backendJavaPid, WS listening on $WsPort)" -ForegroundColor Green
} else {
  Write-Host "[start-local] (4/6) backend reused, skipping start" -ForegroundColor Cyan
  if (-not (Get-Listener $WsPort)) { Fail "reused backend is healthy but WS port $WsPort not listening." }
  $l = Get-Listener $HttpPort
  if ($l) { $backendJavaPid = $l.OwningProcess }
}

# ---------- 5) start frontend ----------
$frontendCmdPid = 0
$frontendNodePid = 0
$frontendLog = ""
if (-not $frontendReused) {
  Write-Host "[start-local] (5/6) starting frontend (vite dev on $FrontendPort)..." -ForegroundColor Cyan
  $frontendLog = Join-Path $logDir "frontend-$stamp.log"
  $cmdFe = "cmd.exe /c cd /d `"$frontendDir`" && npm run dev > `"$frontendLog`" 2>&1"
  $rf = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $cmdFe; CurrentDirectory = $frontendDir }
  if ($rf.ReturnValue -ne 0) { Fail "WMI process create failed for frontend rc=$($rf.ReturnValue)." }
  $frontendCmdPid = $rf.ProcessId
  $vup = $false
  foreach ($i in 1..60) {
    Start-Sleep -Milliseconds 1000
    if (Test-FrontendUp) { $vup = $true; break }
  }
  if (-not $vup) {
    Tail-Log $frontendLog
    # cleanup everything THIS run started (state file is not written yet, so
    # stop-local.ps1 cannot help here; guarded kills only)
    foreach ($tpid in (Get-Descendants $frontendCmdPid)) { Stop-IfOursTree $tpid "frontend tree" }
    Stop-IfOursTree $frontendCmdPid "frontend wrapper"
    Stop-OurOrphanBackend
    if ($backendJavaPid -gt 0) { $jp = Get-CimInstance Win32_Process -Filter "ProcessId=$backendJavaPid" -ErrorAction SilentlyContinue; if ($jp -and $jp.CommandLine -match "com\.bidarena\.App") { Stop-Process -Id $backendJavaPid -Force -ErrorAction SilentlyContinue } }
    if ($backendCmdPid -gt 0) { Stop-Process -Id $backendCmdPid -Force -ErrorAction SilentlyContinue }
    Fail "frontend did not respond on http://localhost:$FrontendPort within 60s (see log above; started processes were stopped)."
  }
  $lfv = Get-Listener $FrontendPort
  $frontendNodePid = if ($lfv) { $lfv.OwningProcess } else { 0 }
  Write-Host "[start-local] frontend UP on http://127.0.0.1:$FrontendPort (node PID=$frontendNodePid)" -ForegroundColor Green
} else {
  Write-Host "[start-local] (5/6) frontend reused, skipping start" -ForegroundColor Cyan
  $lfv = Get-Listener $FrontendPort
  $frontendNodePid = if ($lfv) { $lfv.OwningProcess } else { 0 }
  Write-Host "[start-local] reusing frontend node PID=$frontendNodePid"
}

# ---------- 6) record state + summary ----------
$state = [ordered]@{
  startedAt       = (Get-Date -Format "o")
  root            = $root
  httpPort        = $HttpPort
  wsPort          = $WsPort
  frontendPort    = $FrontendPort
  database        = $Database
  backendCmdPid   = $backendCmdPid    # 0 = reused (pre-existing, NOT managed by stop-local)
  backendJavaPid  = $backendJavaPid   # actual java owning the http port
  frontendCmdPid  = $frontendCmdPid
  frontendNodePid = $frontendNodePid  # actual node owning the vite port
  backendLog      = $backendLog
  frontendLog     = $frontendLog
}
$state | ConvertTo-Json | Set-Content -Path $stateFile -Encoding UTF8

Write-Host ""
Write-Host "================ Bid Arena local stack is UP ================" -ForegroundColor Green
Write-Host "  Browser       : http://localhost:$FrontendPort"
Write-Host "  Backend API   : http://127.0.0.1:$HttpPort/api/v1/health"
Write-Host "  WebSocket     : ws://127.0.0.1:$WsPort/ws/auction"
Write-Host "  Database      : $Database (existing data preserved)"
if ($backendReused -or $frontendReused) {
  Write-Host "  Note          : reused already-running components (start-local did not start duplicates;" -ForegroundColor Yellow
  Write-Host "                   stop-local will still stop the recorded listener processes)" -ForegroundColor Yellow
  Write-Host "  Backend log   : (see latest logs\backend-*.log; this run started nothing)"
} else {
  Write-Host "  Backend log   : $backendLog"
  Write-Host "  Frontend log  : $frontendLog"
}
Write-Host "-------------------------------------------------------------"
Write-Host "  Test accounts (seeded, idempotent):"
Write-Host "    admin  : admin@example.com    / Admin123456!  (ADMIN)"
Write-Host "    user   : bidder_a@example.com / Test123456!   (USER)"
Write-Host "    user   : bidder_b@example.com / Test123456!   (USER)"
Write-Host "    bots   : bot_01..bot_20@example.com / Test123456!"
Write-Host "  Demo tip: login as admin -> create+start auction; login as bidder to bid."
Write-Host "  Stop    : powershell -ExecutionPolicy Bypass -File scripts\stop-local.ps1"
Write-Host "=============================================================" -ForegroundColor Green
exit 0
