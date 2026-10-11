# Static validation of docker-compose.yml + Dockerfile (no Docker required).
# Runtime bring-up is NOT_VERIFIED on machines without Docker (docs/QA_BLOCKERS.md QA-006).
# Usage: powershell -ExecutionPolicy Bypass -File scripts/check-compose.ps1
$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
$compose = Join-Path $root "docker-compose.yml"
$dockerfile = Join-Path $root "docker\backend.Dockerfile"
$envExample = Join-Path $root ".env.example"
$fail = 0

function Check($name, $cond, $detail) {
  if ($cond) { Write-Host "[PASS] $name" }
  else { Write-Host "[FAIL] $name -- $detail"; $script:fail = 1 }
}

Write-Host "== compose static checks =="
$y = Get-Content $compose -Raw
Check "file exists: docker-compose.yml" (Test-Path $compose) ""
Check "service mysql defined (image mysql:8.0)" ($y -match "(?m)^\s{2}mysql:\s*$" -and $y -match "image:\s*mysql:8\.0") ""
Check "service backend defined with build" ($y -match "(?m)^\s{2}backend:\s*$" -and $y -match "docker/backend\.Dockerfile") ""
Check "mysql healthcheck (mysqladmin ping)" ($y -match "mysqladmin ping") ""
Check "backend healthcheck (/api/v1/health)" ($y -match "/api/v1/health") ""
Check "backend depends_on mysql service_healthy" ($y -match "(?s)depends_on:\s*\r?\n\s+mysql:\s*\r?\n\s+condition: service_healthy") ""
Check "backend wired to mysql host + env db credentials" ($y -match "jdbc:mysql://mysql:3306/" -and $y -match "BID_DB_PASSWORD: \$\{MYSQL_ROOT_PASSWORD\}") ""
Check "named volume for mysql data (no anonymous volume)" ($y -match "mysql-data:/var/lib/mysql" -and $y -match "(?m)^volumes:\s*\r?\n\s{2}mysql-data:") ""
Check "utf8mb4 + UTC server flags" ($y -match "utf8mb4" -and $y -match "default-time-zone") ""
Check "ports overridable via env (.env)" ($y -match "\$\{BACKEND_HTTP_PORT" -and $y -match "\$\{MYSQL_PORT" -and $y -match "\$\{BACKEND_WS_PORT") ""
Check "frontend behind profile full (until frontend/ lands)" ($y -match 'profiles: \["full"\]') ""
Check "MYSQL_ROOT_PASSWORD required (fail fast if unset)" ($y -match "\$\{MYSQL_ROOT_PASSWORD:\?set in \.env\}") ""

Write-Host "== backend Dockerfile static checks =="
$d = Get-Content $dockerfile -Raw
Check "multi-stage build (maven -> jre)" ($d -match "FROM maven:3\.9-eclipse-temurin-17 AS build" -and $d -match "FROM eclipse-temurin:17-jre") ""
Check "java 17 runtime" ($d -match "eclipse-temurin[:\-]17-jre") ""
Check "classpath thin jar + lib/*" ($d -match 'app\.jar:lib/\*') ""
Check "curl present for HEALTHCHECK" ($d -match "apt-get install.*curl") ""
Check "HEALTHCHECK hits /api/v1/health" ($d -match "/api/v1/health") ""
Check "EXPOSE 8090 + 8091" ($d -match "EXPOSE 8090 8091") ""
Check "build context paths exist (backend/pom.xml, backend/src)" ((Test-Path (Join-Path $root "backend\pom.xml")) -and (Test-Path (Join-Path $root "backend\src"))) ""

Write-Host "== env example coverage =="
$e = Get-Content $envExample -Raw
foreach ($v in @("MYSQL_ROOT_PASSWORD", "MYSQL_DATABASE", "MYSQL_PORT", "BACKEND_HTTP_PORT", "BACKEND_WS_PORT", "FRONTEND_PORT", "BID_DB_URL", "BID_DB_USER", "BID_DB_PASSWORD", "BID_DB_POOL_MAX")) {
  Check ".env.example defines $v" ($e -match "^\s*$v=" -or $e -match "$v=") "add to .env.example"
}

Write-Host "== docker runtime availability =="
$dockerCmd = Get-Command docker -ErrorAction SilentlyContinue
if ($dockerCmd) {
  Write-Host "[INFO] docker detected; runtime validation possible:"
  Write-Host "       docker compose config           # validate + interpolate"
  Write-Host "       docker compose up -d --build    # full bring-up"
  $null = & docker compose -f $compose config --quiet 2>&1
  if ($LASTEXITCODE -eq 0) { Write-Host "[PASS] docker compose config (schema valid)" }
  else { Write-Host "[FAIL] docker compose config rejected the file"; $fail = 1 }
} else {
  Write-Host "[NOT_VERIFIED] docker CLI not installed on this machine; compose bring-up NOT executed (see docs/QA_BLOCKERS.md QA-006)."
}

Write-Host ""
if ($fail -eq 0) { Write-Host "RESULT: static checks PASS; runtime = NOT_VERIFIED (no docker)"; exit 0 }
else { Write-Host "RESULT: static checks FAILED"; exit 1 }
