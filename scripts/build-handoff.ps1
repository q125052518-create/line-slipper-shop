[CmdletBinding()]
param(
    [string]$ProjectRoot = "",
    [Parameter(Mandatory = $true)]
    [string]$HaxxRoot,
    [Parameter(Mandatory = $true)]
    [string]$HaxxToolRoot,
    [string]$OutputRoot = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$utf8NoBom = [Text.UTF8Encoding]::new($false)
if ([string]::IsNullOrWhiteSpace($ProjectRoot)) { $ProjectRoot = Split-Path -Parent $PSScriptRoot }

function Resolve-RequiredDirectory {
    param([string]$Path, [string]$Name)
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) { throw "$Name does not exist: $Path" }
    return (Resolve-Path -LiteralPath $Path).Path
}

function Copy-SafeFile {
    param([string]$SourceRoot, [string]$RelativePath, [string]$DestinationRoot)
    $sourcePath = Join-Path $SourceRoot $RelativePath
    if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) { throw "Required source file is missing: $sourcePath" }
    $sourceItem = Get-Item -LiteralPath $sourcePath -Force
    if ($sourceItem.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Reparse-point files are not allowed: $sourcePath" }
    $destinationPath = Join-Path $DestinationRoot $RelativePath
    $destinationParent = Split-Path -Parent $destinationPath
    New-Item -ItemType Directory -Path $destinationParent -Force | Out-Null
    Copy-Item -LiteralPath $sourcePath -Destination $destinationPath
}

function Write-Utf8NoBom {
    param([string]$Path, [string]$Text)
    $parent = Split-Path -Parent $Path
    if ($parent) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
    [IO.File]::WriteAllText($Path, $Text, $utf8NoBom)
}

$root = Resolve-RequiredDirectory $ProjectRoot "Project root"
$haxx = Resolve-RequiredDirectory $HaxxRoot "HAXX root"
$haxxTool = Resolve-RequiredDirectory $HaxxToolRoot "HAXX first-station tool root"
if ([string]::IsNullOrWhiteSpace($OutputRoot)) { $OutputRoot = Join-Path $root "handoff-releases" }
$output = [IO.Path]::GetFullPath($OutputRoot)

$manifest = Get-Content -LiteralPath (Join-Path $root "program-manifest.json") -Raw -Encoding UTF8 | ConvertFrom-Json
if ($manifest.program_id -ne "line-slipper-first-station") { throw "Project manifest is not the first-station program." }
$releaseName = "line-slipper-first-station-{0}" -f $manifest.version
$staging = Join-Path $output $releaseName
$zipPath = Join-Path $output ("{0}.zip" -f $releaseName)
if (Test-Path -LiteralPath $staging) { throw "Immutable release directory already exists: $staging" }
if (Test-Path -LiteralPath $zipPath) { throw "Immutable release archive already exists: $zipPath" }
New-Item -ItemType Directory -Path $staging -Force | Out-Null

$rootFiles = @(
    ".env.example",
    ".gitignore",
    "AGENTS.md",
    "DEPLOYMENT.md",
    "PROGRAM.md",
    "README.md",
    "known-errors.jsonl",
    "package-lock.json",
    "package.json",
    "program-manifest.json",
    "render.yaml",
    "run-history.jsonl",
    "server.js",
    "install-myship-sync-task.bat",
    "start-myship-sync.bat",
    "data\catalog.json",
    "data\mallbic-order-template.xls",
    "data\store-layout.json",
    "scripts\build-handoff.ps1",
    "scripts\cleanup.ps1",
    "scripts\myship-sync.js",
    "scripts\run.ps1",
    "scripts\setup.ps1",
    "scripts\verify.ps1",
    "tests\myship-login-window.test.js"
)
$publicFiles = @(& git -C $root ls-files "public/*")
if ($LASTEXITCODE -ne 0 -or $publicFiles.Count -eq 0) { throw "Unable to enumerate tracked public files." }
foreach ($relativePath in @($rootFiles + $publicFiles | Sort-Object -Unique)) {
    Copy-SafeFile $root $relativePath $staging
}

