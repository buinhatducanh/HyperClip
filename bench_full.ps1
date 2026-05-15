# Test FULL render pipeline WITHOUT drawtext (focus: decode + scale + overlay)
$ff = "D:\LOOP_COMPANY\HyperClip\resources\ffmpeg\bin\ffmpeg.exe"
$src = "D:\HyperClip-Data\downloads\ws-1778818913969-nyae9.mp4"
$bg = "D:\HyperClip-Data\downloads\thumb_ws-1778818913969-nyae9.jpg"
if (-not (Test-Path $src)) {
    $mp4 = Get-ChildItem "D:\HyperClip-Data\downloads\*.mp4" -EA SilentlyContinue | Select-Object -First 1
    if ($mp4) { $src = $mp4.FullName }
}
if (-not (Test-Path $bg)) {
    $jpg = Get-ChildItem "D:\HyperClip-Data\downloads\thumb_*.jpg" -EA SilentlyContinue | Select-Object -First 1
    if ($jpg) { $bg = $jpg.FullName }
}
Write-Host "Source: $src"
Write-Host "Background: $bg"
Write-Host ""

# Pipeline A: CUDA decode + CUDA overlay + NVENC encode (full GPU pipeline)
Write-Host "=== A: h264_cuvid + overlay_cuda + h264_nvenc ===" -ForegroundColor Cyan
$sw = [Diagnostics.Stopwatch]::StartNew()
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $ff
$psi.Arguments = "-c:v h264_cuvid -i `"$src`" -i `"$bg`" -t 30 -filter_complex `"[0:v]scale=-2:960,format=yuv420p,fps=30,crop=1080:960:313:0[vid];[1:v]scale=1080:1920:force_original_aspect_ratio=decrease,format=yuv420p[bg];[bg][vid]overlay_cuda=0:480[vz]`" -map `"[vz]`" -c:v h264_nvenc -preset fast -y `"$env:TEMP\fullA.mp4`""
$psi.UseShellExecute = $false; $psi.RedirectStandardError = $true; $psi.CreateNoWindow = $true
$proc = [System.Diagnostics.Process]::Start($psi)
$stderr = $proc.StandardError.ReadToEnd()
$proc.WaitForExit()
$sw.Stop()
$sz = (Get-Item "$env:TEMP\fullA.mp4" -EA SilentlyContinue).Length
Write-Host "Time: $($sw.ElapsedMilliseconds)ms for 30s = $([Math]::Round($sw.ElapsedMilliseconds/30,1))ms/s"
Write-Host "Speed: $([Math]::Round(30000/$sw.ElapsedMilliseconds,2))x real-time  Exit:$($proc.ExitCode) Size:$sz"
$stderr -split "`n" | Where-Object { $_ -match 'fps.*fps|speed' } | Select-Object -Last 2 | ForEach-Object { Write-Host "  $_" }

Write-Host ""

# Pipeline B: CPU decode + CPU overlay + NVENC encode
Write-Host "=== B: h264 + overlay + h264_nvenc ===" -ForegroundColor Cyan
$sw2 = [Diagnostics.Stopwatch]::StartNew()
$psi2 = New-Object System.Diagnostics.ProcessStartInfo
$psi2.FileName = $ff
$psi2.Arguments = "-c:v h264 -i `"$src`" -i `"$bg`" -t 30 -filter_complex `"[0:v]scale=-2:960,format=yuv420p,fps=30,crop=1080:960:313:0[vid];[1:v]scale=1080:1920:force_original_aspect_ratio=decrease,format=yuv420p[bg];[bg][vid]overlay=0:480[vz]`" -map `"[vz]`" -c:v h264_nvenc -preset fast -y `"$env:TEMP\fullB.mp4`""
$psi2.UseShellExecute = $false; $psi2.RedirectStandardError = $true; $psi2.CreateNoWindow = $true
$proc2 = [System.Diagnostics.Process]::Start($psi2)
$stderr2 = $proc2.StandardError.ReadToEnd()
$proc2.WaitForExit()
$sw2.Stop()
$sz2 = (Get-Item "$env:TEMP\fullB.mp4" -EA SilentlyContinue).Length
Write-Host "Time: $($sw2.ElapsedMilliseconds)ms for 30s = $([Math]::Round($sw2.ElapsedMilliseconds/30,1))ms/s"
Write-Host "Speed: $([Math]::Round(30000/$sw2.ElapsedMilliseconds,2))x real-time  Exit:$($proc2.ExitCode) Size:$sz2"
$stderr2 -split "`n" | Where-Object { $_ -match 'fps.*fps|speed' } | Select-Object -Last 2 | ForEach-Object { Write-Host "  $_" }

Write-Host ""
Write-Host "=== CUDA speedup vs CPU: $([Math]::Round($sw2.ElapsedMilliseconds/$sw.ElapsedMilliseconds,2))x faster ===" -ForegroundColor Green
