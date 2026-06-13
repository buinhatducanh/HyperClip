$ffprobe = Join-Path $PSScriptRoot "..\..\resources\ffmpeg\bin\ffprobe.exe"
$ffmpeg = Join-Path $PSScriptRoot "..\..\resources\ffmpeg\bin\ffmpeg.exe"

# Check archived dir
$dataDir = $env:HYPERCLIP_DATA_DIR
if (-not $dataDir) {
    if (Test-Path "D:\HyperClip-Data") {
        $dataDir = "D:\HyperClip-Data"
    } elseif (Test-Path "C:\HyperClip-Data") {
        $dataDir = "C:\HyperClip-Data"
    } else {
        $dataDir = Join-Path $PSScriptRoot "..\..\data"
    }
}
$archived = Join-Path $dataDir "archived"
if (Test-Path $archived) {
    $files = Get-ChildItem $archived -Filter "*.mp4" -EA SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 3
    if ($files) {
        $files | ForEach-Object {
            Write-Host "ARCHIVED: $($_.FullName)" -ForegroundColor Cyan
            $sizeMB = [Math]::Round($_.Length / 1MB, 1)
            Write-Host "  Size: $sizeMB MB  Time: $($_.LastWriteTime)"
        }
    } else {
        Write-Host "No archived MP4 files found."
    }
} else {
    Write-Host "Archived dir not found: $archived"
}

# Check output dir
$output = Join-Path $dataDir "output"
if (Test-Path $output) {
    $outs = Get-ChildItem $output -Filter "*.mp4" -Recurse -EA SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 3
    if ($outs) {
        $outs | ForEach-Object {
            Write-Host "OUTPUT: $($_.FullName)" -ForegroundColor Yellow
            $sizeMB = [Math]::Round($_.Length / 1MB, 1)
            Write-Host "  Size: $sizeMB MB"
        }
    } else {
        Write-Host "No output MP4 files."
    }
}

# Probe most recent archived file
$f = Get-ChildItem $archived -Filter "*.mp4" -EA SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($f) {
    Write-Host ""
    Write-Host "=== PROBE: $($f.Name) ===" -ForegroundColor Green
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $ffprobe
    $psi.Arguments = "-v error -show_entries format=duration,size:stream=codec_name,width,height,r_frame_rate,avg_frame_rate,pix_fmt -of default=noprint_wrappers=1 -- $($f.FullName)"
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true
    $proc = [System.Diagnostics.Process]::Start($psi)
    $out = $proc.StandardOutput.ReadToEnd()
    $proc.WaitForExit()
    Write-Host $out
    if ($out -match "r_frame_rate=(\d+)/(\d+)") {
        $fps = [Math]::Round([double]$Matches[1] / [double]$Matches[2], 2)
        Write-Host "FPS: $fps" -ForegroundColor Green
    }
}
