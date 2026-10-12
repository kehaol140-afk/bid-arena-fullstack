# R2 extra edge checks: idempotent retry, illegal amounts, insufficient funds, no double settle
param([int]$Port = 8090, [string]$Db = "bid_arena_test", [string]$Root = (Get-Location).Path)
$ErrorActionPreference = "Stop"
$backend = Join-Path $Root "backend"
$mysql = "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe"
$results = @()
function Step($name, $ok, $detail) {
    $script:results += [pscustomobject]@{Step=$name; Result=$(if($ok){"PASS"}else{"FAIL"}); Detail=$detail}
    Write-Host ("[{0}] {1} :: {2}" -f $(if($ok){"PASS"}else{"FAIL"}), $name, $detail)
}
function Json($o) { $o | ConvertTo-Json -Compress }
$env:BID_DB_URL = "jdbc:mysql://localhost:3306/$Db`?useSSL=false&allowPublicKeyRetrieval=true&serverTimezone=UTC"
$env:BID_DB_USER = "root"; $env:BID_DB_PASSWORD = "123456"
$cp = "$backend\target\classes;" + (Get-Content (Join-Path $backend "target\cp.txt") -Raw)
$p = Start-Process -FilePath "D:\New Folder\jdk12\bin\java.exe" -ArgumentList "-cp",$cp,"com.bidarena.App" -RedirectStandardOutput "$env:TEMP\edge.out.log" -RedirectStandardError "$env:TEMP\edge.err.log" -NoNewWindow -PassThru
$app2 = $null
try {
    $up = $false
    foreach ($i in 1..40) { Start-Sleep -Milliseconds 700; try { $h = Invoke-RestMethod "http://127.0.0.1:$Port/api/v1/health" -TimeoutSec 2; if ($h.code -eq 0 -and $h.data.status -eq "UP") { $up=$true; break } } catch {} }
    if (-not $up) { throw "backend not up" }

    $admin = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$Port/api/v1/auth/login" -ContentType "application/json; charset=utf-8" -Body (Json @{email="admin@example.com";password="Admin123456!"})
    $H = @{Authorization = "Bearer $($admin.data.token)"}
    $a = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$Port/api/v1/auth/login" -ContentType "application/json; charset=utf-8" -Body (Json @{email="bidder_a@example.com";password="Test123456!"})
    $HA = @{Authorization = "Bearer $($a.data.token)"}

    $create = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$Port/api/v1/admin/auctions" -Headers $H -ContentType "application/json; charset=utf-8" -Body (Json @{title="edge-checks"; durationSeconds=120})
    $aid = $create.data.auctionId
    Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$Port/api/v1/admin/auctions/$aid/start" -Headers $H -ContentType "application/json; charset=utf-8" -Body "{}" | Out-Null
    Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$Port/api/v1/auctions/$aid/join" -Headers $HA -ContentType "application/json; charset=utf-8" -Body "{}" | Out-Null
    Write-Host "[edge] auction=$aid started (start_price=100, min_incr=10)"

    function TryBid($headers, $body) {
        try { $r = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$Port/api/v1/auctions/$aid/bids" -Headers $headers -ContentType "application/json; charset=utf-8" -Body (Json $body); return @{Ok=$true; Resp=$r} }
        catch {
            $stream = $_.Exception.Response.GetResponseStream()
            if ($stream) { $sr = New-Object IO.StreamReader($stream); $bodyText = $sr.ReadToEnd(); try { $parsed = $bodyText | ConvertFrom-Json } catch { $parsed = $bodyText } ; return @{Ok=$false; Resp=$parsed; HttpStatus=[int]$_.Exception.Response.StatusCode} }
            return @{Ok=$false; Resp=$_.Exception.Message; HttpStatus=0}
        }
    }

    # 1. too-low bid: 105 < 100+10
    $r1 = TryBid $HA @{requestId="edge-low-$aid"; amount=105}
    Step "bid below min rejected (BID_TOO_LOW 2002)" (-not $r1.Ok -and $r1.Resp.code -eq 2002) "http=$($r1.HttpStatus) code=$($r1.Resp.code)"

    # 2. zero amount -> VALIDATION
    $r2 = TryBid $HA @{requestId="edge-zero-$aid"; amount=0}
    Step "zero amount rejected (VALIDATION 1005)" (-not $r2.Ok -and $r2.Resp.code -eq 1005) "http=$($r2.HttpStatus) code=$($r2.Resp.code)"

    # 3. missing requestId -> VALIDATION
    $r3 = TryBid $HA @{amount=110}
    Step "missing requestId rejected (VALIDATION 1005)" (-not $r3.Ok -and $r3.Resp.code -eq 1005) "http=$($r3.HttpStatus) code=$($r3.Resp.code)"

    # 4. legal bid
    $r4 = TryBid $HA @{requestId="edge-ok-$aid"; amount=110}
    Step "legal bid accepted" ($r4.Ok -and $r4.Resp.data.currentPrice -eq 110) "price=$($r4.Resp.data.currentPrice) bidId=$($r4.Resp.data.bidId)"

    # 5. same requestId + same amount -> idempotent replay, no new row
    $r5 = TryBid $HA @{requestId="edge-ok-$aid"; amount=110}
    Step "requestId retry idempotent replay" ($r5.Ok -and $r5.Resp.data.idempotentReplay -eq $true -and $r5.Resp.data.bidId -eq $r4.Resp.data.bidId) "replay=$($r5.Resp.data.idempotentReplay) bidId=$($r5.Resp.data.bidId)"

    # 6. same requestId + different amount -> IDEMPOTENT_CONFLICT
    $r6 = TryBid $HA @{requestId="edge-ok-$aid"; amount=120}
    Step "requestId conflict rejected (2005)" (-not $r6.Ok -and $r6.Resp.code -eq 2005) "http=$($r6.HttpStatus) code=$($r6.Resp.code)"

    # 7. insufficient funds: balance 890 available, bid 5000
    $r7 = TryBid $HA @{requestId="edge-rich-$aid"; amount=5000}
    Step "insufficient funds rejected (2003)" (-not $r7.Ok -and $r7.Resp.code -eq 2003) "http=$($r7.HttpStatus) code=$($r7.Resp.code) msg=$($r7.Resp.message)"

    # DB truth: exactly 1 bid row for this auction
    $env:MYSQL_PWD="123456"
    $cnt = (& $mysql -uroot $Db -N -e "SELECT COUNT(*) FROM bids WHERE auction_id=$aid;").Trim()
    Step "DB has exactly 1 bid row" ($cnt -eq "1") "bid_count=$cnt"
    $frozen = (& $mysql -uroot $Db -N -e "SELECT frozen FROM wallets WHERE user_id=2;").Trim()
    Step "A frozen=110 for the accepted bid" ($frozen -eq "110") "frozen=$frozen"
    $env:MYSQL_PWD=$null

    # 8. settle this auction fast: set end_time (epoch ms bigint) to past, wait scanner
    $env:MYSQL_PWD="123456"
    & $mysql -uroot $Db -e "UPDATE auctions SET end_time = (UNIX_TIMESTAMP(NOW(3))*1000 - 3000) WHERE id=$aid;"
    $env:MYSQL_PWD=$null
    $settled = $false
    foreach ($i in 1..20) {
        Start-Sleep -Milliseconds 800
        $d = Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:$Port/api/v1/auctions/$aid" -Headers $H
        if ($d.data.status -eq "FINISHED") { $settled = $true; break }
    }
    Step "auction settled after forced expiry" $settled "status=FINISHED winner expected=2"

    # 9. restart backend -> scanner rescans FINISHED auction; must NOT re-deduct
    $payCount1 = (& { $env:MYSQL_PWD="123456"; (& $mysql -uroot $Db -N -e "SELECT COUNT(*) FROM wallet_ledger WHERE user_id=2 AND type='PAY' AND remark LIKE '%auction $aid';").Trim(); $env:MYSQL_PWD=$null })
    Stop-Process -Id $p.Id -Force; Start-Sleep -Milliseconds 1500
    $p2 = Start-Process -FilePath "D:\New Folder\jdk12\bin\java.exe" -ArgumentList "-cp",$cp,"com.bidarena.App" -RedirectStandardOutput "$env:TEMP\edge2.out.log" -RedirectStandardError "$env:TEMP\edge2.err.log" -NoNewWindow -PassThru
    $up2 = $false
    foreach ($i in 1..40) { Start-Sleep -Milliseconds 700; try { $h = Invoke-RestMethod "http://127.0.0.1:$Port/api/v1/health" -TimeoutSec 2; if ($h.code -eq 0 -and $h.data.status -eq "UP") { $up2=$true; break } } catch {} }
    Step "backend restarted" $up2 "pid=$($p2.Id)"
    Start-Sleep -Seconds 4  # let scanner run multiple cycles on FINISHED auction
    $env:MYSQL_PWD="123456"
    $payCount2 = (& $mysql -uroot $Db -N -e "SELECT COUNT(*) FROM wallet_ledger WHERE user_id=2 AND type='PAY' AND remark LIKE '%auction $aid';").Trim()
    $resCount = (& $mysql -uroot $Db -N -e "SELECT COUNT(*) FROM auction_results WHERE auction_id=$aid;").Trim()
    $bal = (& $mysql -uroot $Db -N -e "SELECT CONCAT(balance,'/',frozen) FROM wallets WHERE user_id=2;").Trim()
    $env:MYSQL_PWD=$null
    Step "no double settle after restart (PAY=1, result=1)" ($payCount2 -eq "1" -and $resCount -eq "1") "pay=$payCount1->$payCount2 result_rows=$resCount A=$bal"
    Stop-Process -Id $p2.Id -Force -ErrorAction SilentlyContinue
}
catch {
    Step "unexpected error" $false $_.Exception.Message
    if ($p -and -not $p.HasExited) { Stop-Process -Id $p.Id -Force }
}
$fail = @($results | Where-Object {$_.Result -eq "FAIL"}).Count
$results | Format-Table -AutoSize
Write-Host ("TOTAL={0} PASS={1} FAIL={2}" -f $results.Count, ($results.Count - $fail), $fail)
if ($fail -gt 0) { exit 1 } else { exit 0 }
