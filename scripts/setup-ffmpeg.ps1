# setup-ffmpeg.ps1 - Download and extract FFmpeg to resources/ffmpeg/
#
# Usage: powershell -ExecutionPolicy Bypass -File scripts/setup-ffmpeg.ps1
# Or:    npm run setup:ffmpeg
#
# Downloads FFmpeg essentials from gyan.dev and extracts
# ffmpeg.exe + ffprobe.exe to resources/ffmpeg/.

param(
    [string]$Url = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $ScriptDir) { $ScriptDir = Split-Path -Parent $MyInvocation.PSCommandPath }
$Root = Split-Path -Parent $ScriptDir
$TargetDir = Join-Path $Root "resources\ffmpeg"
$ZipFile = Join-Path $TargetDir "ffmpeg.zip"

Write-Host "HyperClip FFmpeg Setup" -ForegroundColor Cyan
Write-Host ("=" * 50)

$ffmpegExe = Join-Path $TargetDir "ffmpeg.exe"
$ffprobeExe = Join-Path $TargetDir "ffprobe.exe"

if ((Test-Path $ffmpegExe) -and (Test-Path $ffprobeExe)) {
    $ver = & $ffmpegExe -version 2>&1 | Select-Object -First 1
    Write-Host "FFmpeg already bundled:" -ForegroundColor Green
    Write-Host "  $ver"
    Write-Host "Delete resources\ffmpeg\ to re-download."
    exit 0
}

if (Test-Path $TargetDir) {
    Write-Host "Removing old resources\ffmpeg\" -ForegroundColor Yellow
    Remove-Item -Recurse -Force $TargetDir
}
New-Item -ItemType Directory -Path $TargetDir -Force | Out-Null

Write-Host "Downloading FFmpeg essentials..." -ForegroundColor Yellow
Write-Host "  Source: $Url"

try {
    $web = New-Object System.Net.WebClient
    $web.DownloadFile($Url, $ZipFile)
    $web.Dispose()
} catch {
    Write-Host "Download failed: $_" -ForegroundColor Red
    exit 1
}

$zipSize = (Get-Item $ZipFile).Length / 1MB
Write-Host "Downloaded $('{0:N1}' -f $zipSize) MB" -ForegroundColor Green

Write-Host "Extracting to resources\ffmpeg\" -ForegroundColor Yellow

try {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [System.IO.Compression.ZipFile]::OpenRead($ZipFile)

    $binEntry = $zip.Entries | Where-Object { $_.FullName -match '/bin/(ffmpeg\.exe|ffprobe\.exe)$' } | Select-Object -First 1
    if (-not $binEntry) {
        $zip.Dispose()
        Write-Host "Available ffmpeg entries:" -ForegroundColor Red
        $zip.Entries | Where-Object { $_.Name -match 'ffmpeg' } | ForEach-Object { Write-Host "  $($_.FullName)" }
        Remove-Item $ZipFile -Force
        exit 1
    }

    $baseFolder = Split-Path (Split-Path $binEntry.FullName -Parent) -Parent
    Write-Host "  Archive folder: $baseFolder"

    foreach ($entry in $zip.Entries) {
        $normFull = $entry.FullName -replace '\\', '/'
        $relativePath = $normFull.Substring($baseFolder.Length).TrimStart('/')

        if ([string]::IsNullOrWhiteSpace($relativePath)) { continue }

        $outPath = Join-Path $TargetDir $relativePath
        $outDir = Split-Path $outPath -Parent

        if (-not (Test-Path $outDir)) {
            New-Item -ItemType Directory -Path $outDir -Force | Out-Null
        }

        $fileName = Split-Path $relativePath -Leaf
        if ($fileName -match '^(ffmpeg\.exe|ffprobe\.exe|pthreadGC-?2\.dll)$') {
            [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $outPath, $true)
            $size = (Get-Item $outPath).Length / 1MB
            Write-Host "  Extracted: $fileName ($('{0:N1}' -f $size) MB)"
        }
    }

    $zip.Dispose()
} catch {
    Write-Host "Extract failed: $_" -ForegroundColor Red
    if ($zip) { $zip.Dispose() }
    Remove-Item $ZipFile -Force -ErrorAction SilentlyContinue
    exit 1
}

Remove-Item $ZipFile -Force

$ffmpegOk = Test-Path $ffmpegExe
$ffprobeOk = Test-Path $ffprobeExe

if ($ffmpegOk) {
    $ver = & $ffmpegExe -version 2>&1 | Select-Object -First 1
    Write-Host "  ffmpeg.exe: OK" -ForegroundColor Green
    Write-Host "    $ver"
} else {
    Write-Host "  ffmpeg.exe: MISSING" -ForegroundColor Red
    # Try bin/ subfolder (standard FFmpeg structure)
    $ffmpegBin = Join-Path $TargetDir "bin\ffmpeg.exe"
    $ffprobeBin = Join-Path $TargetDir "bin\ffprobe.exe"
    if ((Test-Path $ffmpegBin) -and (Test-Path $ffprobeBin)) {
        Write-Host "  (Files found in bin/ subfolder - standard FFmpeg structure)" -ForegroundColor Green
        $ffmpegOk = $true
        $ffprobeOk = $true
    }
}

if ($ffprobeOk) {
    Write-Host "  ffprobe.exe: OK" -ForegroundColor Green
} else {
    Write-Host "  ffprobe.exe: MISSING" -ForegroundColor Red
}

if ($ffmpegOk -and $ffprobeOk) {
    Write-Host ""
    Write-Host "Done! FFmpeg bundled successfully." -ForegroundColor Green
    Write-Host "Build the app: npm run electron:build"
    exit 0
} else {
    Write-Host ""
    Write-Host "ERROR: Some binaries missing." -ForegroundColor Red
    exit 1
}
