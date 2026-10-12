# Stop the local Bid Arena stack started by start-local.ps1 (backend + frontend).
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\stop-local.ps1
#
# Safety contract:
#   - stops ONLY processes recorded in logs\local-stack.json (listener pids + our
#     wrapper trees); every kill is guarded by a command-line check
#   - java  -> must be com.bidarena.App with this repo's backend dir on the classpath
#   - node/npm/cmd -> must reference this repo's paths
#   - never touches other Java/Node processes, the database, or any user files
#   - logs are kept for troubleshooting; only the runtime state file is removed
param([string]$StateFile)
$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
if (-not $StateFile) { $StateFile = Join-Path $root "logs\local-stack.json" }

if (-not (Test-Path $stateFile)) {
  Write-Host "[stop-local] no state file ($stateFile) - nothing started by start-local.ps1, nothing to stop."
  exit 0
}
try { $state = Get-Content $stateFile -Raw -Encoding UTF8 | ConvertFrom-Json }
catch { Write-Host "[stop-local] state file unreadable ($_) - refusing to guess; nothing stopped."; exit 1 }

function Stop-IfOurs([int]$pid_, [string]$label) {
  if ($pid_ -le 0) { return }
  $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$pid_" -ErrorAction SilentlyContinue
  if (-not $proc) { return }
  $cmd = [string]$proc.CommandLine
  $rootEsc = [regex]::Escape($root)
  $safe = $false
  if ($proc.Name -eq "java.exe" -and $cmd -match "com\.bidarena\.App" -and $cmd -match $rootEsc) { $safe = $true }
  elseif ($proc.Name -in @("node.exe","npm.exe","cmd.exe","npm.cmd","conhost.exe") -and $cmd -match $rootEsc) { $safe = $true }
  if (-not $safe) {
    Write-Host "[stop-local] SKIP $label pid=$pid_ $($proc.Name): command line does not match this project (PID reuse?) - not killing" -ForegroundColor Yellow
    return
  }
  Stop-Process -Id $pid_ -Force -ErrorAction SilentlyContinue
  Write-Host "[stop-local] stopped $label : $($proc.Name) PID=$pid_"
}

# Collect descendants of a recorded wrapper pid (cmd -> npm -> node trees).
function Get-Descendants([int]$rootPid) {
  $all = @()
  $frontier = @($rootPid)
  while ($frontier.Count -gt 0) {
    $next = @()
    foreach ($p in $frontier) {
      $kids = Get-CimInstance Win32_Process -Filter "ParentProcessId=$p" -ErrorAction SilentlyContinue
      foreach ($k in $kids) {
        if ($all -notcontains $k.ProcessId) { $all += $k.ProcessId; $next += $k.ProcessId }
      }
    }
    $frontier = $next
  }
  [array]::Reverse($all)
  return $all
}

# 1) the actual listeners first (most reliable): java on http/ws port, node on vite port
if ([int]$state.backendCmdPid -gt 0) { Stop-IfOurs ([int]$state.backendJavaPid) "backend java" }
if ([int]$state.frontendCmdPid -gt 0) { Stop-IfOurs ([int]$state.frontendNodePid) "frontend node" }

# 2) wrapper trees (cmd -> java / cmd -> npm -> node), children first
foreach ($entry in @(
    @{ name = "backend";  pid = [int]$state.backendCmdPid },
    @{ name = "frontend"; pid = [int]$state.frontendCmdPid } )) {
  if ($entry.pid -le 0) { Write-Host "[stop-local] $($entry.name): not started by start-local (reused) - skipped"; continue }
  foreach ($tpid in (Get-Descendants $entry.pid)) { Stop-IfOurs $tpid "$($entry.name) tree" }
  Stop-IfOurs $entry.pid "$($entry.name) wrapper"
}

# confirm ports are released (informational only)
foreach ($p in @([int]$state.httpPort, [int]$state.wsPort, [int]$state.frontendPort)) {
  if ($p -gt 0) {
    $l = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($l) { Write-Host "[stop-local] WARNING port $p still listening (PID $($l.OwningProcess)) - may be a reused/pre-existing process we do not own" -ForegroundColor Yellow }
  }
}

Remove-Item -Path $stateFile -Force -ErrorAction SilentlyContinue
Write-Host "[stop-local] done (logs kept under logs\; database untouched)."
exit 0
