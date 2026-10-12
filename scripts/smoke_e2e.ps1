# Bid Arena GATE-A2 端到端主链路冒烟（真实 HTTP + 真实 MySQL，无 Mock）
param(
    [string]$Db = "bid_arena",
    [int]$Port = 8090
)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$backend = Join-Path $root "backend"
$results = @()

function Step($name, $ok, $detail) {
    $script:results += [pscustomobject]@{Step=$name; Result=$(if($ok){"PASS"}else{"FAIL"}); Detail=$detail}
    Write-Host ("[{0}] {1} :: {2}" -f $(if($ok){"PASS"}else{"FAIL"}), $name, $detail)
}

function Json($o) { $o | ConvertTo-Json -Compress }

function Post($path, $headers, $bodyObj) {
    Invoke-RestMethod -Method Post -Uri "http://localhost:$Port$path" -Headers $headers -ContentType "application/json; charset=utf-8" -Body (Json $bodyObj)
}
function Get2($path, $headers) {
    Invoke-RestMethod -Method Get -Uri "http://localhost:$Port$path" -Headers $headers
}

function Start-Backend([string]$logTag) {
    $cpFile = Join-Path $backend "target\cp.txt"
    if (-not (Test-Path $cpFile)) {
        & "C:\Users\lenovo\tools\apache-maven-3.9.9\bin\mvn.cmd" -q dependency:build-classpath "-Dmdep.outputFile=target\cp.txt" -f (Join-Path $backend "pom.xml") | Out-Null
    }
    $cp = Get-Content $cpFile -Raw
    $p = Start-Process -FilePath "java" -ArgumentList "-cp", "$backend\target\classes;$cp", "com.bidarena.App" -RedirectStandardOutput "$backend\target\smoke_$logTag.out.log" -RedirectStandardError "$backend\target\smoke_$logTag.err.log" -NoNewWindow -PassThru
    $ready = $false
    foreach ($i in 1..40) {
        Start-Sleep -Milliseconds 700
        try {
            $h = Invoke-RestMethod "http://localhost:$Port/api/v1/health" -TimeoutSec 2
            # 必须等 status=UP：HTTP 监听早于 flyway 迁移+种子完成（空库启动竞态，health 为 STARTING）
            if ($h.code -eq 0 -and $h.data.status -eq "UP") { $ready = $true; break }
        } catch {}
    }
    return @{Proc=$p; Ready=$ready}
}

function Stop-Backend($handle) {
    if ($handle -and $handle.Proc -and -not $handle.Proc.HasExited) {
        Stop-Process -Id $handle.Proc.Id -Force
        Start-Sleep -Milliseconds 1500
    }
}

