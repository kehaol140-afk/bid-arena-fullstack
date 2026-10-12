param(
    [string]$JavaHome = $env:JAVA_HOME,
    [string]$MavenHome = $env:MAVEN_HOME,
    [string]$MySqlExe = 'C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe',
    [string]$DbUser = 'root',
    [string]$DbPassword = $env:BID_TEST_DB_PASSWORD
)
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
if(-not $JavaHome -and (Test-Path -LiteralPath 'D:\New Folder\jdk12\bin\java.exe')) {$JavaHome='D:\New Folder\jdk12'}
if(-not $MavenHome -and (Test-Path -LiteralPath 'C:\Users\lenovo\tools\apache-maven-3.9.9\bin\mvn.cmd')) {$MavenHome='C:\Users\lenovo\tools\apache-maven-3.9.9'}
if(-not $DbPassword){$DbPassword='123456'}
if(-not (Test-Path -LiteralPath (Join-Path $JavaHome 'bin\java.exe'))) {throw 'Set JAVA_HOME to a JDK installation (not the Oracle javapath launcher).'}
$mvn=Join-Path $MavenHome 'bin\mvn.cmd'
if(-not (Test-Path -LiteralPath $mvn)){throw 'Set MAVEN_HOME or pass -MavenHome.'}
$env:JAVA_HOME=$JavaHome
$env:BID_JAVA_EXE=Join-Path $JavaHome 'bin\java.exe'
$env:BID_MYSQL_EXE=$MySqlExe
$env:BID_TEST_DB_PASSWORD=$DbPassword
$env:BID_TEST_DB_USER=$DbUser
$schema='bid_arena_codex_junit_'+(Get-Date -Format yyyyMMddHHmmss)
Push-Location $root
try {
    $env:MYSQL_PWD=$DbPassword
    & $MySqlExe "--user=$DbUser" '--host=127.0.0.1' -e "CREATE DATABASE $schema CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
    if($LASTEXITCODE -ne 0){throw 'Cannot create fresh test schema. Existing schemas were not reset.'}
    Remove-Item Env:MYSQL_PWD
    & $mvn -f backend/pom.xml "-Dbid.test.db.url=jdbc:mysql://localhost:3306/$schema`?allowPublicKeyRetrieval=true" "-Dbid.test.db.user=$DbUser" '-Dserver.port=8290' '-Dserver.websocket.port=8291' test package
    if($LASTEXITCODE -ne 0){throw 'JUnit/build failed'}
    $suites=@(Get-ChildItem backend/target/surefire-reports/TEST-*.xml | ForEach-Object {
        [xml]$testXml=Get-Content $_.FullName -Raw
        $suite=$testXml.testsuite
        [ordered]@{name=$suite.name;tests=[int]$suite.tests;failures=[int]$suite.failures;errors=[int]$suite.errors;skipped=[int]$suite.skipped;
            cases=@($suite.testcase | ForEach-Object {[ordered]@{name=$_.name;status=if($_.failure -or $_.error){'FAIL'}elseif($_.skipped){'NOT_VERIFIED'}else{'PASS'}}})}
    })
    [ordered]@{schema=$schema;realMySQL=$true;suites=$suites} | ConvertTo-Json -Depth 8 | Set-Content docs/audit-evidence/junit-summary.json -Encoding UTF8
    Push-Location frontend
    try {
        & npm.cmd run test
        if($LASTEXITCODE -ne 0){throw 'Vitest failed'}
        & npm.cmd run build
        if($LASTEXITCODE -ne 0){throw 'Frontend build failed'}
    } finally {Pop-Location}
    & node scripts/final-audit.mjs
    if($LASTEXITCODE -ne 0){throw 'HTTP/MySQL/Agent/WS audit failed'}
    & node --test scripts/audit-tools.test.mjs
    if($LASTEXITCODE -ne 0){throw 'Agent strategy or process safety regression failed'}
    & node scripts/demo-audit.mjs --seed=42
    if($LASTEXITCODE -ne 0){throw '20-user seed42 simulation failed'}
    & node scripts/demo-audit.mjs --seed=7
    if($LASTEXITCODE -ne 0){throw '20-user seed7 simulation failed'}
    & node scripts/demo-audit.mjs --browser
    if($LASTEXITCODE -ne 0){throw 'Browser E2E failed'}
    & $PSScriptRoot/check-compose.ps1
    if($LASTEXITCODE -ne 0){throw 'Compose static checks failed'}
    Write-Host "[PASS] independent audit suite finished; retained fresh JUnit schema=$schema"
} finally {Remove-Item Env:MYSQL_PWD -ErrorAction SilentlyContinue;Pop-Location}
