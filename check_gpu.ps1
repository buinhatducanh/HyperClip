$ff = "D:\LOOP_COMPANY\HyperClip\resources\ffmpeg\bin\ffmpeg.exe"
Write-Host "=== NVDEC decoders ===" -ForegroundColor Cyan
& $ff -hide_banner -decoders 2>&1 | Select-String "nvdec"

Write-Host ""
Write-Host "=== CUVID decoders ===" -ForegroundColor Cyan
& $ff -hide_banner -decoders 2>&1 | Select-String "cuvid"

Write-Host ""
Write-Host "=== NVDEC hardware test ===" -ForegroundColor Cyan
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $ff
$psi.Arguments = "-c:v h264_nvdec -i `"$env:TEMP\test.mp4`" -frames:v 1 -y `"$env:TEMP\nvdec_test.png`""
$psi.UseShellExecute = $false
$psi.RedirectStandardError = $true
$psi.CreateNoWindow = $true
$proc = [System.Diagnostics.Process]::Start($psi)
$stderr = $proc.StandardError.ReadToEnd()
$proc.WaitForExit()
Write-Host "Exit: $($proc.ExitCode)"
$stderr -split "`n" | Where-Object { $_ -match "nvdec|cuvid|nvenc|Error|error" } | Select-Object -First 5 | ForEach-Object { Write-Host $_ }

Write-Host ""
Write-Host "=== NVIDIA GPU info ===" -ForegroundColor Cyan
nvidia-smi -L 2>&1 | ForEach-Object { Write-Host $_ }
nvidia-smi --query-gpu=name,driver_version,cuda_version --format=csv,noheader 2>&1 | ForEach-Object { Write-Host $_ }
