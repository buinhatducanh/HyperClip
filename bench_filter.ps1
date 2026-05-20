# Test exact filter chain from actual render: scale + format + fps + crop
$ff = "D:\LOOP_COMPANY\HyperClip\resources\ffmpeg\bin\ffmpeg.exe"
$src = "D:\HyperClip-Data\downloads\ws-1778818913969-nyae9.mp4"
if (-not (Test-Path $src)) {
    $mp4 = Get-ChildItem "D:\HyperClip-Data\downloads\*.mp4" -EA SilentlyContinue | Select-Object -First 1
    if ($mp4) { $src = $mp4.FullName }
}
if (-not (Test-Path $src)) { Write-Host "No video found. Exit."; exit }

Write-Host "Source: $src"
Write-Host ""

# Test 1: CUVID decode -> exact filter chain -> NVENC encode (full GPU pipeline)
Write-Host "=== A: h264_cuvid -> scale_cuda,format,fps,crop -> h264_nvenc ===" -ForegroundColor Cyan
$sw = [Diagnostics.Stopwatch]::StartNew()
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $ff
$psi.Arguments = "-c:v h264_cuvid -i `"$src`" -t 30 -vf `"scale=-2:960,format=yuv420p,fps=30,crop=1080:960:313:0`" -c:v h264_nvenc -preset fast -y `"$env:TEMP\bench_cuvid.mp4`""
$psi.UseShellExecute = $false; $psi.RedirectStandardError = $true; $psi.CreateNoWindow = $true
$proc = [System.Diagnostics.Process]::Start($psi)
$stderr = $proc.StandardError.ReadToEnd()
$proc.WaitForExit()
$sw.Stop()
$sz = (Get-Item "$env:TEMP\bench_cuvid.mp4" -EA SilentlyContinue).Length
Write-Host "Time: $($sw.ElapsedMilliseconds)ms for 30s video = $([Math]::Round($sw.ElapsedMilliseconds/30,1))ms per second"
Write-Host "Speed: $([Math]::Round(30000/$sw.ElapsedMilliseconds,2))x real-time"
$stderr -split "`n" | Where-Object { $_ -match 'fps|speed|frame.*fps' } | Select-Object -Last 3 | ForEach-Object { Write-Host "  $_" }

Write-Host ""

# Test 2: CPU decode -> exact filter chain -> NVENC encode (GPU encode only)
Write-Host "=== B: h264 -> scale,format,fps,crop -> h264_nvenc ===" -ForegroundColor Cyan
$sw2 = [Diagnostics.Stopwatch]::StartNew()
$psi2 = New-Object System.Diagnostics.ProcessStartInfo
$psi2.FileName = $ff
$psi2.Arguments = "-c:v h264 -i `"$src`" -t 30 -vf `"scale=-2:960,format=yuv420p,fps=30,crop=1080:960:313:0`" -c:v h264_nvenc -preset fast -y `"$env:TEMP\bench_cpu.mp4`""
$psi2.UseShellExecute = $false; $psi2.RedirectStandardError = $true; $psi2.CreateNoWindow = $true
$proc2 = [System.Diagnostics.Process]::Start($psi2)
$stderr2 = $proc2.StandardError.ReadToEnd()
$proc2.WaitForExit()
$sw2.Stop()
$sz2 = (Get-Item "$env:TEMP\bench_cpu.mp4" -EA SilentlyContinue).Length
Write-Host "Time: $($sw2.ElapsedMilliseconds)ms for 30s video = $([Math]::Round($sw2.ElapsedMilliseconds/30,1))ms per second"
Write-Host "Speed: $([Math]::Round(30000/$sw2.ElapsedMilliseconds,2))x real-time"
$stderr2 -split "`n" | Where-Object { $_ -match 'fps|speed|frame.*fps' } | Select-Object -Last 3 | ForEach-Object { Write-Host "  $_" }

Write-Host ""
Write-Host "=== Speedup: $([Math]::Round($sw2.ElapsedMilliseconds/$sw.ElapsedMilliseconds, 2))x faster with CUDA decode ===" -ForegroundColor Green
