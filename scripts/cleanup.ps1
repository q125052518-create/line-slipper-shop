[CmdletBinding()]
param(
    [string]$ProjectRoot = "",
    [switch]$RemoveTemporaryFiles
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
if ([string]::IsNullOrWhiteSpace($ProjectRoot)) { $ProjectRoot = Split-Path -Parent $PSScriptRoot }

if (-not (Test-Path -LiteralPath $ProjectRoot -PathType Container)) {
    throw "Project root does not exist: $ProjectRoot"
}
$root = (Resolve-Path -LiteralPath $ProjectRoot).Path
$stateDir = Join-Path $root ".run-state"
$results = @()

if (Test-Path -LiteralPath $stateDir -PathType Container) {
    $allProcesses = @(Get-CimInstance Win32_Process)
    foreach ($stateFile in Get-ChildItem -LiteralPath $stateDir -Filter "*.json" -File) {
        try {
            $state = Get-Content -LiteralPath $stateFile.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($state.schema -ne "line-first-run-state/v1" -or $state.program_id -ne "line-slipper-first-station") {
                throw "Unrecognized run-state schema"
            }
            if ([IO.Path]::GetFullPath([string]$state.project_root) -ne $root) {
                throw "Run-state project root does not match this project"
            }

            $rootProcess = $allProcesses | Where-Object { $_.ProcessId -eq [int]$state.pid } | Select-Object -First 1
            if (-not $rootProcess) {
                Remove-Item -LiteralPath $stateFile.FullName -Force
                $results += [pscustomobject]@{ mode = $state.mode; status = "already-stopped"; pid = [int]$state.pid }
                continue
            }

            $expectedStartedAt = [DateTimeOffset]::Parse([string]$state.process_started_at).UtcDateTime
            $creationValue = $rootProcess.CreationDate
            if ($creationValue -is [DateTime]) {
                $actualStartedAt = $creationValue.ToUniversalTime()
            } elseif ($creationValue -is [DateTimeOffset]) {
                $actualStartedAt = $creationValue.UtcDateTime
            } else {
                $actualStartedAt = [Management.ManagementDateTimeConverter]::ToDateTime([string]$creationValue).ToUniversalTime()
            }
            if ([Math]::Abs(($actualStartedAt - $expectedStartedAt).TotalSeconds) -gt 5) {
                throw "PID was reused; creation time does not match the ledger"
            }

            $tree = New-Object System.Collections.Generic.List[int]
            $tree.Add([int]$state.pid)
            for ($index = 0; $index -lt $tree.Count; $index++) {
                $parentId = $tree[$index]
                foreach ($child in $allProcesses | Where-Object { $_.ParentProcessId -eq $parentId }) {
                    if (-not $tree.Contains([int]$child.ProcessId)) { $tree.Add([int]$child.ProcessId) }
                }
            }
            $orderedIds = @($tree.ToArray())
            [Array]::Reverse($orderedIds)
            foreach ($processId in $orderedIds) {
                Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
            }
            Remove-Item -LiteralPath $stateFile.FullName -Force
            $results += [pscustomobject]@{ mode = $state.mode; status = "stopped"; pid = [int]$state.pid; process_tree = $orderedIds }
        } catch {
            $results += [pscustomobject]@{ mode = $stateFile.BaseName; status = "not-cleaned"; detail = $_.Exception.Message }
        }
    }
}

if ($RemoveTemporaryFiles) {
    $tempPath = Join-Path $root ".handoff-temp"
    $resolvedRoot = [IO.Path]::GetFullPath($root).TrimEnd("\") + "\"
    $resolvedTemp = [IO.Path]::GetFullPath($tempPath)
    if (-not $resolvedTemp.StartsWith($resolvedRoot, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Temporary path is outside the project root: $resolvedTemp"
    }
    if (Test-Path -LiteralPath $resolvedTemp) {
        Remove-Item -LiteralPath $resolvedTemp -Recurse -Force
        $results += [pscustomobject]@{ target = $resolvedTemp; status = "temporary-files-removed" }
    }
}

$partial = @($results | Where-Object { $_.status -eq "not-cleaned" }).Count -gt 0
[ordered]@{
    schema = "line-first-cleanup-result/v1"
    status = if ($partial) { "PARTIAL" } else { "PASS" }
    project_root = $root
    results = $results
    preserved = @(".env", "data", "browser profiles", "business records", "logs")
} | ConvertTo-Json -Depth 7
if ($partial) { exit 1 }
