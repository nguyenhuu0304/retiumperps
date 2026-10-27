param([string]$Root = "D:\Projects\Retium\retium-perps")
$ErrorActionPreference = 'Stop'
$logdir = Join-Path $Root 'logs'
New-Item -ItemType Directory -Force $logdir | Out-Null
$log = Join-Path $logdir ("perps-v04-" + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.log')
$script:failed = $false
function Run-Step([string]$name,[string]$dir,[string]$exe,[string[]]$arguments) {
  Write-Host "===== $name =====" -ForegroundColor Cyan
  Add-Content -Path $log -Value "`n===== $name ====="
  if (-not (Test-Path $dir)) { Write-Host "FAIL: Directory missing $dir"; $script:failed=$true; return }
  $stdout=Join-Path $logdir 'perps-v04.stdout.tmp'
  $stderr=Join-Path $logdir 'perps-v04.stderr.tmp'
  try {
    $proc=Start-Process -FilePath $exe -ArgumentList $arguments -WorkingDirectory $dir -PassThru -Wait -NoNewWindow -RedirectStandardOutput $stdout -RedirectStandardError $stderr
    foreach($p in @($stdout,$stderr)) { if(Test-Path $p) { Get-Content $p | Tee-Object -FilePath $log -Append } }
    if($proc.ExitCode -ne 0) { $script:failed=$true; Write-Host "FAIL: $name (exit $($proc.ExitCode))" -ForegroundColor Red }
    else { Write-Host "PASS: $name" -ForegroundColor Green; Add-Content $log "PASS: $name" }
  } catch { $script:failed=$true; Write-Host "FAIL: $name $_" -ForegroundColor Red; Add-Content $log "FAIL: $name $_" }
  finally { Remove-Item $stdout,$stderr -ErrorAction SilentlyContinue }
}
$core=Join-Path $Root 'contracts\trading-engine'
$contract=Join-Path $Root 'contracts\trading-engine-onchain'
$oracle=Join-Path $Root 'contracts\oracle-guard'
Run-Step 'Rust risk core tests' $core 'cargo' @('test','--locked')
Run-Step 'Rust contract tests' $contract 'cargo' @('test','--locked')
Run-Step 'Oracle guard tests' $oracle 'cargo' @('test')
Run-Step 'Oracle guard WASM check' $oracle 'cargo' @('check','--target','wasm32-unknown-unknown')
Run-Step 'Trading contract WASM build' $contract 'cargo' @('build','--release','--target','wasm32-unknown-unknown','--locked')
$wasm=Join-Path $contract 'target\wasm32-unknown-unknown\release\retium_perps_engine_preview.wasm'
if(Test-Path $wasm) {
  Get-Item $wasm | Select-Object FullName,Length,LastWriteTime | Format-List | Out-String | Tee-Object -FilePath $log -Append
  Get-FileHash $wasm -Algorithm SHA256 | Format-List | Out-String | Tee-Object -FilePath $log -Append
  if(Get-Command wasm-tools -ErrorAction SilentlyContinue) {
    Run-Step 'WASM structure validation' $contract 'wasm-tools' @('validate',$wasm)
    $wat = & wasm-tools print $wasm | Select-String 'export "memory"|export "on_use"|import "env"'
    $wat | Out-String | Tee-Object -FilePath $log -Append
    if(-not ($wat -match 'export "memory"') -or -not ($wat -match 'export "on_use"')) { $script:failed=$true; Write-Host 'FAIL: required WASM exports missing' }
  } else { Write-Host 'SKIP: wasm-tools missing' -ForegroundColor Yellow }
} else { $script:failed=$true; Write-Host 'FAIL: WASM artifact missing' -ForegroundColor Red }
$npm=Join-Path $Root 'node_modules'
if(Test-Path $npm) { Run-Step 'Next.js type check' $Root 'npx.cmd' @('tsc','--noEmit') }
else { Write-Host 'SKIP: Next.js type check (node_modules missing)' -ForegroundColor Yellow }
Write-Host "Log: $log"
if($script:failed) { Write-Host 'LOCAL VERIFICATION FAILED' -ForegroundColor Red; exit 1 }
Write-Host 'LOCAL VERIFICATION PASSED (no chain execution, no RTD movements)' -ForegroundColor Green
