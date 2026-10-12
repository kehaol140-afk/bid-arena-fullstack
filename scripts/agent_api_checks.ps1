# Task3: Agent API end-to-end verification (real HTTP + real MySQL)
param([string]$Root = (Get-Location).Path, [string]$Db = "bid_arena_test", [int]$Port = 8190, [int]$WsPort = 8191)
$ErrorActionPreference = "Stop"
$backend = Join-Path $Root "backend"
$mysql = "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe"
$results = @()
function Step($name, $ok, $detail) {
    $script:results += [pscustomobject]@{Step=$name; Result=$(if($ok){"PASS"}else{"FAIL"}); Detail=$detail}
    Write-Host ("[{0}] {1} :: {2}" -f $(if($ok){"PASS"}else{"FAIL"}), $name, $detail)
}
function Json($o) { $o | ConvertTo-Json -Compress }
function Req($method, $uri, $headers, $body) {
    try {
        $r = Invoke-WebRequest -UseBasicParsing -Method $method -Uri $uri -Headers $headers -ContentType "application/json; charset=utf-8" -Body $body
        return @{Ok=$true; Resp=($r.Content | ConvertFrom-Json); Raw=$r.Content}
    }
    catch {
        $stream = $_.Exception.Response.GetResponseStream()
        if ($stream) { $txt = (New-Object IO.StreamReader($stream)).ReadToEnd(); try { return @{Ok=$false; Resp=($txt | ConvertFrom-Json); Raw=$txt} } catch { return @{Ok=$false; Resp=$txt; Raw=$txt} } }
        return @{Ok=$false; Resp=$_.Exception.Message; Raw=""}
    }
}
$env:BID_DB_URL = "jdbc:mysql://localhost:3306/$Db`?useSSL=false&allowPublicKeyRetrieval=true&serverTimezone=UTC"
$env:BID_DB_USER = "root"; $env:BID_DB_PASSWORD = "123456"
$cp = "$backend\target\classes;$backend\target\lib\*"
$p = Start-Process -FilePath "D:\New Folder\jdk12\bin\java.exe" -ArgumentList "-Dserver.port=$Port","-Dserver.websocket.port=$WsPort","-cp",$cp,"com.bidarena.App" -RedirectStandardOutput "$env:TEMP\agent.out.log" -RedirectStandardError "$env:TEMP\agent.err.log" -NoNewWindow -PassThru
try {
    $up=$false; foreach($i in 1..40){Start-Sleep -Milliseconds 700; try{$h=Invoke-RestMethod "http://127.0.0.1:$Port/api/v1/health" -TimeoutSec 2; if($h.code -eq 0 -and $h.data.status -eq "UP"){$up=$true;break}}catch{}}
    if(-not $up){throw "backend not up"}
    $B = "http://127.0.0.1:$Port"

    $admin = (Req Post "$B/api/v1/auth/login" @{} (Json @{email="admin@example.com";password="Admin123456!"})).Resp
    $H = @{Authorization="Bearer $($admin.data.token)"}
    $ua = (Req Post "$B/api/v1/auth/login" @{} (Json @{email="bidder_a@example.com";password="Test123456!"})).Resp
    $uidA = $ua.data.user.id
    Step "admin+user login" ($admin.code -eq 0 -and $ua.code -eq 0) "uidA=$uidA"

    # main auction (agent scope target) + aux auction (out of scope)
    $m = (Req Post "$B/api/v1/admin/auctions" $H (Json @{title="agent-main"; durationSeconds=300})).Resp
    $aid = $m.data.auctionId
    $x = (Req Post "$B/api/v1/admin/auctions" $H (Json @{title="agent-other"; durationSeconds=300})).Resp
    $xid = $x.data.auctionId
    Req Post "$B/api/v1/admin/auctions/$aid/start" $H "{}" | Out-Null
    Req Post "$B/api/v1/admin/auctions/$xid/start" $H "{}" | Out-Null
    Step "create+start main/aux auctions" ($aid -gt 0 -and $xid -gt 0) "main=$aid aux=$xid"

    # A1 issue token
    $reqA1 = Req Post "$B/api/v1/admin/agent-tokens" $H (Json @{userId=$uidA; auctionId=$aid; scopes="auction:read,auction:bid"; expiresInSeconds=600; rateLimitPerMin=600})
    $t = $reqA1.Resp
    # PS 5.1 ConvertFrom-Json 在本机对 tokenId 属性点访问返回空（token 正常）；以原始 JSON 为准提取
    $tokenId1 = [regex]::Match($reqA1.Raw, '"tokenId":(\d+)').Groups[1].Value
    $tok = [regex]::Match($reqA1.Raw, '"token":"(bat_[0-9a-f]{64})"').Groups[1].Value
    $T = @{Authorization="Bearer $tok"}
    Step "A1 issue token (bat_ prefix, plaintext once)" ($reqA1.Raw -match '"code":0' -and $tok.StartsWith("bat_") -and $tok.Length -eq 68 -and $tokenId1 -match '^\d+$') "tokenId=$tokenId1 len=$($tok.Length)"

    # A2 /agent/me
    $me = (Req Get "$B/api/v1/agent/me" $T $null).Resp
    Step "A2 GET /agent/me" ($me.code -eq 0 -and $me.data.userId -eq $uidA -and $me.data.auctionId -eq $aid) "uid=$($me.data.userId) auction=$($me.data.auctionId) scopes=$($me.data.scopes)"

    # A3 in-scope read
    $d = (Req Get "$B/api/v1/agent/auctions/$aid" $T $null).Resp
    Step "A3 in-scope auction read" ($d.code -eq 0 -and $d.data.id -eq $aid -and $d.data.status -eq "RUNNING") "status=$($d.data.status)"

    # A4 out-of-scope
    $o = Req Get "$B/api/v1/agent/auctions/$xid" $T $null
    Step "A4 out-of-scope denied 3002" ($o.Resp.code -eq 3002) "code=$($o.Resp.code)"

    # A5 read bids list
    $bl = (Req Get "$B/api/v1/agent/auctions/$aid/bids" $T $null).Resp
    Step "A5 agent bids list" ($bl.code -eq 0) "count=$(@($bl.data).Count)"

    # A6 join
    $j = (Req Post "$B/api/v1/agent/auctions/$aid/join" $T "{}").Resp
    Step "A6 agent join" ($j.code -eq 0) "joined"

    # A7 agent bid
    $frozenBefore = (Req Get "$B/api/v1/wallets/me" @{Authorization="Bearer $($ua.data.token)"} $null).Resp.data.frozen
    $bd = (Req Post "$B/api/v1/agent/auctions/$aid/bids" $T (Json @{requestId="agent-r1-$aid-$(Get-Date -Format ssfff)"; amount=150})).Resp
    Step "A7 agent bid accepted" ($bd.code -eq 0 -and $bd.data.currentPrice -ge 150) "price=$($bd.data.currentPrice)"
    $wa = (Req Get "$B/api/v1/wallets/me" @{Authorization="Bearer $($ua.data.token)"} $null).Resp
    Step "A7b agent bid froze owner wallet (+150)" ($wa.data.frozen -eq ($frozenBefore + 150)) "frozen=$($wa.data.frozen) (before=$frozenBefore)"

    # A8 read-only scope violation
    $t8 = (Req Post "$B/api/v1/admin/agent-tokens" $H (Json @{userId=$uidA; auctionId=$aid; scopes="auction:read"; expiresInSeconds=600; rateLimitPerMin=600})).Resp
    $T8 = @{Authorization="Bearer $($t8.data.token)"}
    $v = Req Post "$B/api/v1/agent/auctions/$aid/join" $T8 "{}"
    $v2 = Req Post "$B/api/v1/agent/auctions/$aid/bids" $T8 (Json @{requestId="agent-r2-$aid"; amount=200})
    Step "A8 read-only token cannot join/bid 3003" ($v.Resp.code -eq 3003 -or $v2.Resp.code -eq 3003) "join=$($v.Resp.code) bid=$($v2.Resp.code)"

    # A9 expiry
    $t9 = (Req Post "$B/api/v1/admin/agent-tokens" $H (Json @{userId=$uidA; auctionId=$aid; expiresInSeconds=2; rateLimitPerMin=600})).Resp
    $T9 = @{Authorization="Bearer $($t9.data.token)"}
    Start-Sleep -Seconds 3
    $e = Req Get "$B/api/v1/agent/me" $T9 $null
    Step "A9 expired token 401/3001" ($e.Resp.code -eq 3001) "code=$($e.Resp.code)"

    # A10 revoke
    $reqA10 = Req Post "$B/api/v1/admin/agent-tokens" $H (Json @{userId=$uidA; auctionId=$aid; expiresInSeconds=600; rateLimitPerMin=600})
    $tok10 = [regex]::Match($reqA10.Raw, '"token":"(bat_[0-9a-f]{64})"').Groups[1].Value
    $tokenId10 = [regex]::Match($reqA10.Raw, '"tokenId":(\d+)').Groups[1].Value
    $T10 = @{Authorization="Bearer $tok10"}
    $ok10 = (Req Get "$B/api/v1/agent/me" $T10 $null).Resp.code -eq 0
    $rv = (Req Post "$B/api/v1/admin/agent-tokens/$tokenId10/revoke" $H "{}").Resp
    $r10 = Req Get "$B/api/v1/agent/me" $T10 $null
    Step "A10 revoke immediate 3001" ($ok10 -and $rv.code -eq 0 -and $r10.Resp.code -eq 3001) "before=0 revoke=$($rv.code) after=$($r10.Resp.code)"

    # A11 rate limit (fixed window, limit=5)
    $t11 = (Req Post "$B/api/v1/admin/agent-tokens" $H (Json @{userId=$uidA; auctionId=$aid; expiresInSeconds=600; rateLimitPerMin=5})).Resp
    $T11 = @{Authorization="Bearer $($t11.data.token)"}
    $codes=@(); foreach($i in 1..12){ $codes += (Req Get "$B/api/v1/agent/me" $T11 $null).Resp.code }
    $c429 = @($codes | Where-Object {$_ -eq 3004}).Count
    Step "A11 rate limit 429/3004 after 5/min" ($c429 -ge 1) "codes=$($codes -join ',') 429x$c429"

    # A12 no/garbage token
    $n = Req Get "$B/api/v1/agent/me" @{} $null
    $g = Req Get "$B/api/v1/agent/me" @{Authorization="Bearer bat_deadbeef"} $null
    Step "A12 missing/garbage token 3001" ($n.Resp.code -eq 3001 -and $g.Resp.code -eq 3001) "none=$($n.Resp.code) garbage=$($g.Resp.code)"

    # A13 user session token NOT valid on agent API
    $u = Req Get "$B/api/v1/agent/me" @{Authorization="Bearer $($ua.data.token)"} $null
    Step "A13 user token rejected on agent API" ($u.Resp.code -eq 3001) "code=$($u.Resp.code)"

    # A14 DB stores sha256 hash only; prefix truncated
    $sha = [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($tok))).Replace("-","").ToLower()
    $env:MYSQL_PWD="123456"
    $row = & $mysql -uroot $Db -N -e "SELECT token_hash, token_prefix FROM agent_tokens WHERE id=$tokenId1;"
    $env:MYSQL_PWD=$null
    $parts = ($row | Select-Object -First 1) -split "`t"
    Step "A14 DB hash=sha256(plain), prefix 11 chars" ("$($parts[0])" -eq $sha -and "$($parts[1])" -eq $tok.Substring(0,11)) "hashMatch=$("$($parts[0])" -eq $sha) prefix=$($parts[1])"
    $env:MYSQL_PWD="123456"
    $leak = (& $mysql -uroot $Db -N -e "SELECT COUNT(*) FROM agent_tokens WHERE token_hash LIKE '%$tok%' OR token_prefix = '$tok';").Trim()
    $env:MYSQL_PWD=$null
    Step "A14b plaintext NOT in DB" ($leak -eq "0") "rows=$leak"
} finally {
    if ($p -and -not $p.HasExited) { Stop-Process -Id $p.Id -Force }
}
$fail = @($results | Where-Object {$_.Result -eq "FAIL"}).Count
$results | Format-Table -AutoSize | Out-String -Width 200 | Write-Host
Write-Host ("TOTAL={0} PASS={1} FAIL={2}" -f $results.Count, ($results.Count-$fail), $fail)
if ($fail -gt 0) { exit 1 } else { exit 0 }
