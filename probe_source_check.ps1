# Check SOURCE video for frame duplication / 1fps source content
$ffprobe = "D:\LOOP_COMPANY\HyperClip\resources\ffmpeg\bin\ffprobe.exe"
$ffmpeg = "D:\LOOP_COMPANY\HyperClip\resources\ffmpeg\bin\ffmpeg.exe"

$srcDir = "D:\HyperClip-Data\downloads"
$src = Get-ChildItem "$srcDir\*.mkv" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1

if (!$src) {
    $src = Get-ChildItem "$srcDir\*.mp4" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
}

if (!$src) {
    Write-Host "[ERROR] No source video found in $srcDir"
    exit 1
}

$srcPath = $src.FullName
Write-Host "SOURCE: $($src.Name)"
Write-Host "========================================"

# 1. Source properties
Write-Host "`n[1] SOURCE PROPERTIES:"
& $ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,width,height,r_frame_rate,avg_frame_rate,nb_frames,pix_fmt,bit_rate -of json -- $srcPath 2>&1 | ConvertFrom-Json | ConvertTo-Json -Depth 4

# 2. Source format
Write-Host "`n[2] SOURCE FORMAT:"
& $ffprobe -v error -show_entries format=duration,size -of default=noprint_wrappers=1 -- $srcPath 2>&1

# 3. CRITICAL: Check for frame duplication in SOURCE
# Extract frames at evenly-spaced intervals and compare
Write-Host "`n[3] SOURCE CONTENT CHECK (frame uniqueness):"
$tempDir = "$env:TEMP\source_check"
Remove-Item $tempDir -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $tempDir | Out-Null

$srcDurCmd = & $ffprobe -v error -show_entries format=duration -of csv=p=0 -- $srcPath 2>&1
$srcDur = [double]$srcDurCmd

# Extract frames every 10 seconds for full duration
$step = 10
$hashes = @{}
for ($t = 0; $t -lt $srcDur; $t += $step) {
    $out = "$tempDir\src_$([int]$t)s.png"
    & $ffmpeg -ss $t -i $srcPath -frames:v 1 -y $out 2>&1 | Out-Null
    if (Test-Path $out) {
        $h = (Get-FileHash $out -Algorithm MD5).Hash
        $hashes[[int]$t] = $h
        Write-Host "  t=$([int]$t)s: $h"
    }
}
$uniqueSrc = ($hashes.Values | Select-Object -Unique).Count
Write-Host "`n  UNIQUE SOURCE FRAMES: $uniqueSrc / $($hashes.Count) sampled"
if ($uniqueSrc -lt ($hashes.Count * 0.5)) {
    Write-Host "  WARNING: Source has very few unique frames!"
    Write-Host "  This means the SOURCE VIDEO ITSELF has minimal motion (e.g. static image + occasional update)"
} else {
    Write-Host "  OK: Source video has varying content"
}

# 4. Source keyframe pattern
Write-Host "`n[4] SOURCE KEYFRAME PATTERN (first 600s):"
$kfs = & $ffprobe -v error -select_streams v:0 -show_entries packet=pts_time,flags -read_intervals "%+#600" -of csv=p=0 -- $srcPath 2>&1 | Select-String "K"
if ($kfs) {
    $kfList = @()
    $kfs | ForEach-Object { $kfList += [double]($_.ToString().Split(',')[0]) }
    Write-Host "  First 10 keyframes:"
    $kfList[0..[Math]::Min(9, $kfList.Count-1)] | ForEach-Object { Write-Host "    t=$($_)s" }
    if ($kfList.Count -gt 1) {
        $diffs = @()
        for ($i = 1; $i -lt $kfList.Count; $i++) {
            $diffs += [Math]::Round($kfList[$i] - $kfList[$i-1], 3)
        }
        Write-Host "  Keyframe intervals: $($diffs -join ', ')"
        Write-Host "  Min/Max/Avg interval: $($diffs | Measure-Object -Minimum -Maximum -Average | ForEach-Object { "$($_.Minimum)s / $($_.Maximum)s / $([Math]::Round($_.Average,2))s" })"
    }
}

