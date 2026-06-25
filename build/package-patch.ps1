# build/package-patch.ps1
# Packaging script: builds Rust release and packages patch ZIP.
# Usage: powershell -ExecutionPolicy Bypass -File build/package-patch.ps1

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Building and Packaging HyperClip Patch" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# 1. Run build script to compile Rust release binary and PyInstaller bundle
Write-Host "Running build.ps1..." -ForegroundColor Yellow
& "$PSScriptRoot\build.ps1"

$BundleSource = "$ProjectRoot/build/dist/hyperclip-bundle"
if (-not (Test-Path $BundleSource)) {
    Write-Error "Bundle source not found at $BundleSource"
    exit 1
}

# 2. Prepare patch directory
$Timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$PatchName = "HyperClip-Patch-$Timestamp"
$PatchPath = Join-Path $ProjectRoot $PatchName
$PatchApp = Join-Path $PatchPath "app"

Write-Host "Creating patch directories at $PatchPath..." -ForegroundColor Cyan
New-Item -ItemType Directory -Path $PatchApp -Force | Out-Null

# 3. Copy files to patch
Write-Host "Copying patch files..." -ForegroundColor Cyan

# Compile native Rust launcher
Write-Host "Compiling professional native launcher (HyperClip.exe)..."
& cargo build --release --bin hyperclip-launcher
if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to compile hyperclip-launcher"
    exit 1
}
Copy-Item -Path "$ProjectRoot\target\release\hyperclip-launcher.exe" -Destination (Join-Path $PatchPath "HyperClip.exe") -Force

# Copy PyInstaller app executable to app/
Copy-Item "$BundleSource\HyperClip.exe" -Destination $PatchApp -Force

$InternalDest = Join-Path $PatchApp "_internal"
New-Item -ItemType Directory -Path $InternalDest -Force | Out-Null

# Copy hyperclip-tauri.exe
Copy-Item "$BundleSource\_internal\hyperclip-tauri.exe" -Destination $InternalDest -Force

# Copy base_library.zip
Copy-Item "$BundleSource\_internal\base_library.zip" -Destination $InternalDest -Force

# Copy QML directory
Copy-Item "$BundleSource\_internal\qml" -Destination $InternalDest -Recurse -Force

# 4. Create ZIP archive
$ZipFile = "$ProjectRoot\$PatchName.zip"
Write-Host "Waiting for file locks to release..." -ForegroundColor Yellow
Start-Sleep -Seconds 5
Write-Host "Compressing patch into ZIP..." -ForegroundColor Cyan
Compress-Archive -Path "$PatchPath\*" -DestinationPath $ZipFile -Force

# 5. Clean up temporary patch folder
Write-Host "Cleaning up temporary folder..." -ForegroundColor Cyan
Remove-Item $PatchPath -Recurse -Force

Write-Host "========================================" -ForegroundColor Green
Write-Host "Patch package created successfully!" -ForegroundColor Green
Write-Host "ZIP file: $ZipFile" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
