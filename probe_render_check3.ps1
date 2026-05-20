# Test render by creating a minimal test with the same filter chain
$ffmpeg = "D:\LOOP_COMPANY\HyperClip\resources\ffmpeg\bin\ffmpeg.exe"
$tempDir = "$env:TEMP\hyperclip_test"

Write-Host "Creating minimal test video (1920x1080, 30fps, 30s)..."
New-Item -ItemType Directory -Force -Path $tempDir | Out-Null

# Create a test source video using FFmpeg lavfi (no source needed)
$testSrc = "$tempDir\test_src.mp4"
& $ffmpeg -f lavfi -i testsrc2=size=1920x1080:rate=30:duration=30 -c:v libx264 -preset ultrafast -g 30 -y $testSrc 2>&1 | Out-Null

Write-Host "Source: $testSrc"
& "D:\LOOP_COMPANY\HyperClip\resources\ffmpeg\bin\ffprobe.exe" -v error -select_streams v:0 -show_entries stream=codec_name,width,height,r_frame_rate -of default=noprint_wrappers=1 -- $testSrc 2>&1

# Create a test "thumbnail" (blurred version of testsrc)
$testThumb = "$tempDir\test_thumb.jpg"
& $ffmpeg -f lavfi -i testsrc2=size=1920x1080:rate=30:duration=1 -vf scale=1080:1920,boxblur=20 -frames:v 1 -y $testThumb 2>&1 | Out-Null
Write-Host "Thumbnail: $testThumb"

# Now test the ACTUAL filter chain used in the render
$testOutput = "$tempDir\test_output.mp4"
$filterChain = "[0:v]trim=start=0:duration=30,setpts=PTS-STARTPTS,scale=-2:960,fps=30,crop=1080:960:313:0[vid];[1:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920:(ow-iw)/2:(oh-ih)/2[bg];[bg][vid]overlay=0:480[vz];[vz]drawtext=text='PART 1':fontsize=144:fontcolor=white:borderw=2:bordercolor=#00B4FF:x=(w-text_w)/2:y=(h-text_h)/2:fontfile=C:/Windows/Fonts/arial.ttf[out]"

Write-Host "`nRunning filter chain test..."
Write-Host "Filter: $filterChain`n"

& $ffmpeg -threads 4 -i $testSrc -i $testThumb -filter_complex $filterChain -map '[out]' -c:v libx264 -preset ultrafast -crf 18 -g 30 -y $testOutput 2>&1 | Where-Object { $_ -match "fps=" -or $_ -match "Error" -or $_ -match "error" }

Write-Host "`nTest output: $testOutput"
if (Test-Path $testOutput) {
    Write-Host "`n[TEST VIDEO PROPERTIES]:"
    & "D:\LOOP_COMPANY\HyperClip\resources\ffmpeg\bin\ffprobe.exe" -v error -select_streams v:0 -show_entries stream=codec_name,width,height,r_frame_rate,nb_frames -of default=noprint_wrappers=1 -- $testOutput 2>&1

    # Extract frames from test output
    $hashes = @{}
    foreach ($t in @(0, 5, 10, 15)) {
        $out = "$tempDir\test_frame_$($t)s.png"
        & $ffmpeg -ss $t -i $testOutput -frames:v 1 -y $out 2>&1 | Out-Null
        if (Test-Path $out) {
            $h = (Get-FileHash $out -Algorithm MD5).Hash
            $hashes[$t] = $h
            Write-Host "  t=$($t)s: $h"
        }
    }
    if (($hashes.Values | Select-Object -Unique).Count -lt 2) {
        Write-Host "`nWARNING: Test frames mostly identical!"
    } else {
        Write-Host "`nOK: Test frames vary correctly"
    }

    # Decode test
    Write-Host "`n[DECODE TEST]:"
    & $ffmpeg -i $testOutput -frames:v 300 -f null - 2>&1 | Where-Object { $_ -match "fps=" }
} else {
    Write-Host "TEST OUTPUT NOT CREATED - filter chain error!"
}

Write-Host "`nDone. Test files: $tempDir"
