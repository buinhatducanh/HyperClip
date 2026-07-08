# build/patch.ps1
# ─────────────────────────────────────────────────────────────
# HyperClip Patch Builder
# Generates a lightweight update patch ZIP for client installations.
# Patch overwrites the existing app/ folder - does NOT include static DLLs,
# Python runtime, Node, ffmpeg, or yt-dlp (~7-25MB instead of ~1GB).
#
# Usage:
#   pwsh -ExecutionPolicy Bypass -File build/patch.ps1
#   pwsh -ExecutionPolicy Bypass -File build/patch.ps1 -SkipBuild
#   pwsh -ExecutionPolicy Bypass -File build/patch.ps1 -IncludeYtDlp
#
# Client install instructions:
#   1. Extract ZIP contents into HyperClip root folder
#   2. Run: powershell -ExecutionPolicy Bypass -File apply-patch.ps1
#   (Or manually copy files to overwrite existing app/)
# ─────────────────────────────────────────────────────────────

param(
    [switch]$SkipBuild,
    [switch]$IncludeYtDlp
)

$ErrorActionPreference = "Stop"

$ProjectRoot      = Split-Path -Parent $PSScriptRoot
$BuildDistDir     = Join-Path $ProjectRoot "build\dist\hyperclip-bundle"
$ReleaseDir       = Join-Path $ProjectRoot "release"
$TauriExe         = Join-Path $ProjectRoot "target\release\hyperclip-tauri.exe"
$LauncherExe      = Join-Path $ProjectRoot "target\release\hyperclip-launcher.exe"
$HelperJs         = Join-Path $ProjectRoot "crates\hyperclip_ipc\src\innertube_helper.js"
$BgJpg            = Join-Path $ProjectRoot "bg.jpg"
$ApplyScript      = Join-Path $PSScriptRoot "apply-patch.ps1"

# ── 1. Pre-flight checks ───────────────────────────────────────
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "     HyperClip Patch Builder           " -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "=== [1/5] Pre-flight checks ===" -ForegroundColor Cyan

$missing = @()
foreach ($p in @($HelperJs, $BgJpg, $ApplyScript)) {
    if (-not (Test-Path $p)) { $script:missing += $p }
}
if ($missing.Count -gt 0) {
    Write-Warning "Optional files missing (patch will skip them):"
    $missing | ForEach-Object { Write-Warning "  - $_" }
}

# Verify git HEAD vs last-built bundle (warn if stale)
$bundleExe = Join-Path $BuildDistDir "HyperClip.exe"
$tauriBuiltExe = $TauriExe
$lastBuildMtime = if (Test-Path $bundleExe) { (Get-Item $bundleExe).LastWriteTime } else { (Get-Date).AddYears(-1) }
$headFile = Join-Path $ProjectRoot ".git\HEAD"
if (Test-Path $headFile) {
    $lastCommitMtime = (Get-Item $headFile).LastWriteTime
    if ($lastCommitMtime -gt $lastBuildMtime) {
        Write-Warning "Source is newer than build. Consider running 'pwsh build/build.ps1' first."
    }
}

# ── 2. Build (skip if artifacts present or -SkipBuild) ────────
Write-Host "`n=== [2/5] Build artifacts ===" -ForegroundColor Cyan

if ($SkipBuild) {
    Write-Host "Skipping build (-SkipBuild flag)" -ForegroundColor Yellow
} else {
    $needRebuild = $false
    foreach ($p in @($bundleExe, $tauriBuiltExe, $LauncherExe)) {
        if (-not (Test-Path $p)) { $needRebuild = $true; break }
    }
    if ($needRebuild) {
        Write-Host "Missing artifacts - running build.ps1..."
        & "$PSScriptRoot\build.ps1"
        if ($LASTEXITCODE -ne 0) { Write-Error "Build failed"; exit 1 }
    } else {
        Write-Host "Artifacts present, skipping build." -ForegroundColor Green
    }
}

if (-not (Test-Path $BuildDistDir)) {
    Write-Error "Build dist folder not found: $BuildDistDir"
    exit 1
}

