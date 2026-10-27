# READ ONLY. No key contents, signing, deploy, transfer or env changes.
$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$wasm = Join-Path $project 'contracts\custody\build\retium_perps_custody.wasm'
if (-not (Test-Path -LiteralPath $wasm)) { throw 'Custody WASM missing. Extract the complete patch first.' }
$owner = 'retef25ddec9d77f15810718a59551061df10024179bc6da4952432f236448575a88cb37'
$asset = 'c1d3885930a23a099e28e6f55f8ee8d8908902b57a7ef9d28de6756819d5611c'
$expectedHash = '5c6b3392d5f3769522befe48cb5dc53db3e633e2f3a63f29abba74433ef768a2'
$record = Invoke-RestMethod -Uri "https://rpc.retium.org/api/contract/$asset" -TimeoutSec 30
if ($record.contract_id -cne $asset -or $record.code_hash -cne $expectedHash -or $record.status -ne 'deployed') {
    throw 'Asset identity/status differs from the pinned configuration. STOP: do not deploy or approve.'
}
[pscustomobject]@{
    mode = 'READ_ONLY'
    initializer = $owner
    asset = $record.contract_id
    assetCodeHash = $record.code_hash
    assetStatus = $record.status
    localWasmSHA256 = (Get-FileHash -LiteralPath $wasm -Algorithm SHA256).Hash.ToLowerInvariant()
    localWasmBytes = (Get-Item -LiteralPath $wasm).Length
    accountCapRTD = '1'
    totalCapRTD = '10'
    onchainDeployedByThisScript = $false
} | Format-List
Write-Host 'PASS pinned asset identity only. This is not proof of official RTD, deployment success, token reply compatibility or safe live trading.'
Write-Host 'No key, signature, deployment, transfer or notification was used.'
