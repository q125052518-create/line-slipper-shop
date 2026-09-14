[CmdletBinding()]
param(
    [string]$ProjectRoot = "",
    [switch]$SkipDependencyInstall,
    [switch]$SkipBrowserInstall,
    [switch]$InitializeEnvironment
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
if ([string]::IsNullOrWhiteSpace($ProjectRoot)) { $ProjectRoot = Split-Path -Parent $PSScriptRoot }

function Resolve-ProjectRoot {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
        throw "Project root does not exist: $Path"
    }
    return (Resolve-Path -LiteralPath $Path).Path
}

function Assert-CommandSucceeded {
    param([string]$Name)
    if ($LASTEXITCODE -ne 0) {
        throw "$Name failed with exit code $LASTEXITCODE"
    }
}

$root = Resolve-ProjectRoot $ProjectRoot
if ($env:OS -ne "Windows_NT") {
    throw "This handoff package is validated for Windows only."
}

$requiredFiles = @(
    "program-manifest.json",
    "package.json",
    "package-lock.json",
    "server.js",
    "scripts\myship-sync.js",
    "data\catalog.json",
    "data\store-layout.json",
    "data\mallbic-order-template.xls"
)
foreach ($relativePath in $requiredFiles) {
    $fullPath = Join-Path $root $relativePath
    if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
        throw "Required file is missing: $relativePath"
    }
}

$manifest = Get-Content -LiteralPath (Join-Path $root "program-manifest.json") -Raw -Encoding UTF8 | ConvertFrom-Json
if ($manifest.schema -ne "codex-program-manifest/v1" -or $manifest.program_id -ne "line-slipper-first-station") {
    throw "program-manifest.json does not identify the first-station program."
}

$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
$npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $nodeCommand) { throw "Node.js is required. Install Node.js 20 or newer before setup." }
if (-not $npmCommand) { throw "npm.cmd is required and was not found on PATH." }

$nodeText = (& node.exe --version).Trim().TrimStart("v")
Assert-CommandSucceeded "node --version"
$nodeCore = $nodeText.Split("-")[0]
$nodeVersion = [Version]$nodeCore
if ($nodeVersion -lt [Version]"20.0.0") {
    throw "Node.js 20 or newer is required. Found: $nodeVersion"
}

foreach ($jsonFile in @("data\catalog.json", "data\store-layout.json")) {
    Get-Content -LiteralPath (Join-Path $root $jsonFile) -Raw -Encoding UTF8 | ConvertFrom-Json | Out-Null
}

$envPath = Join-Path $root ".env"
if ($InitializeEnvironment) {
    if (Test-Path -LiteralPath $envPath) {
        throw ".env already exists. Setup will not overwrite it."
    }
    Copy-Item -LiteralPath (Join-Path $root ".env.example") -Destination $envPath
}

if (-not $SkipDependencyInstall) {
    Push-Location $root
    try {
        if ($SkipBrowserInstall) {
            & npm.cmd ci --ignore-scripts
            Assert-CommandSucceeded "npm.cmd ci --ignore-scripts"
        } else {
            & npm.cmd ci
            Assert-CommandSucceeded "npm.cmd ci"
        }
    } finally {
        Pop-Location
    }
}

$result = [ordered]@{
    schema = "line-first-setup-result/v1"
    status = "PASS"
    program_id = $manifest.program_id
    version = $manifest.version
    project_root = $root
    node_version = $nodeVersion.ToString()
    dependencies_installed = -not $SkipDependencyInstall
    playwright_browser_install_skipped = [bool]$SkipBrowserInstall
    environment_template_initialized = [bool]$InitializeEnvironment
    next_step = "Fill target-machine secrets in .env, then run scripts/verify.ps1."
}
$result | ConvertTo-Json -Depth 5