# 5. Check output video more carefully
Write-Host "`n[5] OUTPUT VIDEO KEYFRAME ANALYSIS:"
$outDir = "D:\HyperClip-Data\archived"
$out = Get-ChildItem "$outDir\*.mp4" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($out) {
    Write-Host "  Output: $($out.Name)"

    # Get ALL keyframe timestamps
    $allKf = & $ffprobe -v error -select_streams v:0 -show_entries packet=pts_time,flags -of csv=p=0 -- $out.FullName 2>&1 | Select-String "K"
    if ($allKf) {
        $kfTs = @()
        $allKf | ForEach-Object { $kfTs += [double]($_.ToString().Split(',')[0]) }
        Write-Host "  Total keyframes: $($kfTs.Count)"

        # Check GOP interval consistency
        $gopDiffs = @()
        for ($i = 1; $i -lt $kfTs.Count; $i++) {
            $gopDiffs += [Math]::Round($kfTs[$i] - $kfTs[$i-1], 3)
        }
        if ($gopDiffs.Count -gt 0) {
            Write-Host "  GOP intervals: min=$($gopDiffs | Measure-Object -Minimum).Minimum s, max=$($gopDiffs | Measure-Object -Maximum).Maximum s, avg=$([Math]::Round(($gopDiffs | Measure-Object -Average).Average, 2)) s"
        }

        # Check for irregular keyframe spacing (sign of frame drops/repeats)
        $largeGops = $gopDiffs | Where-Object { $_ -gt 10 }
        if ($largeGops.Count -gt 0) {
            Write-Host "  LARGE GOP GAPS (>10s): $($largeGops.Count) instances"
            $largeGops | ForEach-Object { Write-Host "    -> $($_)s gap" }
        }
    }
}

# 6. NVENC params being used
Write-Host "`n[6] NVENC ENCODER PARAMS:"
Write-Host "  From getNvencParams (isChunked=false, codec=h264, tier=high)"
Write-Host "  -preset p3 -rc vbr_hq -cq 20 -tune hq -bf 0 -refs 1"
Write-Host "  -reconnect 1 -maxrate 5000k -bufsize 5000k"
Write-Host "  Single-pass params: -rc-lookahead 16 -spatial-aq 1 -aq-strength 9"

# 7. Test: re-encode output with different settings to isolate issue
Write-Host "`n[7] RE-ENCODE TEST (libx264, CRF 18, to isolate NVENC issue):"
$reencodeOut = "$tempDir\reencode_test.mp4"
$sw = [Diagnostics.Stopwatch]::StartNew()
& $ffmpeg -i $out.FullName -c:v libx264 -preset medium -crf 18 -c:a copy -y $reencodeOut 2>&1 | Where-Object { $_ -match "fps=" -or $_ -match "error" -or $_ -match "Error" }
$sw.Stop()
Write-Host "  Re-encode time: $($sw.ElapsedMilliseconds)ms"

# Extract frames from re-encoded version
Write-Host "`n[8] RE-ENCODED CONTENT CHECK:"
$rehashes = @{}
foreach ($t in @(0, 30, 60, 120, 180, 240, 300)) {
    $frameOut = "$tempDir\re_$($t)s.png"
    & $ffmpeg -ss $t -i $reencodeOut -frames:v 1 -y $frameOut 2>&1 | Out-Null
    if (Test-Path $frameOut) {
        $rh = (Get-FileHash $frameOut -Algorithm MD5).Hash
        $rehashes[$t] = $rh
        Write-Host "  t=$($t)s: $rh"
    }
}
$reUnique = ($rehashes.Values | Select-Object -Unique).Count
Write-Host "`n  UNIQUE RE-ENCODED FRAMES: $reUnique / $($rehashes.Count)"

# 8. Compare: are output and re-encoded frames same?
Write-Host "`n[9] FRAME COMPARISON (output vs re-encoded):"
$sameCount = 0
foreach ($t in $hashes.Keys) {
    if ($rehashes[$t] -and $hashes[$t] -eq $rehashes[$t]) {
        $sameCount++
        Write-Host "  t=$($t)s: MATCH (frames identical between output and re-encoded)"
    }
}
if ($sameCount -eq 0) {
    Write-Host "  Frames are DIFFERENT between output and re-encoded"
    Write-Host "  This means FFmpeg processing CHANGES the content"
}

Write-Host "`n========================================"
Write-Host "Done. Files: $tempDir"
