# build/package.ps1
# Automates packaging the built HyperClip app with template batch files and data from latest zip
$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$ReleaseDir = Join-Path $ProjectRoot "release"
$BuildDistDir = Join-Path $ProjectRoot "build\dist\hyperclip-bundle"

if (-not (Test-Path $BuildDistDir)) {
    Write-Error "Build dist folder not found: $BuildDistDir. Please run build/build.ps1 first."
    exit 1
}

# 1. Find the latest HyperClip-TestCustomer zip file in the release folder
$zipFiles = Get-ChildItem -Path $ReleaseDir -Filter "HyperClip-TestCustomer-*.zip" | Sort-Object Name -Descending
if ($zipFiles.Count -eq 0) {
    Write-Error "Could not find any existing HyperClip-TestCustomer zip file in $ReleaseDir."
    exit 1
}
$templateZip = $zipFiles[0].FullName
Write-Host "Using template zip: $($zipFiles[0].Name)"

# 2. Create the new timestamped folder
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$targetName = "HyperClip-TestCustomer-$timestamp"
$targetDir = Join-Path $ReleaseDir $targetName

Write-Host "Creating target folder: $targetName..."
New-Item -Path $targetDir -ItemType Directory -Force | Out-Null

# 3. Extract non-app files from template zip
Write-Host "Extracting launcher files and user data from template zip..."
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($templateZip)
foreach ($entry in $zip.Entries) {
        $relativePath = $entry.FullName
        if ($relativePath -match '^HyperClip-TestCustomer-[^\\/]+[\\/](.*)$') {
            $relativePath = $Matches[1]
        }
        if ($relativePath -eq "" -or $relativePath -eq "app" -or $relativePath -like "app/*" -or $relativePath -like "app\*" -or $relativePath -like "HyperClip-Data/logs/*" -or $relativePath -like "HyperClip-Data/logs\*") {
            continue
        }
        $destPath = Join-Path $targetDir $relativePath
        $destDir = Split-Path $destPath
        if (-not (Test-Path $destDir)) {
            New-Item -Path $destDir -ItemType Directory -Force | Out-Null
        }
        if (-not $destPath.EndsWith("/") -and -not $destPath.EndsWith("\")) {
            [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $destPath, $true)
        }
    }
$zip.Dispose()
Write-Host "  OK  Extracted templates and data" -ForegroundColor Green

# 3b. Build and copy professional native launcher
Write-Host "Compiling professional native launcher (HyperClip.exe)..."
& cargo build --release --bin hyperclip-launcher
if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to compile hyperclip-launcher"
    exit 1
}
Copy-Item -Path "$ProjectRoot\target\release\hyperclip-launcher.exe" -Destination (Join-Path $targetDir "HyperClip.exe") -Force

# Remove old launcher bat file (since we use native HyperClip.exe), but keep/update debug bat
Remove-Item -Path (Join-Path $targetDir "HyperClip-Launcher.bat") -Force -ErrorAction SilentlyContinue

# Create/Overwrite HyperClip-Debug.bat with correct --debug argument
$debugBatContent = @"
@echo off
set "SCRIPT_DIR=%~dp0"
set "HYPERCLIP_DATA_DIR=%SCRIPT_DIR%HyperClip-Data"
echo Starting HyperClip in Debug/Verbose Mode...
echo Logs are being streamed below. Close this window to exit.
echo =========================================================
"%SCRIPT_DIR%HyperClip.exe" --debug
echo =========================================================
echo App exited.
pause
"@
Set-Content -Path (Join-Path $targetDir "HyperClip-Debug.bat") -Value $debugBatContent -Encoding Utf8
Write-Host "  OK  Compiled native launcher, removed launcher bat, and updated HyperClip-Debug.bat" -ForegroundColor Green

# 4. Create app folder and copy built bundle
$appDir = Join-Path $targetDir "app"
New-Item -Path $appDir -ItemType Directory -Force | Out-Null
Write-Host "Copying application bundle to app/..."
Copy-Item -Path "$BuildDistDir\*" -Destination $appDir -Recurse -Force
Write-Host "  OK  Copied application bundle" -ForegroundColor Green

# 5. Compress target folder to ZIP
$zipPath = "$targetDir.zip"
Write-Host "Zipping package to $targetName.zip using tar..."
if (Test-Path $zipPath) {
    Remove-Item $zipPath -Force
}
tar -a -cf $zipPath -C $ReleaseDir $targetName
Write-Host "Zipped successfully: $zipPath"

# 6. Clean up temporary target folder
Write-Host "Cleaning up folder $targetName..."
Remove-Item $targetDir -Recurse -Force

Write-Host "`n=== Packaging Complete ===" -ForegroundColor Green
Write-Host "Target zip: $zipPath"