$haxxFiles = @(
    "app\line_shop_admin.py",
    "app\line_myship_sync.py",
    "app\templates\line_myship_sync.html",
    "tests\test_line_myship_status_performance.py",
    "tests\test_proxy_performance.py",
    "tests\test_line_myship_login_safety.py"
)
$haxxDestination = Join-Path $staging "haxx_reference_only"
foreach ($relativePath in $haxxFiles) { Copy-SafeFile $haxx $relativePath $haxxDestination }
Copy-SafeFile $haxxTool "tool.json" (Join-Path $haxxDestination "tool")
Copy-SafeFile $haxxTool "open_line_myship_sync.py" (Join-Path $haxxDestination "tool")

$mainPath = Join-Path $haxx "app\main.py"
$mainText = Get-Content -LiteralPath $mainPath -Raw -Encoding UTF8
$importMatch = [regex]::Match($mainText, "from \.line_myship_sync import \([\s\S]*?from \.line_shop_admin[^\r\n]*")
$constantMatch = [regex]::Match($mainText, "(?m)^LINE_MYSHIP_SYNC_TOOL_ID\s*=\s*[^\r\n]+")
$warmMatch = [regex]::Match($mainText, "(?m)^\s*warm_line_myship_status_cache\(\)\s*$")
$routeMatch = [regex]::Match($mainText, '@app\.get\("/apps/line-myship-sync"\)[\s\S]*?(?=@app\.get\("/api/admin/system"\))')
if (-not ($importMatch.Success -and $constantMatch.Success -and $warmMatch.Success -and $routeMatch.Success)) {
    throw "Could not extract the current HAXX first-station integration blocks from app/main.py."
}
$fragment = @"
# Reference-only fragments extracted from the verified current HAXX app/main.py.
# Merge into the target HAXX app; never replace its whole main.py.

# IMPORTS
$($importMatch.Value)

# CONSTANT
$($constantMatch.Value)

# STARTUP WARM-UP CALL (inside the existing HAXX startup function)
$($warmMatch.Value.Trim())

# ROUTES
$($routeMatch.Value.Trim())
"@
Write-Utf8NoBom (Join-Path $haxxDestination "main_integration.pyfrag") $fragment

$haxxReadme = @"
# HAXX first-station reference

This directory is a scoped, verified reference for `rt_line_myship_sync` only.

1. Do not replace the target HAXX `app/main.py`.
2. Copy or merge the two Python modules, one HTML template, tests, and tool definition into the target HAXX tree.
3. Merge `main_integration.pyfrag` into the target HAXX `main.py` while preserving all unrelated tools and authentication logic.
4. Set `LINE_MYSHIP_REPO_ROOT` to the target computer's extracted first-station project root.
5. Keep secrets in the target HAXX environment. Do not copy `.env`, cookies, sessions, or browser profiles from the source computer.
6. Run `python -m unittest tests.test_line_myship_status_performance tests.test_proxy_performance tests.test_line_myship_login_safety -v`, then verify authenticated proxy, permission denial, status, start, and run-once routes before enabling use. The source HAXX venv does not include pytest. The login-page action must not start the worker; a logged-in browser page alone does not prove worker connectivity.
7. The `start` and `run-once` routes may trigger the local MyShip worker. Do not call them merely to test page rendering.

The source and live HAXX copies were hash-compared before this release. `HAXX-SOURCE-STATE.json` records the exact snapshot hashes.
"@
Write-Utf8NoBom (Join-Path $haxxDestination "README.md") $haxxReadme

$sourceState = [ordered]@{
    schema = "line-first-source-state/v1"
    captured_at = (Get-Date).ToUniversalTime().ToString("o")
    source_computer = $env:COMPUTERNAME
    program_id = $manifest.program_id
    version = $manifest.version
    project_source_path = $root
    git_branch = (& git -C $root branch --show-current)
    git_head = (& git -C $root rev-parse HEAD)
    git_status = @(& git -C $root status --short --untracked-files=all)
    snapshot_mode = "working-tree"
}
Write-Utf8NoBom (Join-Path $staging "SOURCE-STATE.json") ($sourceState | ConvertTo-Json -Depth 6)

