param([string]$RunLog='logs/codex-test-all-final.log')
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
    $suites=@(Get-ChildItem backend/target/surefire-reports/TEST-*.xml | ForEach-Object {
        [xml]$testXml=Get-Content $_.FullName -Raw
        $suite=$testXml.testsuite
        [ordered]@{name=$suite.name;tests=[int]$suite.tests;failures=[int]$suite.failures;errors=[int]$suite.errors;skipped=[int]$suite.skipped;
            cases=@($suite.testcase | ForEach-Object {[ordered]@{name=$_.name;status=if($_.failure -or $_.error){'FAIL'}elseif($_.skipped){'NOT_VERIFIED'}else{'PASS'}}})}
    })
    $logText=Get-Content $RunLog -Raw
    $schema=[regex]::Match($logText,'retained fresh JUnit schema=(\w+)').Groups[1].Value
    $frontCount=[regex]::Match($logText,'Tests\s+(\d+) passed').Groups[1].Value
    $toolsCount=[regex]::Match($logText,'# pass (\d+)').Groups[1].Value
    $allPass=$logText.Contains('[PASS] independent audit suite finished')
    $staticPass=(Get-Content logs/codex-compose-static.log | Select-String '^\[PASS\]').Count
    [ordered]@{date=(Get-Date -Format o);junitSchemas=@($schema);realMySQL=$true;suites=$suites;
        frontendPassed=$frontCount;toolsUnitTestsPassed=$toolsCount;toolsEvidence='node --test scripts/audit-tools.test.mjs';
        oneCommandStatus=if($allPass){'PASS'}else{'FAIL'};oneCommandLog=$RunLog;
        composeStaticPassed=$staticPass;dockerRuntime='NOT_VERIFIED';java17Runtime='NOT_VERIFIED'} |
        ConvertTo-Json -Depth 8 | Set-Content docs/audit-evidence/suite-summary.json -Encoding UTF8
} finally {Pop-Location}