try {
    ########## 阶段 1：主链路 ##########
    $env:BID_DB_URL = "jdbc:mysql://localhost:3306/$Db" + "?useSSL=false&allowPublicKeyRetrieval=true&serverTimezone=UTC"
    $app = Start-Backend "main"
    Step "backend boot + health" $app.Ready $(if($app.Ready){"UP"}else{"not ready"})

    $admin = Post "/api/v1/auth/login" @{} @{email="admin@example.com";password="Admin123456!"}
    Step "admin login" ($admin.code -eq 0 -and $admin.data.user.role -eq "ADMIN") "role=$($admin.data.user.role)"
    $H = @{Authorization = "Bearer $($admin.data.token)"}

    $a = Post "/api/v1/auth/login" @{} @{email="bidder_a@example.com";password="Test123456!"}
    $b = Post "/api/v1/auth/login" @{} @{email="bidder_b@example.com";password="Test123456!"}
    $HA = @{Authorization = "Bearer $($a.data.token)"}
    $HB = @{Authorization = "Bearer $($b.data.token)"}
    Step "bidder_a/b login" ($a.code -eq 0 -and $b.code -eq 0) "A=id$($a.data.user.id) B=id$($b.data.user.id)"
    $uidA = $a.data.user.id; $uidB = $b.data.user.id

    $create = Post "/api/v1/admin/auctions" $H @{title="E2E冒烟拍品"; description="6s"; durationSeconds=6}
    $auctionId = $create.data.auctionId
    Step "admin create auction(6s)" ($create.code -eq 0 -and $auctionId -gt 0) "auctionId=$auctionId"

    $start = Post "/api/v1/admin/auctions/$auctionId/start" $H @{}
    Step "admin start auction" ($start.code -eq 0 -and $start.data.status -eq "RUNNING" -and $start.data.endTime -gt 0) "status=$($start.data.status) endTime=$($start.data.endTime)"

    $j1 = Post "/api/v1/auctions/$auctionId/join" $HA @{}
    $j2 = Post "/api/v1/auctions/$auctionId/join" $HB @{}
    Step "A/B join" ($j1.code -eq 0 -and $j2.code -eq 0) "joined"

    $bidA = Post "/api/v1/auctions/$auctionId/bids" $HA @{requestId="smoke-a-$auctionId"; amount=110}
    Step "A bid 110" ($bidA.code -eq 0 -and $bidA.data.currentPrice -eq 110) "seq=$($bidA.data.seq) price=$($bidA.data.currentPrice)"

    $bidB = Post "/api/v1/auctions/$auctionId/bids" $HB @{requestId="smoke-b-$auctionId"; amount=130}
    Step "B bid 130" ($bidB.code -eq 0 -and $bidB.data.currentPrice -eq 130) "seq=$($bidB.data.seq) price=$($bidB.data.currentPrice)"

    $wa = Get2 "/api/v1/wallets/me" $HA
    $wb = Get2 "/api/v1/wallets/me" $HB
    Step "freeze check (A released, B holds 130)" (($wa.data.frozen -eq 0) -and ($wb.data.frozen -eq 130)) "A frozen=$($wa.data.frozen) B frozen=$($wb.data.frozen)"

    $la = (Get2 "/api/v1/wallets/me/ledger" $HA).data | Where-Object {$_.auctionId -eq $auctionId}
    $lb = (Get2 "/api/v1/wallets/me/ledger" $HB).data | Where-Object {$_.auctionId -eq $auctionId}
    $typesA = ($la | ForEach-Object {$_.type}) -join ","
    $typesB = ($lb | ForEach-Object {$_.type}) -join ","
    Step "ledger check" ($typesA.Contains("FREEZE") -and $typesA.Contains("UNFREEZE") -and $typesB.Contains("FREEZE")) "A[$typesA] B[$typesB]"

    $settled = $false; $detail = "not finished"; $d = $null
    foreach ($i in 1..30) {
        Start-Sleep -Milliseconds 800
        $d = Get2 "/api/v1/auctions/$auctionId" $H
        if ($d.data.status -eq "FINISHED") {
            $settled = $true
            $detail = "status=FINISHED winner=$($d.data.result.winnerId) price=$($d.data.result.finalPrice) reason=$($d.data.result.reason)"
            break
        }
    }
    Step "auto settle after expiry" ($settled -and $d.data.result.winnerId -eq $uidB -and $d.data.result.finalPrice -eq 130) $detail

    $wa2 = Get2 "/api/v1/wallets/me" $HA
    $wb2 = Get2 "/api/v1/wallets/me" $HB
    $pay = (Get2 "/api/v1/wallets/me/ledger" $HB).data | Where-Object {$_.auctionId -eq $auctionId -and $_.type -eq "PAY"}
    Step "post-settle funds (B=870/0, PAY ledger)" (($wb2.data.frozen -eq 0) -and ($wb2.data.balance -eq 870) -and ($wa2.data.frozen -eq 0) -and (@($pay).Count -ge 1)) "B balance=$($wb2.data.balance) frozen=$($wb2.data.frozen) payLedger=$(@($pay).Count)"

    ########## 阶段 2：重启恢复 ##########
    $create2 = Post "/api/v1/admin/auctions" $H @{title="E2E重启恢复拍品"; durationSeconds=8}
    $aid2 = $create2.data.auctionId
    Post "/api/v1/admin/auctions/$aid2/start" $H @{} | Out-Null
    Post "/api/v1/auctions/$aid2/join" $HA @{} | Out-Null
    $bidA2 = Post "/api/v1/auctions/$aid2/bids" $HA @{requestId="smoke-a2-$aid2"; amount=110}
    Step "recovery auction bid 110" ($bidA2.code -eq 0) "auctionId=$aid2"
    $waHold = (Get2 "/api/v1/wallets/me" $HA).data.frozen
    Step "A frozen=110 before crash" ($waHold -eq 110) "frozen=$waHold"

    Stop-Backend $app
    Step "backend killed (simulate crash)" $true "process stopped"

    $env:MYSQL_PWD = "123456"
    & "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe" -uroot $Db -e "UPDATE auctions SET status='SETTLING' WHERE id=$aid2;"
    $env:MYSQL_PWD = $null

    $app2 = Start-Backend "resume"
    Step "backend restart" $app2.Ready "restarted"

    $resumed = $false; $detail2 = "not resumed"; $d2 = $null
    foreach ($i in 1..30) {
        Start-Sleep -Milliseconds 800
        $d2 = Get2 "/api/v1/auctions/$aid2" $H
        if ($d2.data.status -eq "FINISHED") {
            $resumed = $true
            $detail2 = "status=FINISHED winner=$($d2.data.result.winnerId) reason=$($d2.data.result.reason)"
            break
        }
    }
    Step "scanner resume settle after restart" ($resumed -and $d2.data.result.winnerId -eq $uidA) $detail2

    $wa3 = Get2 "/api/v1/wallets/me" $HA
    Step "post-resume funds (A=890/0)" (($wa3.data.balance -eq 890) -and ($wa3.data.frozen -eq 0)) "balance=$($wa3.data.balance) frozen=$($wa3.data.frozen)"

    Stop-Backend $app2
}
catch {
    Step "unexpected error" $false $_.Exception.Message
}
finally {
    # 只停止本脚本启动的后端进程，绝不动机器上其他 java 进程（共享开发机）
    Stop-Backend $app
    Stop-Backend $app2
}

Write-Host ""
Write-Host "===== GATE-A2 SUMMARY ====="
$fail = @($results | Where-Object {$_.Result -eq "FAIL"}).Count
$results | Format-Table -AutoSize
Write-Host ("TOTAL={0} PASS={1} FAIL={2}" -f $results.Count, ($results.Count - $fail), $fail)
if ($fail -gt 0) { exit 1 } else { exit 0 }
