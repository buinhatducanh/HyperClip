# build/build.ps1
# Build script: Rust backend + PyInstaller bundle
# Usage: pwsh -File build/build.ps1

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot

Write-Host "[1/3] Building Rust backend..."
Push-Location "$ProjectRoot/src-tauri"
cargo build --release
Pop-Location

$BackendExe = "$ProjectRoot/src-tauri/target/release/hyperclip.exe"
if (-not (Test-Path $BackendExe)) {
    Write-Error "Backend build failed: $BackendExe not found"
    exit 1
}
Write-Host "  Built: $BackendExe"

Write-Host "[2/3] Verifying FFmpeg + yt-dlp..."
$ffmpeg = "C:/Users/MSI/scoop/shims/ffmpeg.exe"
$ytdlp = "C:/Users/MSI/AppData/Roaming/Python/Python312/Scripts/yt-dlp.exe"
foreach ($tool in @($ffmpeg, $ytdlp)) {
    if (Test-Path $tool) {
        Write-Host "  Found: $tool"
    } else {
        Write-Warning "  Missing: $tool"
    }
}

Write-Host "[3/3] Running PyInstaller..."
Push-Location "$ProjectRoot/build"
pyinstaller hyperclip.spec --clean --noconfirm
Pop-Location

$BundleExe = "$ProjectRoot/build/dist/hyperclip-bundle/hyperclip.exe"
if (Test-Path $BundleExe) {
    Write-Host ""
    Write-Host "Build complete: $BundleExe"
} else {
    Write-Error "Build failed: $BundleExe not found"
    exit 1
}