# ── 3. Stage patch contents ────────────────────────────────────
Write-Host "`n=== [3/5] Staging patch contents ===" -ForegroundColor Cyan

$timestamp   = Get-Date -Format "yyyyMMdd-HHmmss"
$patchName   = "HyperClip-Patch-$timestamp"
$patchDir    = Join-Path $ReleaseDir $patchName
$appDir      = Join-Path $patchDir "app"
$internalDir = Join-Path $appDir "_internal"
$resourcesDir = Join-Path $internalDir "resources"

foreach ($d in @($patchDir, $appDir, $internalDir, $resourcesDir)) {
    New-Item -ItemType Directory -Path $d -Force | Out-Null
}

# Git metadata
$headShort  = (git -C $ProjectRoot rev-parse --short HEAD 2>$null) | Out-String | ForEach-Object { $_.Trim() }
$headDate   = (git -C $ProjectRoot log -1 --pretty=%ai 2>$null) | Out-String | ForEach-Object { $_.Trim() }
$branch     = (git -C $ProjectRoot branch --show-current 2>$null) | Out-String | ForEach-Object { $_.Trim() }

# Track all staged files for manifest
$manifestFiles = @()

function Stage-File([string]$source, [string]$dest, [string]$label) {
    if (-not (Test-Path $source)) {
        Write-Warning "Skipping $label - not found: $source"
        return
    }
    Write-Host "  Copying $label..."
    Copy-Item -Path $source -Destination $dest -Force
    
    # Calculate relative path from patch root for manifest
    $relPath = $dest.Substring($patchDir.Length).TrimStart('\', '/')
    $hash = (Get-FileHash -Path $dest -Algorithm SHA256).Hash.ToLower()
    $size = (Get-Item $dest).Length
    $script:manifestFiles += [pscustomobject]@{
        path   = $relPath -replace '\\', '/'
        sha256 = $hash
        size   = $size
    }
}

function Stage-Directory([string]$source, [string]$dest, [string]$label) {
    if (-not (Test-Path $source)) {
        Write-Warning "Skipping $label - not found: $source"
        return
    }
    Write-Host "  Copying $label..."
    Copy-Item -Path $source -Destination $dest -Recurse -Force

    # Add all files in copied directory to manifest
    Get-ChildItem $dest -Recurse -File | ForEach-Object {
        $relPath = $_.FullName.Substring($patchDir.Length).TrimStart('\', '/')
        $hash = (Get-FileHash -Path $_.FullName -Algorithm SHA256).Hash.ToLower()
        $script:manifestFiles += [pscustomobject]@{
            path   = $relPath -replace '\\', '/'
            sha256 = $hash
            size   = $_.Length
        }
    }
}

# Native launcher
Stage-File $LauncherExe (Join-Path $patchDir "HyperClip.exe") "HyperClip.exe (native launcher)"

# PyInstaller bundle
Stage-File $bundleExe (Join-Path $appDir "HyperClip.exe") "HyperClip.exe (PyInstaller app)"

# Rust backend
Stage-File $tauriBuiltExe (Join-Path $internalDir "hyperclip-tauri.exe") "hyperclip-tauri.exe"

# base_library.zip
$baseLib = Join-Path $BuildDistDir "_internal\base_library.zip"
Stage-File $baseLib (Join-Path $internalDir "base_library.zip") "base_library.zip"

# QML layouts
$qmlSrc = Join-Path $BuildDistDir "_internal\qml"
Stage-Directory $qmlSrc (Join-Path $internalDir "qml") "QML layouts"

# innertube_helper.js (always from latest source)
Stage-File $HelperJs (Join-Path $resourcesDir "innertube_helper.js") "innertube_helper.js"

# bg.jpg (optional)
Stage-File $BgJpg (Join-Path $patchDir "bg.jpg") "bg.jpg"

# yt-dlp (optional, only when -IncludeYtDlp)
if ($IncludeYtDlp) {
    $ytdlpSrc = Join-Path $BuildDistDir "_internal\resources\yt-dlp\yt-dlp.exe"
    $ytdlpDir = Join-Path $resourcesDir "yt-dlp"
    New-Item -ItemType Directory -Path $ytdlpDir -Force | Out-Null
    Stage-File $ytdlpSrc (Join-Path $ytdlpDir "yt-dlp.exe") "yt-dlp.exe"
}

# Embed apply-patch.ps1 for client convenience
if (Test-Path $ApplyScript) {
    Write-Host "  Embedding apply-patch.ps1..."
    Copy-Item -Path $ApplyScript -Destination $patchDir -Force
    $relPath = "apply-patch.ps1"
    $hash = (Get-FileHash -Path (Join-Path $patchDir "apply-patch.ps1") -Algorithm SHA256).Hash.ToLower()
    $size = (Get-Item (Join-Path $patchDir "apply-patch.ps1")).Length
    $manifestFiles += [pscustomobject]@{
        path   = $relPath
        sha256 = $hash
        size   = $size
    }
}

# ── 4. Generate manifest & version files ───────────────────────
Write-Host "`n=== [4/5] Generating manifest ===" -ForegroundColor Cyan

$totalSize = ($manifestFiles | Measure-Object -Property size -Sum).Sum

# patch-version.json
$versionInfo = @{
    patchBuiltAt = (Get-Date).ToString("yyyy-MM-ddTHH:mm:sszzz")
    gitHead      = $headShort
    gitDate      = $headDate
    gitBranch    = $branch
    version      = "0.1.0"
} | ConvertTo-Json -Depth 3
$versionInfo | Out-File -FilePath (Join-Path $patchDir "patch-version.json") -Encoding UTF8

# patch-manifest.json (for client verification)
$manifest = @{
    version      = "0.1.0"
    gitHead      = $headShort
    gitBranch    = $branch
    builtAt      = (Get-Date).ToString("yyyy-MM-ddTHH:mm:sszzz")
    totalSize    = $totalSize
    fileCount    = $manifestFiles.Count
    files        = $manifestFiles | ForEach-Object {
        @{
            path   = $_.path
            sha256 = $_.sha256
            size   = $_.size
        }
    }
} | ConvertTo-Json -Depth 4
$manifest | Out-File -FilePath (Join-Path $patchDir "patch-manifest.json") -Encoding UTF8

Write-Host "  Files in patch: $($manifestFiles.Count)" -ForegroundColor Green
Write-Host "  Total size:     $([math]::Round($totalSize / 1MB, 2)) MB" -ForegroundColor Green

# ── 5. Compress to ZIP ─────────────────────────────────────────
Write-Host "`n=== [5/5] Compressing patch ===" -ForegroundColor Cyan

$zipPath = "$patchDir.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

Start-Sleep -Seconds 2  # let any file locks release
Compress-Archive -Path "$patchDir\*" -DestinationPath $zipPath -Force

Remove-Item $patchDir -Recurse -Force

$zipSizeMb = (Get-Item $zipPath).Length / 1MB
$zipHash = (Get-FileHash -Path $zipPath -Algorithm SHA256).Hash.ToLower()

# ── Summary ─────────────────────────────────────────────────────
Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "     Patch Complete!                   " -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "ZIP:       $zipPath"
Write-Host "Size:      $($zipSizeMb.ToString('F2')) MB" -ForegroundColor Yellow
Write-Host "SHA256:    $zipHash" -ForegroundColor DarkGray
Write-Host "Git:       $headShort ($branch)" -ForegroundColor DarkGray
Write-Host "Files:     $($manifestFiles.Count) files" -ForegroundColor DarkGray
Write-Host ""
Write-Host "── File Listing ──" -ForegroundColor DarkGray
foreach ($f in $manifestFiles) {
    $sizeFmt = if ($f.size -gt 1MB) { "$([math]::Round($f.size / 1MB, 1))MB" } else { "$([math]::Round($f.size / 1KB, 0))KB" }
    Write-Host "  $($f.path)  ($sizeFmt)" -ForegroundColor DarkGray
}
Write-Host ""
Write-Host "── Client Instructions ──" -ForegroundColor White
Write-Host "  1. Copy ZIP to HyperClip root folder"
Write-Host "  2. Extract ZIP"
Write-Host "  3. Run: powershell -ExecutionPolicy Bypass -File apply-patch.ps1"
Write-Host ""
