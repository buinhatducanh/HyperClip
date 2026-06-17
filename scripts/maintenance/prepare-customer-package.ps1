param(
    [string]$CustomerName = "DemoCustomer",
    [string]$OutputDir = "D:\LOOP_COMPANY\HyperClip\release"
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")

# Check if HyperClip or Chrome is running (locking SQLite databases)
$LockedProcesses = Get-Process | Where-Object { 
    $_.Name -like "*hyperclip*" -or 
    ($_.Name -like "*python*" -and $_.CommandLine -like "*src.main*")
}
if ($LockedProcesses) {
    Write-Host "[WARNING] Active Chrome or HyperClip processes detected:" -ForegroundColor Yellow
    foreach ($p in $LockedProcesses) {
        Write-Host "  - PID $($p.Id): $($p.Name)" -ForegroundColor Yellow
    }
    Write-Host "Please close all Chrome browser windows and exit the HyperClip app before packaging." -ForegroundColor Red
    Write-Host "This ensures Chrome profile cookie databases are unlocked and can be copied safely." -ForegroundColor Red
    exit 1
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Preparing Customer Package for $CustomerName" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# 1. Check compiled bundle
$BundleSource = Join-Path $ProjectRoot "build\dist\hyperclip-bundle"
if (-not (Test-Path $BundleSource)) {
    Write-Error "Bundled app not found at $BundleSource. Please run build.ps1 first."
    exit 1
}

# 2. Resolve active data directory on operator machine
$DataDir = "D:\HyperClip-Data"
if (-not (Test-Path $DataDir)) {
    $DataDir = Join-Path $env:APPDATA "hyperclip"
}
if (-not (Test-Path $DataDir)) {
    Write-Error "Active data directory not found on operator machine."
    exit 1
}
Write-Host "Sourcing data from: $DataDir" -ForegroundColor Yellow

# 3. Create package folder structure
$Timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$PackageName = "HyperClip-$CustomerName-$Timestamp"
$PackagePath = Join-Path $OutputDir $PackageName
$AppDest = Join-Path $PackagePath "app"
$DataDest = Join-Path $PackagePath "HyperClip-Data"

Write-Host "Creating package directories at $PackagePath..." -ForegroundColor Cyan
New-Item -ItemType Directory -Path $AppDest -Force | Out-Null
New-Item -ItemType Directory -Path $DataDest -Force | Out-Null

# 4. Copy app bundle
Write-Host "Copying compiled app bundle..." -ForegroundColor Cyan
Copy-Item "$BundleSource\*" -Destination $AppDest -Recurse -Force

# 5. Copy pre-configured cookies, channels, projects, and settings
Write-Host "Copying pre-configured data (sessions and accounts)..." -ForegroundColor Cyan
$ItemsToCopy = @(
    "chrome-profiles",
    "cookies.txt",
    "cookies_netscape.txt",
    "channels",
    ".hyperclip"
)

foreach ($item in $ItemsToCopy) {
    $src = Join-Path $DataDir $item
    if (Test-Path $src) {
        $dest = Join-Path $DataDest $item
        Write-Host "  Copying $item -> $dest"
        if ($item -eq "chrome-profiles") {
            # Use robocopy to exclude cache directories and handle long paths
            # Robocopy exit codes: 0-7 are success/no-error. >= 8 are errors.
            $robocopyArgs = @($src, $dest, "/E", "/XD", "Cache", "CacheStorage", "Code Cache", "GPUCache", "Service Worker", "DawnCache", "Blob Storage", "Video Decode Stats", "/R:1", "/W:1", "/NDL", "/NFL")
            $oldErrorAction = $ErrorActionPreference
            $ErrorActionPreference = "SilentlyContinue"
            & robocopy.exe @robocopyArgs | Out-Null
            $exitCode = $LASTEXITCODE
            $ErrorActionPreference = $oldErrorAction
            if ($exitCode -ge 8) {
                Write-Error "Robocopy failed with exit code $exitCode"
                exit 1
            }
        } else {
            Copy-Item $src -Destination $dest -Recurse -Force
        }
    } else {
        Write-Warning "  Source item $item not found, skipping."
    }
}

# 6. Create HyperClip-Launcher.bat
$LauncherPath = Join-Path $PackagePath "HyperClip-Launcher.bat"
Write-Host "Creating portable batch launcher..." -ForegroundColor Cyan
$LauncherContent = @"
@echo off
set "SCRIPT_DIR=%~dp0"
set "HYPERCLIP_DATA_DIR=%SCRIPT_DIR%HyperClip-Data"
start "" "%SCRIPT_DIR%app\hyperclip.exe"
"@
Set-Content -Path $LauncherPath -Value $LauncherContent -Encoding Ascii

# 6b. Create HyperClip-Debug.bat
$DebugLauncherPath = Join-Path $PackagePath "HyperClip-Debug.bat"
Write-Host "Creating portable debug launcher..." -ForegroundColor Cyan
$DebugLauncherContent = @"
@echo off
set "SCRIPT_DIR=%~dp0"
set "HYPERCLIP_DATA_DIR=%SCRIPT_DIR%HyperClip-Data"
echo Starting HyperClip in Debug/Verbose Mode...
echo Logs are being streamed below. Close this window to exit.
echo =========================================================
"%SCRIPT_DIR%app\hyperclip.exe"
echo =========================================================
echo App exited.
pause
"@
Set-Content -Path $DebugLauncherPath -Value $DebugLauncherContent -Encoding Ascii

# 7. Create README.txt
$ReadmePath = Join-Path $PackagePath "README.txt"
Write-Host "Creating customer quick start instructions..." -ForegroundColor Cyan
$ReadmeContent = @"
HyperClip Portable Customer Package for $CustomerName
=====================================================

Day-to-day Usage:
-----------------
1. Double-click the "HyperClip-Launcher.bat" file to launch.
2. The application will launch with all pre-configured accounts, sessions, and channels ready.
3. No configuration or setup is required. Do NOT run Google Chrome on the monitored profiles while using the app.

Troubleshooting & Debugging:
---------------------------
- If the application crashes, does not launch, or encounters errors:
  Double-click the "HyperClip-Debug.bat" file. This runs the app inside a console window so you can see error messages in real-time.
- Application logs are saved automatically in:
  \HyperClip-Data\logs\
  If you need support, please copy the log files from that directory and send them to the developer.

Notes:
------
- Keep all files in this folder structure.
- Ensure your GPU drivers are updated (NVIDIA NVENC RTX series recommended).
"@
Set-Content -Path $ReadmePath -Value $ReadmeContent -Encoding Ascii

# 8. Create ZIP archive
$ZipFile = "$PackagePath.zip"
Write-Host "Compressing package into ZIP..." -ForegroundColor Cyan
Compress-Archive -Path "$PackagePath\*" -DestinationPath $ZipFile -Force

Write-Host "========================================" -ForegroundColor Green
Write-Host "Package created successfully!" -ForegroundColor Green
Write-Host "ZIP file: $ZipFile" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
