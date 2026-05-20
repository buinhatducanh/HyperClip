# Probe latest output video - check frame structure, timestamps, fps
$ffprobe = "D:\LOOP_COMPANY\HyperClip\resources\ffmpeg\bin\ffprobe.exe"
$ffmpeg = "D:\LOOP_COMPANY\HyperClip\resources\ffmpeg\bin\ffmpeg.exe"
$archived = "D:\HyperClip-Data\archived"

if (!(Test-Path $archived)) {
    Write-Host "[ERROR] Archived folder not found: $archived"
    exit 1
}

# Find latest mp4
$latest = Get-ChildItem "$archived\*.mp4" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (!$latest) {
    Write-Host "[ERROR] No mp4 files found in $archived"
    exit 1
}
$output = $latest.FullName
Write-Host "========================================"
Write-Host "PROBING: $($latest.Name)"
Write-Host "========================================"

# 1. Stream info
Write-Host "`n[1] STREAM METADATA:"
& $ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,codec_type,width,height,r_frame_rate,avg_frame_rate,nb_frames,pix_fmt,bit_rate -of json -- $output 2>&1 | ConvertFrom-Json | ConvertTo-Json -Depth 5

# 2. Format info
Write-Host "`n[2] FORMAT (duration/size/bitrate):"
& $ffprobe -v error -show_entries format=duration,size,bit_rate -of default=noprint_wrappers=1 -- $output 2>&1

# 3. Frame timestamps - first 10 packets
Write-Host "`n[3] FIRST 10 FRAME TIMESTAMPS (pts_time):"
& $ffprobe -v error -select_streams v:0 -show_entries packet=pts_time,pkt_size,flags -read_intervals "%+#10" -of csv=p=0 -- $output 2>&1

# 4. Keyframe positions (first 120s)
Write-Host "`n[4] KEYFRAME POSITIONS (first 120s, K=keyframe):"
& $ffprobe -v error -select_streams v:0 -show_entries packet=pts_time,flags -read_intervals "%+#120" -of csv=p=0 -- $output 2>&1 | Select-String "K"

# 5. Decode speed test
Write-Host "`n[5] DECODE SPEED (300 frames):"
$sw = [Diagnostics.Stopwatch]::StartNew()
& $ffmpeg -i $output -frames:v 300 -f null - 2>&1 | Where-Object { $_ -match "fps=" }
Write-Host "  Elapsed: $($sw.ElapsedMilliseconds)ms"

# 6. Extract frames at 0, 5, 10 seconds
$tempDir = "$env:TEMP\frame_check"
Remove-Item $tempDir -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $tempDir | Out-Null

Write-Host "`n[6] EXTRACTING FRAMES AT 0s, 5s, 10s:"
$hashes = @{}
foreach ($t in @(0, 5, 10)) {
    $out = "$tempDir\frame_$($t)s.png"
    Write-Host "  t=$($t)s..."
    & $ffmpeg -ss $t -i $output -frames:v 1 -y $out 2>&1 | Out-Null
    if (Test-Path $out) {
        $h = (Get-FileHash $out -Algorithm MD5).Hash
        $hashes[$t] = $h
        Write-Host "    -> MD5: $h"
    } else {
        Write-Host "    -> FAILED"
    }
}
if ($hashes.Count -eq 3) {
    if ($hashes[0] -eq $hashes[5] -and $hashes[5] -eq $hashes[10]) {
        Write-Host "  ALL FRAMES SAME HASH -> ALL FRAMES IDENTICAL -> CONFIRMED: VIDEO IS STATIC"
    } else {
        Write-Host "  FRAMES ARE DIFFERENT -> video content is changing"
    }
}

Write-Host "`n========================================"
Write-Host "Done. Frames at: $tempDir"
