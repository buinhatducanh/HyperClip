# scripts/maintenance/prepare-source-handover.ps1
# Handover packaging script: Clean source code zip generation
# Usage: powershell -File scripts/maintenance/prepare-source-handover.ps1

$ErrorActionPreference = "Stop"
$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$OutputDir = Join-Path $ProjectRoot "release"

Write-Host "========================================" -ForegroundColor Cyan
$Timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$HandoverName = "HyperClip-Source-Handover-$Timestamp"
$TempPath = Join-Path $env:TEMP $HandoverName

Write-Host "Preparing clean source code copy..." -ForegroundColor Cyan
Write-Host "Creating temp working dir at: $TempPath" -ForegroundColor Yellow
New-Item -ItemType Directory -Path $TempPath -Force | Out-Null

# Define directories/files to ignore using Robocopy
# Robocopy is extremely fast and natively handles excluding deep directories
$RobocopyArgs = @(
    $ProjectRoot,
    $TempPath,
    "/E",
    "/XD",
    "target",
    ".git",
    "venv",
    ".venv",
    "build",
    "dist",
    "release",
    "data",
    ".idea",
    ".vscode",
    "__pycache__",
    ".pytest_cache",
    "chrome-profiles",
    "/XF",
    "*.zip",
    "*.exe",
    "*.log",
    "*.db",
    "*.pyc",
    "cookies.txt",
    "cookies_netscape.txt",
    "/NDL",
    "/NFL"
)

Write-Host "Copying files (excluding target, venv, build, dist, release, logs, caches)..." -ForegroundColor Yellow
$oldErrorAction = $ErrorActionPreference
$ErrorActionPreference = "SilentlyContinue"
& robocopy.exe @RobocopyArgs | Out-Null
$exitCode = $LASTEXITCODE
$ErrorActionPreference = $oldErrorAction

if ($exitCode -ge 8) {
    Write-Error "Robocopy failed to copy files cleanly (exit code $exitCode)."
    exit 1
}

# Copy the handover markdown documents we generated in user's app data to the root of the source package so the developer has them handy!
$BrainDocs = @(
    "codebase_analysis_report.md",
    "handover_maintainability_report.md",
    "comprehensive_po_evaluation.md",
    "performance_optimization_analysis.md"
)

$BrainPath = "C:\Users\MSI\.gemini\antigravity-ide\brain\a9cabee0-8aeb-49eb-9cb9-8a1ad72f1893"
if (Test-Path $BrainPath) {
    Write-Host "Injecting documentation reports into package..." -ForegroundColor Cyan
    foreach ($doc in $BrainDocs) {
        $docSrc = Join-Path $BrainPath $doc
        if (Test-Path $docSrc) {
            Copy-Item $docSrc -Destination $TempPath -Force
            Write-Host "  Added: $doc"
        }
    }
}

# Create Output ZIP
$ZipFile = Join-Path $OutputDir "$HandoverName.zip"
Write-Host "Compressing source code package..." -ForegroundColor Cyan
if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
}
Compress-Archive -Path "$TempPath\*" -DestinationPath $ZipFile -Force

# Clean up temp files
Write-Host "Cleaning up temp files..." -ForegroundColor Cyan
Remove-Item $TempPath -Recurse -Force | Out-Null

Write-Host "========================================" -ForegroundColor Green
Write-Host "Source code handover package created successfully!" -ForegroundColor Green
Write-Host "ZIP file: $ZipFile" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
