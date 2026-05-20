$ffprobe = "D:\LOOP_COMPANY\HyperClip\resources\ffmpeg\bin\ffprobe.exe"
$f = Get-ChildItem "D:\HyperClip-Data\archived\*.mp4" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $f) { Write-Host "No archived video found."; exit }
Write-Host "File: $($f.FullName)"
Write-Host "Size: $([Math]::Round($f.Length/1MB)) MB"
Write-Host ""

# Video
$result = & $ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,width,height,r_frame_rate,avg_frame_rate,pix_fmt,duration -of default=noprint_wrappers=1 $f.FullName 2>&1
Write-Host "=== VIDEO ==="
$result | ForEach-Object { Write-Host $_ }

# Audio
$result2 = & $ffprobe -v error -select_streams a:0 -show_entries stream=codec_name,sample_rate,channels -of default=noprint_wrappers=1 $f.FullName 2>&1
Write-Host ""
Write-Host "=== AUDIO ==="
if ($result2) { $result2 | ForEach-Object { Write-Host $_ } } else { Write-Host "(NO AUDIO)" -ForegroundColor Red }

# Calculate
Write-Host ""
Write-Host "=== Analysis ==="
$fpsLine = $result | Where-Object { $_ -match "r_frame_rate" }
$fps = $fpsLine.Split("=")[1]
$fpsValue = [Math]::Round([double]$fps.Split("/")[0] / [double]$fps.Split("/")[1], 2)
Write-Host "Frame rate: $fpsValue fps"
$durLine = $result | Where-Object { $_ -match "duration=" }
$duration = [Math]::Round([double]$durLine.Split("=")[1], 2)
$totalFrames = [Math]::Round($fpsValue * $duration)
Write-Host "Duration: $duration seconds"
Write-Host "Total frames: $totalFrames"
Write-Host "Expected: $duration s x $fpsValue fps = $totalFrames frames"
