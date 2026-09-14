[CmdletBinding()]
param(
    [string]$ProjectRoot = "",
    [switch]$PackageMode,
    [switch]$IncludeOnline,
    [switch]$IncludeMyShipReadOnlyCheck,
    [string]$ShopBaseUrl = "https://line-slipper-shop.onrender.com"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
if ([string]::IsNullOrWhiteSpace($ProjectRoot)) { $ProjectRoot = Split-Path -Parent $PSScriptRoot }
$script:checks = @()

function Add-Check {
    param(
        [string]$Name,
        [bool]$Passed,
        [string]$Detail
    )
    $script:checks += [pscustomobject]@{
        name = $Name
        status = if ($Passed) { "PASS" } else { "FAIL" }
        detail = $Detail
    }
}

function Test-JsonFile {
    param([string]$Path, [string]$Name)
    try {
        Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json | Out-Null
        Add-Check $Name $true "Valid JSON"
    } catch {
        Add-Check $Name $false $_.Exception.Message
    }
}

function Test-JsonLinesFile {
    param([string]$Path, [string]$Name)
    try {
        $lineNumber = 0
        foreach ($line in Get-Content -LiteralPath $Path -Encoding UTF8) {
            $lineNumber++
            if ([string]::IsNullOrWhiteSpace($line)) { continue }
            $line | ConvertFrom-Json | Out-Null
        }
        Add-Check $Name $true "Valid JSONL"
    } catch {
        Add-Check $Name $false ("Line {0}: {1}" -f $lineNumber, $_.Exception.Message)
    }
}

if (-not (Test-Path -LiteralPath $ProjectRoot -PathType Container)) {
    throw "Project root does not exist: $ProjectRoot"
}
$root = (Resolve-Path -LiteralPath $ProjectRoot).Path

$requiredFiles = @(
    "AGENTS.md",
    "PROGRAM.md",
    "program-manifest.json",
    "package.json",
    "package-lock.json",
    "server.js",
    "scripts\myship-sync.js",
    "public\admin-tools.js",
    "tests\myship-login-window.test.js",
    "scripts\setup.ps1",
    "scripts\run.ps1",
    "scripts\verify.ps1",
    "scripts\cleanup.ps1",
    "data\catalog.json",
    "data\store-layout.json",
    "data\mallbic-order-template.xls",
    ".env.example"
)
$missing = @($requiredFiles | Where-Object { -not (Test-Path -LiteralPath (Join-Path $root $_) -PathType Leaf) })
Add-Check "required-files" ($missing.Count -eq 0) $(if ($missing.Count) { "Missing: $($missing -join ', ')" } else { "All required files exist" })

Test-JsonFile (Join-Path $root "program-manifest.json") "program-manifest-json"
Test-JsonFile (Join-Path $root "package.json") "package-json"
Test-JsonFile (Join-Path $root "data\catalog.json") "catalog-json"
Test-JsonFile (Join-Path $root "data\store-layout.json") "store-layout-json"
Test-JsonLinesFile (Join-Path $root "known-errors.jsonl") "known-errors-jsonl"
Test-JsonLinesFile (Join-Path $root "run-history.jsonl") "run-history-jsonl"

try {
    $manifest = Get-Content -LiteralPath (Join-Path $root "program-manifest.json") -Raw -Encoding UTF8 | ConvertFrom-Json
    $identityOk = $manifest.schema -eq "codex-program-manifest/v1" -and $manifest.program_id -eq "line-slipper-first-station"
    $secondStationExcluded = @($manifest.scope.excluded) -contains "line-slipper-shop-2"
    Add-Check "program-identity" $identityOk ("program_id={0}; version={1}" -f $manifest.program_id, $manifest.version)
    Add-Check "second-station-boundary" $secondStationExcluded "Manifest explicitly excludes line-slipper-shop-2"
} catch {
    Add-Check "program-identity" $false $_.Exception.Message
    Add-Check "second-station-boundary" $false "Manifest could not be parsed"
}

$node = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $node) {
    Add-Check "node-runtime" $false "node.exe not found"
} else {
    $nodeVersionOutput = (& node.exe --version 2>&1 | Out-String).Trim()
    $nodeCode = $LASTEXITCODE
    Add-Check "node-runtime" ($nodeCode -eq 0) $nodeVersionOutput
    foreach ($relativePath in @("server.js", "scripts\myship-sync.js", "public\admin-tools.js")) {
        $output = (& node.exe --check (Join-Path $root $relativePath) 2>&1 | Out-String).Trim()
        $code = $LASTEXITCODE
        Add-Check ("node-syntax:{0}" -f $relativePath) ($code -eq 0) $(if ($code -eq 0) { "Syntax OK" } else { $output })
    }
    $testOutput = (& node.exe --test (Join-Path $root "tests\myship-login-window.test.js") 2>&1 | Out-String).Trim()
    $testCode = $LASTEXITCODE
    Add-Check "myship-login-safety-tests" ($testCode -eq 0) $(if ($testCode -eq 0) { "Login UI regression tests passed; no real browser or business API calls" } else { $testOutput })
}

