# Stop local Bid Arena backend java process (matched by class name com.bidarena.App)
$procs = Get-CimInstance Win32_Process -Filter "Name='java.exe'" | Where-Object {
  $_.CommandLine -match "com\.bidarena\.App"
}
if (-not $procs) { Write-Host "[stop-backend] no running backend process"; exit 0 }
foreach ($p in $procs) {
  Stop-Process -Id $p.ProcessId -Force
  Write-Host "[stop-backend] stopped PID=$($p.ProcessId)"
}
