# Task2 orchestrator: backend + vite dev + headless-Edge CDP e2e (real browser, real backend, real DB)
param([string]$Root = (Get-Location).Path, [string]$Db = "bid_arena_test")
$ErrorActionPreference = "Continue"
$backend = Join-Path $Root "backend"
$frontend = Join-Path $Root "frontend"
$procs = @()
try {
    # 1) backend on 8090/8091
    $env:BID_DB_URL = "jdbc:mysql://localhost:3306/$Db`?useSSL=false&allowPublicKeyRetrieval=true&serverTimezone=UTC"
    $env:BID_DB_USER = "root"; $env:BID_DB_PASSWORD = "123456"
    $cp = "$backend\target\classes;$backend\target\lib\*"
    $bk = Start-Process -FilePath "D:\New Folder\jdk12\bin\java.exe" -ArgumentList "-cp",$cp,"com.bidarena.App" -RedirectStandardOutput "$env:TEMP\browse_be.out.log" -RedirectStandardError "$env:TEMP\browse_be.err.log" -NoNewWindow -PassThru
    $procs += $bk
    $up=$false; foreach($i in 1..40){Start-Sleep -Milliseconds 700; try{$h=Invoke-RestMethod "http://127.0.0.1:8090/api/v1/health" -TimeoutSec 2; if($h.code -eq 0 -and $h.data.status -eq "UP"){$up=$true;break}}catch{}}
    Write-Host "[browser-e2e] backend UP=$up"
    if(-not $up){ throw "backend not up" }

    # 2) vite dev on 5173
    $vt = Start-Process -FilePath "cmd.exe" -ArgumentList "/c","cd /d `"$frontend`" && npm run dev > `"$env:TEMP\vite.out.log`" 2>&1" -WindowStyle Hidden -PassThru
    $procs += $vt
    $vup=$false; foreach($i in 1..30){Start-Sleep -Milliseconds 1000; try{ $r=Invoke-WebRequest -UseBasicParsing "http://localhost:5173/" -TimeoutSec 3; if($r.StatusCode -eq 200){$vup=$true;break} }catch{}}
    Write-Host "[browser-e2e] vite UP=$vup"
    if(-not $vup){ throw "vite not up" }

    # 3) prepare auction (admin, 75s so settlement happens while browser watches)
    $login = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8090/api/v1/auth/login" -ContentType "application/json; charset=utf-8" -Body '{"email":"admin@example.com","password":"Admin123456!"}'
    $H = @{Authorization="Bearer $($login.data.token)"}
    $create = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8090/api/v1/admin/auctions" -Headers $H -ContentType "application/json; charset=utf-8" -Body '{"title":"E2E-BROWSER-AUCTION","durationSeconds":75,"startPrice":100,"minIncrement":10}'
    $aid = $create.data.auctionId
    Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8090/api/v1/admin/auctions/$aid/start" -Headers $H -ContentType "application/json; charset=utf-8" -Body "{}" | Out-Null
    Write-Host "[browser-e2e] auction=$aid started (75s)"

    # 4) run CDP browser script
    $env:E2E_AUCTION_ID = "$aid"
    & node (Join-Path $Root "scripts\browser_e2e.mjs")
    $code = $LASTEXITCODE
    Write-Host "[browser-e2e] node exit=$code"
    exit $code
} finally {
    foreach($p in $procs){ if($p -and -not $p.HasExited){ Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } }
    Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -match "e2e_screenshots" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}
