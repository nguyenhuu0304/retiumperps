param([string]$Root = 'D:\Projects\Retium\retium-perps')

$ErrorActionPreference = 'Stop'
$contract = Join-Path $Root 'contracts\trading-engine-onchain'
$core = Join-Path $Root 'contracts\trading-engine'
$wasm = Join-Path $contract 'target\wasm32-unknown-unknown\release\retium_perps_engine_preview.wasm'
$logs = Join-Path $Root 'logs'
New-Item -Path $logs -ItemType Directory -Force | Out-Null
$log = Join-Path $logs ("retium-perps-verify-" + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.log')
$script:failed = $false

function Log-Line([string]$line) {
    $line | Tee-Object -FilePath $log -Append
}

function Invoke-NativeChecked([string]$label, [string]$exe, [string[]]$arguments, [string]$workingDir) {
    Log-Line "`n===== $label ====="
    Push-Location $workingDir
    try {
        # Cargo writes normal progress messages to stderr. Do not turn them into terminating PowerShell errors.
        $previousPreference = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try {
            & $exe @arguments 2>&1 | ForEach-Object { $_.ToString() } | Tee-Object -FilePath $log -Append
            $code = $LASTEXITCODE
        } finally {
            $ErrorActionPreference = $previousPreference
        }
        if ($code -ne 0) {
            Log-Line "FAIL: $label (exit code $code)"
            $script:failed = $true
        } else {
            Log-Line "PASS: $label"
        }
    } catch {
        Log-Line "FAIL: $label ($($_.Exception.Message))"
        $script:failed = $true
    } finally {
        Pop-Location
    }
}

if (-not (Test-Path (Join-Path $core 'Cargo.toml'))) { throw "Missing Risk Core: $core" }
if (-not (Test-Path (Join-Path $contract 'Cargo.toml'))) { throw "Missing On-chain Contract: $contract" }

Invoke-NativeChecked 'Risk core unit tests' 'cargo' @('test') $core
Invoke-NativeChecked 'On-chain unit tests' 'cargo' @('test') $contract
Invoke-NativeChecked 'WASM Release build' 'cargo' @('build','--release','--target','wasm32-unknown-unknown') $contract

if (Test-Path $wasm) {
    Log-Line "`n===== WASM artifact ====="
    Get-Item $wasm | Select-Object FullName,Length,LastWriteTime | Format-List | Out-String | Tee-Object -FilePath $log -Append
    Get-FileHash $wasm -Algorithm SHA256 | Format-List | Out-String | Tee-Object -FilePath $log -Append
    if (Get-Command wasm-tools -ErrorAction SilentlyContinue) {
        Invoke-NativeChecked 'WASM validation' 'wasm-tools' @('validate', $wasm) $contract
        Log-Line "`n===== WASM imports / exports ====="
        $oldPreference = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try {
            $wat = (& wasm-tools print $wasm 2>&1 | ForEach-Object { $_.ToString() }) -join "`n"
            $printCode = $LASTEXITCODE
        } finally { $ErrorActionPreference = $oldPreference }
        $matches = @($wat -split "`n" | Where-Object { $_ -match '\(import |\(export "(on_use|memory)"' })
        $matches | Tee-Object -FilePath $log -Append
        if ($printCode -ne 0 -or $wat -notmatch '\(export "on_use"' -or $wat -notmatch '\(export "memory"') {
            Log-Line 'FAIL: WASM print or mandatory exports missing'
            $script:failed = $true
        } else { Log-Line 'PASS: mandatory WASM exports' }
    } else {
        Log-Line 'SKIP: wasm-tools not installed'
    }
} else {
    Log-Line 'FAIL: WASM not found'
    $script:failed = $true
}

if ($script:failed) {
    Write-Host "LOCAL CHECKS FAILED - Log: $log" -ForegroundColor Red
    exit 1
}
Write-Host "LOCAL CHECKS PASSED - Log: $log" -ForegroundColor Green
Write-Host 'Local checks only; no deploy, signing, custody changes or on-chain validation.'
