[CmdletBinding()]
param(
    [ValidateSet("Server", "MyShipCheck", "MyShipOnce", "MyShipWorker")]
    [string]$Mode = "Server",
    [string]$ProjectRoot = "",
    [switch]$Background,
    [switch]$AllowDevelopmentDefaults,
    [switch]$AllowOrderCreation
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
if ([string]::IsNullOrWhiteSpace($ProjectRoot)) { $ProjectRoot = Split-Path -Parent $PSScriptRoot }

if (-not (Test-Path -LiteralPath $ProjectRoot -PathType Container)) {
    throw "Project root does not exist: $ProjectRoot"
}
$root = (Resolve-Path -LiteralPath $ProjectRoot).Path

$manifest = Get-Content -LiteralPath (Join-Path $root "program-manifest.json") -Raw -Encoding UTF8 | ConvertFrom-Json
if ($manifest.program_id -ne "line-slipper-first-station") {
    throw "Refusing to run a directory that is not the first-station program."
}

if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
    throw "npm.cmd was not found. Run scripts/setup.ps1 first."
}
if (-not (Test-Path -LiteralPath (Join-Path $root "node_modules") -PathType Container)) {
    throw "node_modules is missing. Run scripts/setup.ps1 first."
}

$requiresEnvironment = $Mode -ne "Server" -or -not $AllowDevelopmentDefaults
if ($requiresEnvironment -and -not (Test-Path -LiteralPath (Join-Path $root ".env") -PathType Leaf)) {
    throw ".env is required for this mode. Create it locally from .env.example and fill target-machine values."
}

if ($Mode -in @("MyShipOnce", "MyShipWorker") -and -not $AllowOrderCreation) {
    throw "$Mode can create external MyShip orders. Re-run only after explicit authorization and add -AllowOrderCreation."
}

$commandArgs = switch ($Mode) {
    "Server" { @("start") }
    "MyShipCheck" { @("run", "myship-sync", "--", "--check") }
    "MyShipOnce" { @("run", "myship-sync", "--", "--once") }
    "MyShipWorker" { @("run", "myship-sync") }
}

if (-not $Background) {
    Push-Location $root
    try {
        & npm.cmd @commandArgs
        exit $LASTEXITCODE
    } finally {
        Pop-Location
    }
}

$stateDir = Join-Path $root ".run-state"
$logDir = Join-Path $root "logs"
New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$statePath = Join-Path $stateDir ("{0}.json" -f $Mode.ToLowerInvariant())
if (Test-Path -LiteralPath $statePath) {
    $existing = Get-Content -LiteralPath $statePath -Raw -Encoding UTF8 | ConvertFrom-Json
    if (Get-Process -Id ([int]$existing.pid) -ErrorAction SilentlyContinue) {
        throw "A registered $Mode process is already running with PID $($existing.pid)."
    }
    Remove-Item -LiteralPath $statePath -Force
}

$logPath = Join-Path $logDir ("{0}-{1}.log" -f $Mode.ToLowerInvariant(), (Get-Date -Format "yyyyMMdd-HHmmss"))
$quotedArgs = $commandArgs | ForEach-Object { "'" + $_.Replace("'", "''") + "'" }
$escapedRoot = $root.Replace("'", "''")
$escapedLog = $logPath.Replace("'", "''")
$childCommand = "Set-Location -LiteralPath '$escapedRoot'; & npm.cmd $($quotedArgs -join ' ') *>> '$escapedLog'; exit `$LASTEXITCODE"
$encodedCommand = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($childCommand))
$powershellPath = (Get-Command powershell.exe -ErrorAction Stop).Source
$process = Start-Process -FilePath $powershellPath -ArgumentList @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-EncodedCommand", $encodedCommand
) -WorkingDirectory $root -WindowStyle Hidden -PassThru

Start-Sleep -Milliseconds 300
$process.Refresh()
if ($process.HasExited) {
    throw "The background $Mode process exited immediately with code $($process.ExitCode). See $logPath"
}

$state = [ordered]@{
    schema = "line-first-run-state/v1"
    program_id = "line-slipper-first-station"
    mode = $Mode
    pid = $process.Id
    process_name = $process.ProcessName
    process_started_at = $process.StartTime.ToUniversalTime().ToString("o")
    registered_at = (Get-Date).ToUniversalTime().ToString("o")
    project_root = $root
    log_path = $logPath
    external_order_creation_allowed = [bool]$AllowOrderCreation
}
[IO.File]::WriteAllText($statePath, ($state | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))
$state | ConvertTo-Json -Depth 5
