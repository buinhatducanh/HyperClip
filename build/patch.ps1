# build/patch.ps1
# Generates a lightweight debug update patch for HyperClip
# Packaged ZIP size will be ~7MB instead of 1GB by excluding static DLLs, Node, and Chrome profiles.
$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$ReleaseDir = Join-Path $ProjectRoot "release"
$BuildDistDir = Join-Path $ProjectRoot "build\dist\hyperclip-bundle"

# 1. Ensure everything is built and up-to-date
Write-Host "=== [1/3] Building latest binaries ===" -ForegroundColor Cyan
& "$PSScriptRoot/build.ps1"

if (-not (Test-Path $BuildDistDir)) {
    Write-Error "Build dist folder not found: $BuildDistDir"
    exit 1
}

# 2. Create temporary patch folder matching the user directory structure (app/)
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$patchFolderName = "HyperClip-Patch-$timestamp"
$patchDir = Join-Path $ReleaseDir $patchFolderName
$appDir = Join-Path $patchDir "app"
$internalDir = Join-Path $appDir "_internal"

Write-Host "`n=== [2/3] Preparing patch files ===" -ForegroundColor Cyan
New-Item -Path $internalDir -ItemType Directory -Force | Out-Null

Write-Host "Compiling professional native launcher (HyperClip.exe)..."
& cargo build --release --bin hyperclip-launcher
if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to compile hyperclip-launcher"
    exit 1
}
Copy-Item -Path "$ProjectRoot\target\release\hyperclip-launcher.exe" -Destination (Join-Path $patchDir "HyperClip.exe") -Force

# Copy only code binaries and layouts
Write-Host "Copying HyperClip.exe..."
Copy-Item -Path (Join-Path $BuildDistDir "HyperClip.exe") -Destination $appDir -Force

Write-Host "Copying Rust backend (hyperclip-tauri.exe)..."
Copy-Item -Path (Join-Path $BuildDistDir "_internal\hyperclip-tauri.exe") -Destination $internalDir -Force

Write-Host "Copying base library zip..."
Copy-Item -Path (Join-Path $BuildDistDir "_internal\base_library.zip") -Destination $internalDir -Force

Write-Host "Copying QML layouts..."
Copy-Item -Path (Join-Path $BuildDistDir "_internal\qml") -Destination $internalDir -Recurse -Force

Write-Host "Copying innertube_helper.js..."
$resourcesDir = Join-Path $internalDir "resources"
New-Item -Path $resourcesDir -ItemType Directory -Force | Out-Null
Copy-Item -Path "$ProjectRoot\crates\hyperclip_ipc\src\innertube_helper.js" -Destination $resourcesDir -Force

# 3. Compress patch folder to ZIP
$zipPath = "$patchDir.zip"
Write-Host "`n=== [3/3] Compressing patch to ZIP ===" -ForegroundColor Cyan
if (Test-Path $zipPath) {
    Remove-Item $zipPath -Force
}

tar -a -cf $zipPath -C $patchDir .
Write-Host "Zipped successfully: $zipPath" -ForegroundColor Green

# 4. Clean up temporary patch folder
Write-Host "Cleaning up temporary directory..."
Remove-Item $patchDir -Recurse -Force

$zipSizeMb = (Get-Item $zipPath).Length / 1MB
Write-Host "`n=== Packaging Patch Complete ===" -ForegroundColor Green
Write-Host "Patch Zip: $zipPath"
Write-Host "Size: $($zipSizeMb.ToString('F2')) MB" -ForegroundColor Yellow
Write-Host "Instruction for client: Extract this ZIP directly into your HyperClip root folder to overwrite and update the files." -ForegroundColor White