if ($PackageMode) {
    $forbiddenPaths = @(
        ".env",
        ".git",
        "node_modules",
        "logs",
        ".run-state",
        "data\orders.json",
        "data\buyers.json",
        "data\chats.json",
        "data\mallbic-sync.json",
        "data\mallbic-order-sync.json",
        "data\myship-order-sync.json",
        "data\local-myship-chrome-profile",
        "data\myship-browser-profile"
    )
    $presentForbidden = @($forbiddenPaths | Where-Object { Test-Path -LiteralPath (Join-Path $root $_) })
    $profileDirs = @(Get-ChildItem -LiteralPath (Join-Path $root "data") -Directory -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -match "(?i)(chrome|browser).*profile|profile.*(chrome|browser)" })
    $presentForbidden += @($profileDirs | ForEach-Object { "data\$($_.Name)" })
    $presentForbidden = @($presentForbidden | Sort-Object -Unique)
    Add-Check "package-forbidden-paths" ($presentForbidden.Count -eq 0) $(if ($presentForbidden.Count) { "Present: $($presentForbidden -join ', ')" } else { "No secrets, runtime data, profiles, logs, dependencies, or Git internals" })
}

$haxxRoot = Join-Path $root "haxx_reference_only"
if (Test-Path -LiteralPath $haxxRoot -PathType Container) {
    $haxxFiles = @(
        "app\line_shop_admin.py",
        "app\line_myship_sync.py",
        "app\templates\line_myship_sync.html",
        "main_integration.pyfrag",
        "tool\tool.json",
        "tool\open_line_myship_sync.py"
    )
    $missingHaxx = @($haxxFiles | Where-Object { -not (Test-Path -LiteralPath (Join-Path $haxxRoot $_) -PathType Leaf) })
    Add-Check "haxx-reference-files" ($missingHaxx.Count -eq 0) $(if ($missingHaxx.Count) { "Missing: $($missingHaxx -join ', ')" } else { "HAXX first-station reference is complete" })
    Test-JsonFile (Join-Path $haxxRoot "tool\tool.json") "haxx-tool-json"

    $python = Get-Command python.exe -ErrorAction SilentlyContinue
    if (-not $python) {
        Add-Check "haxx-python-ast" $false "python.exe not found"
    } else {
        $pythonFiles = @(
            "app\line_shop_admin.py",
            "app\line_myship_sync.py",
            "tool\open_line_myship_sync.py"
        )
        $astFailures = @()
        foreach ($relativePath in $pythonFiles) {
            $fullPath = Join-Path $haxxRoot $relativePath
            $output = (& python.exe -c "import ast,pathlib,sys; ast.parse(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'))" $fullPath 2>&1 | Out-String).Trim()
            if ($LASTEXITCODE -ne 0) { $astFailures += "${relativePath}: $output" }
        }
        Add-Check "haxx-python-ast" ($astFailures.Count -eq 0) $(if ($astFailures.Count) { $astFailures -join " | " } else { "Python source parses without execution" })
    }
}

