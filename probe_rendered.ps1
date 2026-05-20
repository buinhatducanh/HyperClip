$ffprobe = "D:\LOOP_COMPANY\HyperClip\resources\ffmpeg\bin\ffprobe.exe"
$ffmpeg = "D:\LOOP_COMPANY\HyperClip\resources\ffmpeg\bin\ffmpeg.exe"
$out = Get-ChildItem "D:\HyperClip-Data\archived\*.mp4" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $out) { Write-Host "No archived video found."; exit }
Write-Host "File: $($out.Name)" -ForegroundColor Cyan
Write-Host "Size: $([Math]::Round($out.Length/1MB)) MB"
Write-Host ""

# Probe video stream
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $ffprobe
$psi.Arguments = "-v error -select_streams v:0 -show_entries stream=codec_name,width,height,r_frame_rate,avg_frame_rate,pix_fmt,duration -of default=noprint_wrappers=1 -- $($out.FullName)"
$psi.UseShellExecute = $false; $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true; $psi.CreateNoWindow = $true
$proc = [System.Diagnostics.Process]::Start($psi)
$stdout = $proc.StandardOutput.ReadToEnd()
$proc.WaitForExit()
Write-Host "=== Video ===" -ForegroundColor Yellow
$stdout | ForEach-Object { Write-Host $_ }

# Probe audio
$psi2 = New-Object System.Diagnostics.ProcessStartInfo
$psi2.FileName = $ffprobe
$psi2.Arguments = "-v error -select_streams a:0 -show_entries stream=codec_name,sample_rate,channels,duration -of default=noprint_wrappers=1 -- $($out.FullName)"
$psi2.UseShellExecute = $false; $psi2.RedirectStandardOutput = $true; $psi2.RedirectStandardError = $true; $psi2.CreateNoWindow = $true
$proc2 = [System.Diagnostics.Process]::Start($psi2)
$stdout2 = $proc2.StandardOutput.ReadToEnd()
$proc2.WaitForExit()
Write-Host ""
Write-Host "=== Audio ===" -ForegroundColor Yellow
if ($stdout2) { $stdout2 | ForEach-Object { Write-Host $_ } } else { Write-Host "(NO AUDIO)" -ForegroundColor Red }

# Check frame rate by counting frames with ffmpeg
Write-Host ""
Write-Host "=== Frame analysis ===" -ForegroundColor Yellow
$psi3 = New-Object System.Diagnostics.ProcessStartInfo
$psi3.FileName = $ffmpeg
$psi3.Arguments = "-i `"$($out.FullName)`" -f null - 2>&1 | Select-String -Pattern 'fps|speed|frame'"
$psi3.UseShellExecute = $false; $psi3.RedirectStandardOutput = $true; $psi3.RedirectStandardError = $true; $psi3.CreateNoWindow = $true
$proc3 = [System.Diagnostics.Process]::Start($psi3)
$stdout3 = $proc3.StandardOutput.ReadToEnd()
$proc3.WaitForExit()
$stdout3 | Select-Object -First 5 | ForEach-Object { Write-Host $_ }

# Extract first 3 frames and check they are different
Write-Host ""
Write-Host "=== Frame comparison (check for duplicate frames) ===" -ForegroundColor Yellow
$psi4 = New-Object System.Diagnostics.ProcessStartInfo
$psi4.FileName = $ffmpeg
$psi4.Arguments = "-i `"$($out.FullName)`" -vf select=not(mod(n\,60)) -frames:v 6 -f image2 -y `"$env:TEMP\frame_%03d.png`""
$psi4.UseShellExecute = $false; $psi4.RedirectStandardError = $true; $psi4.CreateNoWindow = $true
$proc4 = [System.Diagnostics.Process]::Start($psi4)
$stderr4 = $proc4.StandardError.ReadToEnd()
$proc4.WaitForExit()
Get-ChildItem "$env:TEMP\frame_*.png" | ForEach-Object {
    $hash = (Get-FileHash $_.FullName -Algorithm MD5).Hash
    Write-Host "$($_.Name): $($_.Length) bytes, MD5: $($hash.Substring(0,8))..."
}
