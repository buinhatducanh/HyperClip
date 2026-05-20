$ffmpeg = "D:\LOOP_COMPANY\HyperClip\resources\ffmpeg\bin\ffmpeg.exe"

# Find latest video
$archived = "D:\HyperClip-Data\archived"
$videos = Get-ChildItem $archived -Filter "*.mp4" -EA SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $videos) {
    Write-Host "No videos found in archived folder."
    exit
}

$file = $videos.FullName
Write-Host "File: $file" -ForegroundColor Cyan
Write-Host ""

# Test 1: Decode first 10 frames and check timestamps
Write-Host "=== Test: Extract frames 0-9 and check timestamps ===" -ForegroundColor Yellow
$psi = [System.Diagnostics.ProcessStartInfo]::new()
$psi.FileName = $ffmpeg
$psi.Arguments = "-i `"$file`" -vf select=not(mod(n\,30)),showinfo -frames:v 10 -f null - 2>&1"
$psi.UseShellExecute = $false
$psi.RedirectStandardError = $true
$psi.CreateNoWindow = $true
$proc = [System.Diagnostics.Process]::Start($psi)
$stderr = $proc.StandardError.ReadToEnd()
$proc.WaitForExit()
$lines = $stderr -split "`n" | Where-Object { $_ -match "pts_time" }
Write-Host "Frame timestamps (first 10 with mod 30):"
$count = 0
foreach ($line in $lines) {
    if ($count -lt 10) {
        if ($line -match "pts_time=(\d+\.?\d*)") {
            Write-Host "  Frame: $($Matches[1])s"
            $count++
        }
    }
}

Write-Host ""

# Test 2: Decode first 60 frames without select filter and measure fps
Write-Host "=== Test: Decode 60 frames, check fps from speed report ===" -ForegroundColor Yellow
$psi2 = [System.Diagnostics.ProcessStartInfo]::new()
$psi2.FileName = $ffmpeg
$psi2.Arguments = "-i `"$file`" -frames:v 60 -f null - 2>&1"
$psi2.UseShellExecute = $false
$psi2.RedirectStandardError = $true
$psi2.CreateNoWindow = $true
$proc2 = [System.Diagnostics.Process]::Start($psi2)
$stderr2 = $proc2.StandardError.ReadToEnd()
$proc2.WaitForExit()
$fpsLines = $stderr2 -split "`n" | Where-Object { $_ -match "fps=" }
if ($fpsLines) {
    Write-Host "FPS from decode:"
    $fpsLines | Select-Object -Last 3 | ForEach-Object { Write-Host "  $_" }
}

# Test 3: Check actual frame content by extracting frame hashes
Write-Host ""
Write-Host "=== Test: Extract frames at 0s, 1s, 2s, 3s ===" -ForegroundColor Yellow
$sizes = @()
foreach ($sec in @(0, 1, 2, 3)) {
    $out = "$env:TEMP\frame_$sec.png"
    $psi3 = [System.Diagnostics.ProcessStartInfo]::new()
    $psi3.FileName = $ffmpeg
    $psi3.Arguments = "-ss $sec -i `"$file`" -frames:v 1 -y `"$out`" 2>&1 | Out-Null"
    $psi3.UseShellExecute = $false
    $psi3.RedirectStandardError = $true
    $psi3.CreateNoWindow = $true
    $proc3 = [System.Diagnostics.Process]::Start($psi3)
    $stderr3 = $proc3.StandardError.ReadToEnd()
    $proc3.WaitForExit()
    if (Test-Path $out) {
        $hash = (Get-FileHash $out -Algorithm MD5).Hash.Substring(0, 8)
        $sz = (Get-Item $out).Length
        Write-Host ("  t={0}s: {1} bytes MD5={2}" -f $sec, $sz, $hash)
        $sizes += $hash
    } else {
        Write-Host ("  t={0}s: FAILED" -f $sec)
    }
}
Write-Host ""
Write-Host "Unique frame hashes: $($sizes | Sort-Object -Unique.Count)/$($sizes.Count)"
if (($sizes | Sort-Object -Unique).Count -eq 1) {
    Write-Host "ALL FRAMES ARE IDENTICAL -> Video is 1 FPS source upsampled to 30fps container" -ForegroundColor Red
} else {
    Write-Host "Frames are different -> Video content is correct" -ForegroundColor Green
}
