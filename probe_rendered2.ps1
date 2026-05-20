$ffmpeg = "D:\LOOP_COMPANY\HyperClip\resources\ffmpeg\bin\ffmpeg.exe"
$archived = "D:\HyperClip-Data\archived"
$outDir = "D:\HyperClip-Data\output"

# Find most recent rendered video
$v = Get-ChildItem $archived -Filter "*.mp4" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $v) {
    $v = Get-ChildItem $outDir -Filter "*_output.mp4" -Recurse -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
}
if (-not $v) { Write-Host "No rendered video found"; exit }

$file = $v.FullName
Write-Host "File: $($v.Name)"
Write-Host "Size: $([Math]::Round($v.Length / 1MB)) MB"

# Probe video stream
$result = & $ffmpeg -v error -select_streams v:0 -show_entries stream=codec_name,width,height,r_frame_rate,avg_frame_rate,pix_fmt -of default=noprint_wrappers=1 -- $file 2>&1
Write-Host ""
Write-Host "=== VIDEO STREAM ==="
Write-Host $result

# Check audio
$result2 = & $ffmpeg -v error -select_streams a -show_entries stream=codec_name,sample_rate -of default=noprint_wrappers=1 -- $file 2>&1
if ($result2) {
    Write-Host ""
    Write-Host "=== AUDIO ==="
    Write-Host $result2
} else {
    Write-Host ""
    Write-Host "AUDIO: NONE"
}

# Decode 60 frames and check speed
Write-Host ""
Write-Host "=== DECODE 60 FRAMES ==="
$err = & $ffmpeg -i $file -frames:v 60 -f null - 2>&1 | Select-String "fps|speed"
$err | ForEach-Object { Write-Host $_ }

# Extract frames at t=0,5,10s and check they're different
Write-Host ""
Write-Host "=== FRAME SAMPLES ==="
$hashes = @()
foreach ($t in @(0, 5, 10)) {
    $out = "$env:TEMP\hc_f_$(Get-Random).png"
    $exit = & $ffmpeg -ss $t -i $file -frames:v 1 -y $out 2>&1 | Out-Null
    if ((Test-Path $out) -and (Get-Item $out).Length -gt 1000) {
        $hash = (Get-FileHash $out -Algorithm MD5).Hash.Substring(0, 8)
        $sz = (Get-Item $out).Length
        Write-Host "t=$($t)s: $($sz) bytes hash=$($hash)"
        $hashes += $hash
        Remove-Item $out -Force
    } else {
        Write-Host "t=$($t)s: FAILED"
    }
}
if ($hashes.Count -gt 0) {
    $unique = ($hashes | Select-Object -Unique).Count
    Write-Host ""
    Write-Host "Unique frames: $unique / $($hashes.Count)"
    if ($unique -le 1) {
        Write-Host "ALL FRAMES IDENTICAL -> PLAYBACK AT 1FPS SOURCE" -ForegroundColor Red
    } else {
        Write-Host "Frames are different -> Playback should be OK" -ForegroundColor Green
    }
}
