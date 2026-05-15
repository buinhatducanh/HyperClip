# Deep probe - bitrate over time, keyframe analysis, source comparison
$ffprobe = "D:\LOOP_COMPANY\HyperClip\resources\ffmpeg\bin\ffprobe.exe"
$ffmpeg = "D:\LOOP_COMPANY\HyperClip\resources\ffmpeg\bin\ffmpeg.exe"

# Find latest output
$output = Get-ChildItem "D:\HyperClip-Data\archived\*.mp4" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1 | ForEach-Object { $_.FullName }
if (!$output) { Write-Host "[ERROR] No files"; exit 1 }

Write-Host "FILE: $output"
Write-Host "========================================"

# 1. Frame sizes over time - check for bitrate spikes
Write-Host "`n[1] FRAME SIZES (every 100 frames, shows bitrate variation):"
& $ffprobe -v error -select_streams v:0 -show_entries packet=pkt_size,pts_time,flags -of csv=p=0 -- $output 2>&1 | Select-Object -First 300 | ForEach-Object -Begin { $i = 0 } {
    $i++
    if ($i % 100 -eq 0) {
        $parts = $_.Split(',')
        $pts = [double]$parts[0]
        $size = [int]$parts[1]
        $flags = $parts[2]
        Write-Host "  frame $($i): t=$(($pts).ToString('F2'))s size=$($size)B flags=$flags"
    }
}

# 2. Full keyframe analysis
Write-Host "`n[2] ALL KEYFRAMES IN VIDEO (K=keyframe):"
$kfOut = & $ffprobe -v error -select_streams v:0 -show_entries packet=pts_time,pkt_size,flags -of csv=p=0 -- $output 2>&1 | Select-String "K"
if ($kfOut) {
    $kfOut | ForEach-Object { Write-Host "  $_" }
    $count = ($kfOut | Measure-Object).Count
    Write-Host "  TOTAL KEYFRAMES: $count"
} else {
    Write-Host "  No keyframes found in first section"
}

# 3. Check source video for comparison
Write-Host "`n[3] SOURCE VIDEO PROBE:"
$src = Get-ChildItem "D:\HyperClip-Data\downloads\*.mkv" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1 | ForEach-Object { $_.FullName }
if ($src) {
    Write-Host "  Source: $src"
    & $ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,width,height,r_frame_rate,bit_rate -of default=noprint_wrappers=1 -- $src 2>&1
    Write-Host "  Source keyframes:"
    & $ffprobe -v error -select_streams v:0 -show_entries packet=pts_time,flags -read_intervals "%+#600" -of csv=p=0 -- $src 2>&1 | Select-String "K" | Select-Object -First 10
} else {
    Write-Host "  Source not found at downloads, searching..."
    Get-ChildItem "D:\HyperClip-Data\downloads\" -ErrorAction SilentlyContinue | Select-Object -First 5
}

# 4. Test: decode with software decoder vs hardware
Write-Host "`n[4] DECODE TEST (libavcodec software, 300 frames):"
$sw = [Diagnostics.Stopwatch]::StartNew()
& $ffmpeg -vcodec h264 -i $output -frames:v 300 -f null - 2>&1 | Where-Object { $_ -match "fps=" }
Write-Host "  Elapsed: $($sw.ElapsedMilliseconds)ms (software decode)"

# 5. Extract frame hashes to verify video is not stuck
Write-Host "`n[5] CONTENT VERIFICATION - 10 evenly-spaced frames:"
$tempDir = "$env:TEMP\frame_check2"
Remove-Item $tempDir -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $tempDir | Out-Null

$duration = 600.0
$hashes = @{}
foreach ($t in @(0, 30, 60, 120, 180, 240, 300, 360, 420, 480)) {
    $out = "$tempDir\f_$($t)s.png"
    & $ffmpeg -ss $t -i $output -frames:v 1 -y $out 2>&1 | Out-Null
    if (Test-Path $out) {
        $h = (Get-FileHash $out -Algorithm MD5).Hash
        $hashes[$t] = $h
        Write-Host "  t=$($t)s: $h"
    }
}

$uniqueHashes = ($hashes.Values | Select-Object -Unique).Count
Write-Host "`n  UNIQUE HASHES: $uniqueHashes / 10"
if ($uniqueHashes -lt 3) {
    Write-Host "  WARNING: Very few unique frames - video may be mostly static!"
} else {
    Write-Host "  OK: Video has varying content"
}

# 6. Check if trim is causing issues - compare with unfiltered decode
Write-Host "`n[6] UNFILTERED DECODE (no seeking, first 60 frames):"
$sw2 = [Diagnostics.Stopwatch]::StartNew()
& $ffmpeg -i $output -frames:v 60 -f null - 2>&1 | Where-Object { $_ -match "fps=" }
Write-Host "  Elapsed: $($sw2.ElapsedMilliseconds)ms"

Write-Host "`n========================================"
Write-Host "Done. Check frame hashes above - if most are same -> video is broken"
Write-Host "If all are different -> video is fine, playback issue is player/system"