$hashManifestPath = Join-Path $root "FILES.sha256"
if (Test-Path -LiteralPath $hashManifestPath -PathType Leaf) {
    $hashFailures = @()
    $listedFiles = @()
    foreach ($line in Get-Content -LiteralPath $hashManifestPath -Encoding UTF8) {
        if ([string]::IsNullOrWhiteSpace($line)) { continue }
        if ($line -notmatch "^([A-Fa-f0-9]{64})\s+\*(.+)$") {
            $hashFailures += "Malformed line: $line"
            continue
        }
        $expected = $Matches[1].ToUpperInvariant()
        $relativePath = $Matches[2]
        $listedFiles += $relativePath.Replace("/", "\")
        $fullPath = Join-Path $root $relativePath.Replace("/", "\")
        if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
            $hashFailures += "Missing: $relativePath"
            continue
        }
        $actual = (Get-FileHash -LiteralPath $fullPath -Algorithm SHA256).Hash
        if ($actual -ne $expected) { $hashFailures += "Hash mismatch: $relativePath" }
    }
    if ($PackageMode) {
        $actualFiles = @(Get-ChildItem -LiteralPath $root -File -Recurse -Force | ForEach-Object { $_.FullName.Substring($root.Length).TrimStart("\", "/") } | Where-Object { $_ -ne "FILES.sha256" })
        $unlisted = @($actualFiles | Where-Object { $listedFiles -notcontains $_ })
        if ($unlisted.Count) { $hashFailures += "Unlisted files: $($unlisted -join ', ')" }
    }
    Add-Check "files-sha256" ($hashFailures.Count -eq 0) $(if ($hashFailures.Count) { $hashFailures -join " | " } else { "All listed files match and no extra files exist" })
} elseif ($PackageMode) {
    Add-Check "files-sha256" $false "FILES.sha256 is required in package mode"
}

if ($IncludeOnline) {
    foreach ($relativeUrl in @("/", "/api/config")) {
        $url = $ShopBaseUrl.TrimEnd("/") + $relativeUrl
        try {
            $response = Invoke-WebRequest -Uri $url -Method Get -UseBasicParsing -TimeoutSec 30
            Add-Check ("online:{0}" -f $relativeUrl) ($response.StatusCode -eq 200) ("HTTP {0}" -f $response.StatusCode)
        } catch {
            Add-Check ("online:{0}" -f $relativeUrl) $false $_.Exception.Message
        }
    }
}

if ($IncludeMyShipReadOnlyCheck) {
    if (-not (Test-Path -LiteralPath (Join-Path $root ".env") -PathType Leaf)) {
        Add-Check "myship-read-only-check" $false ".env is missing"
    } else {
        Push-Location $root
        try {
            $output = (& npm.cmd run myship-sync -- --check 2>&1 | Out-String).Trim()
            $code = $LASTEXITCODE
            Add-Check "myship-read-only-check" ($code -eq 0) $(if ($code -eq 0) { ($output -split "`r?`n" | Select-Object -Last 1) } else { $output })
        } finally {
            Pop-Location
        }
    }
}

$failed = @($script:checks | Where-Object { $_.status -eq "FAIL" })
$summary = [ordered]@{
    schema = "line-first-verification/v1"
    program_id = "line-slipper-first-station"
    verified_at = (Get-Date).ToUniversalTime().ToString("o")
    project_root = $root
    package_mode = [bool]$PackageMode
    online_checks_requested = [bool]$IncludeOnline
    myship_read_only_check_requested = [bool]$IncludeMyShipReadOnlyCheck
    status = if ($failed.Count -eq 0) { "PASS" } else { "FAIL" }
    checks = $script:checks
}
$summary | ConvertTo-Json -Depth 8
if ($failed.Count -gt 0) { exit 1 }