$haxxStateFiles = foreach ($relativePath in @("app\main.py") + $haxxFiles) {
    $fullPath = Join-Path $haxx $relativePath
    [ordered]@{
        path = $relativePath.Replace("\", "/")
        bytes = (Get-Item -LiteralPath $fullPath).Length
        sha256 = (Get-FileHash -LiteralPath $fullPath -Algorithm SHA256).Hash
    }
}
$haxxState = [ordered]@{
    schema = "line-first-haxx-source-state/v1"
    captured_at = (Get-Date).ToUniversalTime().ToString("o")
    source_path = $haxx
    tool_source_path = $haxxTool
    tool_id = "rt_line_myship_sync"
    files = $haxxStateFiles
}
Write-Utf8NoBom (Join-Path $haxxDestination "HAXX-SOURCE-STATE.json") ($haxxState | ConvertTo-Json -Depth 7)

$exclusions = @"
# Release exclusions

The following are intentionally absent and must never be reconstructed from cloud memory:

- `.env` and every real credential, token, cookie, session, MFA value, private key, or credential-store record
- `node_modules`, `.git`, logs, caches, screenshots, crash dumps, run roots, locks, and temporary files
- buyer, order, chat, MallBic sync, MyShip sync, claim/result, and other live business records
- every Chrome/Playwright profile and login state
- the second-station project `line-slipper-shop-2`, its data, tools, jobs, and authentication state
- unrelated HAXX modules, users, permissions, jobs, history, and server configuration

A target computer must supply its own official logins and environment-specific configuration.
"@
Write-Utf8NoBom (Join-Path $staging "EXCLUSIONS.md") $exclusions

$releaseManifest = [ordered]@{
    schema = "codex-program-handoff-release/v1"
    release_id = $releaseName
    program_id = $manifest.program_id
    canonical_name = $manifest.canonical_name
    version = $manifest.version
    generated_at = (Get-Date).ToUniversalTime().ToString("o")
    source_computer = $env:COMPUTERNAME
    archive_format = "zip"
    integrity_manifest = "FILES.sha256"
    source_state = "SOURCE-STATE.json"
    exclusions = "EXCLUSIONS.md"
    haxx_reference = "haxx_reference_only"
    target_install_entry = "scripts/setup.ps1"
    target_verify_entry = "scripts/verify.ps1 -PackageMode"
    authentication_transfer = "forbidden"
    business_data_transfer = "forbidden"
}
Write-Utf8NoBom (Join-Path $staging "RELEASE-MANIFEST.json") ($releaseManifest | ConvertTo-Json -Depth 7)

$files = @(Get-ChildItem -LiteralPath $staging -File -Recurse -Force | Sort-Object FullName)
$hashLines = foreach ($file in $files) {
    $relativePath = $file.FullName.Substring($staging.Length).TrimStart("\", "/").Replace("\", "/")
    "{0} *{1}" -f (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash, $relativePath
}
[IO.File]::WriteAllLines((Join-Path $staging "FILES.sha256"), $hashLines, $utf8NoBom)

$verifyProcess = Start-Process -FilePath (Get-Command powershell.exe -ErrorAction Stop).Source -ArgumentList @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", (Join-Path $staging "scripts\verify.ps1"),
    "-ProjectRoot", $staging,
    "-PackageMode"
) -WorkingDirectory $staging -WindowStyle Hidden -Wait -PassThru
if ($verifyProcess.ExitCode -ne 0) { throw "Staged package verification failed with exit code $($verifyProcess.ExitCode)." }

$partialZipPath = $zipPath.Substring(0, $zipPath.Length - 4) + ".partial.zip"
if (Test-Path -LiteralPath $partialZipPath) { throw "Partial archive path already exists: $partialZipPath" }
$archiveCreated = $false
for ($attempt = 1; $attempt -le 3; $attempt++) {
    try {
        Start-Sleep -Milliseconds (250 * $attempt)
        Compress-Archive -LiteralPath $staging -DestinationPath $partialZipPath -CompressionLevel Optimal
        $archiveCreated = $true
        break
    } catch {
        if (Test-Path -LiteralPath $partialZipPath) { Remove-Item -LiteralPath $partialZipPath -Force }
        if ($attempt -eq 3) { throw }
    }
}
if (-not $archiveCreated) { throw "Archive creation did not reach a terminal result." }
Move-Item -LiteralPath $partialZipPath -Destination $zipPath
$zipItem = Get-Item -LiteralPath $zipPath
$result = [ordered]@{
    schema = "line-first-handoff-build-result/v1"
    status = "PASS"
    release_id = $releaseName
    version = $manifest.version
    source_computer = $env:COMPUTERNAME
    staging_directory = $staging
    archive_path = $zipPath
    archive_bytes = $zipItem.Length
    archive_sha256 = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash
    hashed_file_count = $hashLines.Count
    package_verification = "PASS"
}
$result | ConvertTo-Json -Depth 6
