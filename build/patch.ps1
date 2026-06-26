# build/patch.ps1
# Generates a lightweight update patch for HyperClip client installations.
# Patch overwrites the existing app/ folder - does NOT include static DLLs,
# Python runtime, Node, ffmpeg, or yt-dlp (~7MB instead of ~1GB).
#
# Usage:
#   pwsh -ExecutionPolicy Bypass -File build/patch.ps1
#
# Client install instructions:
#   1. Extract ZIP contents directly into HyperClip root folder
#   2. Files will overwrite existing app/HyperClip.exe, app/_internal/, etc.

$ErrorActionPreference = "Stop"

$ProjectRoot      = Split-Path -Parent $PSScriptRoot
$BuildDistDir     = Join-Path $ProjectRoot "build\dist\hyperclip-bundle"
$ReleaseDir       = Join-Path $ProjectRoot "release"
$TauriExe         = Join-Path $ProjectRoot "target\release\hyperclip-tauri.exe"
$LauncherExe      = Join-Path $ProjectRoot "target\release\hyperclip-launcher.exe"
$HelperJs         = Join-Path $ProjectRoot "crates\hyperclip_ipc\src\innertube_helper.js"
$BgJpg            = Join-Path $ProjectRoot "bg.jpg"

# ── 1. Pre-flight checks ───────────────────────────────────────
Write-Host "=== [1/4] Pre-flight checks ===" -ForegroundColor Cyan

$missing = @()
foreach ($p in @($HelperJs, $BgJpg)) {
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
$lastCommitMtime = (Get-Item "$ProjectRoot\.git\HEAD").LastWriteTime
if ($lastCommitMtime -gt $lastBuildMtime) {
    Write-Warning "Source is newer than build. Run 'pwsh build/build.ps1' first for fresh artifacts."
}

# ── 2. Build (skip if artifacts present) ──────────────────────
Write-Host "`n=== [2/4] Build artifacts ===" -ForegroundColor Cyan
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

if (-not (Test-Path $BuildDistDir)) {
    Write-Error "Build dist folder not found: $BuildDistDir"
    exit 1
}

# ── 3. Stage patch contents ────────────────────────────────────
Write-Host "`n=== [3/4] Staging patch contents ===" -ForegroundColor Cyan

$timestamp   = Get-Date -Format "yyyyMMdd-HHmmss"
$patchName   = "HyperClip-Patch-$timestamp"
$patchDir    = Join-Path $ReleaseDir $patchName
$appDir      = Join-Path $patchDir "app"
$internalDir = Join-Path $appDir "_internal"
$resourcesDir = Join-Path $internalDir "resources"

foreach ($d in @($patchDir, $appDir, $internalDir, $resourcesDir)) {
    New-Item -ItemType Directory -Path $d -Force | Out-Null
}

# Version metadata so client can verify patch applied
$headShort  = (git -C $ProjectRoot rev-parse --short HEAD 2>$null)
$headDate   = (git -C $ProjectRoot log -1 --pretty=%ai 2>$null)
$branch     = (git -C $ProjectRoot branch --show-current 2>$null)
$versionInfo = [pscustomobject]@{
    patchBuiltAt = (Get-Date).ToString("yyyy-MM-ddTHH:mm:sszzz")
    gitHead      = $headShort
    gitDate      = $headDate
    gitBranch    = $branch
} | ConvertTo-Json -Depth 3
$versionInfo | Out-File -FilePath (Join-Path $patchDir "patch-version.json") -Encoding UTF8

# Native launcher
Write-Host "Copying HyperClip.exe (native launcher)..."
Copy-Item -Path $LauncherExe -Destination (Join-Path $patchDir "HyperClip.exe") -Force

# PyInstaller bundle
Write-Host "Copying HyperClip.exe (PyInstaller app)..."
Copy-Item -Path $bundleExe -Destination $appDir -Force

# Rust backend
Write-Host "Copying hyperclip-tauri.exe..."
Copy-Item -Path $tauriBuiltExe -Destination $internalDir -Force

# base_library.zip (must sit next to PyInstaller exe)
$baseLib = Join-Path $BuildDistDir "_internal\base_library.zip"
if (Test-Path $baseLib) {
    Write-Host "Copying base_library.zip..."
    Copy-Item -Path $baseLib -Destination $internalDir -Force
} else {
    Write-Warning "base_library.zip not found at $baseLib"
}

# QML layouts
$qmlSrc = Join-Path $BuildDistDir "_internal\qml"
if (Test-Path $qmlSrc) {
    Write-Host "Copying QML layouts..."
    Copy-Item -Path $qmlSrc -Destination $internalDir -Recurse -Force
} else {
    Write-Warning "QML source dir not found: $qmlSrc"
}

# innertube_helper.js (latest from source - always copy freshest)
Write-Host "Copying innertube_helper.js..."
Copy-Item -Path $HelperJs -Destination $resourcesDir -Force

# bg.jpg (root image - optional)
if (Test-Path $BgJpg) {
    Write-Host "Copying bg.jpg..."
    Copy-Item -Path $BgJpg -Destination $patchDir -Force
}

# ── 4. Compress to ZIP ─────────────────────────────────────────
Write-Host "`n=== [4/4] Compressing patch ===" -ForegroundColor Cyan

$zipPath = "$patchDir.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

Start-Sleep -Seconds 2  # let any file locks release
tar -a -cf $zipPath -C $patchDir .

Remove-Item $patchDir -Recurse -Force

$zipSizeMb = (Get-Item $zipPath).Length / 1MB

Write-Host "`n=== Patch Complete ===" -ForegroundColor Green
Write-Host "ZIP:      $zipPath"
Write-Host "Size:     $($zipSizeMb.ToString('F2')) MB" -ForegroundColor Yellow
Write-Host "GitHead:  $headShort ($headDate)" -ForegroundColor DarkGray
Write-Host "Branch:   $branch" -ForegroundColor DarkGray
Write-Host ""
Write-Host "Client: extract ZIP directly into HyperClip root to overwrite app/." -ForegroundColor White
