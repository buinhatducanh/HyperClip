# build/build.ps1
# Build script: Rust backend + PyInstaller bundle
# Usage: pwsh -File build/build.ps1

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot

Write-Host "[1/3] Building Rust backend..."
Push-Location "$ProjectRoot/src-tauri"
cargo build --release
if ($LASTEXITCODE -ne 0) {
    Write-Error "Backend compilation failed with exit code $LASTEXITCODE"
    exit 1
}
Pop-Location

$BackendExe = "$ProjectRoot/target/release/hyperclip-tauri.exe"
if (-not (Test-Path $BackendExe)) {
    Write-Error "Backend build failed: $BackendExe not found"
    exit 1
}
Write-Host "  Built: $BackendExe"

Write-Host "[2/3] Verifying FFmpeg + yt-dlp..."
$ffmpeg = if (Get-Command ffmpeg -ErrorAction SilentlyContinue) { (Get-Command ffmpeg).Source } else {
    $candidates = @(
        "C:\Program Files\Agent\dlls\x64\ffmpeg.exe",
        (Join-Path $env:USERPROFILE "scoop\shims\ffmpeg.exe"),
        (Join-Path $env:LOCALAPPDATA "Programs\scoop\shims\ffmpeg.exe")
    )
    $found = $null
    foreach ($c in $candidates) {
        if (Test-Path $c) { $found = $c; break }
    }
    if ($found) { $found } else { "ffmpeg.exe" }
}

$ytdlp = if (Get-Command yt-dlp -ErrorAction SilentlyContinue) { (Get-Command yt-dlp).Source } else {
    $candidates = @(
        (Join-Path $env:APPDATA "Python\Python312\Scripts\yt-dlp.exe"),
        (Join-Path $env:APPDATA "Python\Python313\Scripts\yt-dlp.exe"),
        (Join-Path $env:APPDATA "Python\Python314\Scripts\yt-dlp.exe")
    )
    $found = $null
    foreach ($c in $candidates) {
        if (Test-Path $c) { $found = $c; break }
    }
    if ($found) { $found } else { "yt-dlp.exe" }
}
foreach ($tool in @($ffmpeg, $ytdlp)) {
    if (Test-Path $tool) {
        Write-Host "  Found: $tool"
    } else {
        Write-Warning "  Missing: $tool"
    }
}

Write-Host "Copying innertube_helper.js to resources/..."
Copy-Item -Path "$ProjectRoot\crates\hyperclip_ipc\src\innertube_helper.js" -Destination "$ProjectRoot\resources\innertube_helper.js" -Force

Write-Host "[3/3] Running PyInstaller..."
Push-Location "$ProjectRoot/build"
python -m PyInstaller hyperclip.spec --clean --noconfirm
Pop-Location

$BundleExe = "$ProjectRoot/build/dist/hyperclip-bundle/HyperClip.exe"
if (Test-Path $BundleExe) {
    Write-Host ""
    Write-Host "Build complete: $BundleExe"
} else {
    Write-Error "Build failed: $BundleExe not found"
    exit 1
}
