param([string]$Root='D:\Projects\Retium\retium-perps')
$ErrorActionPreference='Stop'
$logs=Join-Path $Root 'logs';New-Item -ItemType Directory -Force $logs|Out-Null
$stamp=Get-Date -Format 'yyyyMMdd-HHmmss';$log=Join-Path $logs "perps-v05-$stamp.log"
$passed=0;$failed=0
function Check($label,[string]$folder,[string]$exe,[string[]]$params){
 Write-Host "===== $label =====" -ForegroundColor Cyan
 "===== $label ====="|Out-File $log -Append
 $out=Join-Path $logs "v05-$stamp-out.txt";$err=Join-Path $logs "v05-$stamp-err.txt"
 try {
   $p=Start-Process -FilePath $exe -ArgumentList $params -WorkingDirectory $folder -Wait -PassThru -NoNewWindow -RedirectStandardOutput $out -RedirectStandardError $err
   Get-Content $out -ErrorAction SilentlyContinue | Tee-Object -FilePath $log -Append
   Get-Content $err -ErrorAction SilentlyContinue | Tee-Object -FilePath $log -Append
   if($p.ExitCode -ne 0){throw "Exit code $($p.ExitCode)"}
   Write-Host "PASS: $label" -ForegroundColor Green
   $script:passed++
 }catch {"FAIL: $label - $_" |Tee-Object -FilePath $log -Append;$script:failed++}
}
Check 'Risk Core Rust tests' (Join-Path $Root 'contracts\trading-engine') 'cargo' @('test')
Check 'Position Contract Rust tests' (Join-Path $Root 'contracts\trading-engine-onchain') 'cargo' @('test')
Check 'Oracle Guard Rust tests' (Join-Path $Root 'contracts\oracle-guard') 'cargo' @('test')
Check 'Retium WASM build' (Join-Path $Root 'contracts\trading-engine-onchain') 'cargo' @('build','--release','--target','wasm32-unknown-unknown')
$wasm=Join-Path $Root 'contracts\trading-engine-onchain\target\wasm32-unknown-unknown\release\retium_perps_engine_preview.wasm'
if(Test-Path $wasm){$hash=(Get-FileHash $wasm -Algorithm SHA256).Hash;"WASM SHA256: $hash"|Tee-Object -FilePath $log -Append
 if(Get-Command wasm-tools -ErrorAction SilentlyContinue){Check 'WASM validation' $Root 'wasm-tools' @('validate',$wasm);$txt=(& wasm-tools print $wasm |Out-String);if($LASTEXITCODE -eq 0 -and $txt.Contains('(export "on_use"') -and $txt.Contains('(export "memory"')){'PASS: on_use + memory exports' |Tee-Object -FilePath $log -Append;$passed++}else{'FAIL: mandatory exports'|Tee-Object -FilePath $log -Append;$failed++}}
 else{'SKIP wasm-tools not installed'|Tee-Object -FilePath $log -Append}
}else{'FAIL: WASM artifact missing'|Tee-Object -FilePath $log -Append;$failed++}
Check 'Next.js TypeScript' $Root 'npx.cmd' @('--no-install','tsc','--noEmit')
Check 'Next.js production build' $Root 'npm.cmd' @('run','build')
"SUMMARY: passed=$passed failed=$failed log=$log"|Tee-Object -FilePath $log -Append
if($failed -gt 0){Write-Host 'LOCAL CHECKS FAILED' -ForegroundColor Red;exit 1}
Write-Host "LOCAL CHECKS PASSED. Log: $log" -ForegroundColor Green
Write-Host 'No deploy, signing, keys, custody edits or live financial settlement.'
