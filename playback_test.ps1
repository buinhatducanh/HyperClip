# Quick playback check
$ffprobe = "D:\LOOP_COMPANY\HyperClip\resources\ffmpeg\bin\ffprobe.exe"

$out = Get-ChildItem "D:\HyperClip-Data\archived\*.mp4" -EA SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $out) { Write-Host "No archived video found."; exit }

Write-Host "=== $($out.Name) ===" -ForegroundColor Cyan
Write-Host "Size: $([Math]::Round($out.Length/1MB, 1)) MB"
Write-Host ""

# Video stream
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $ffprobe
$psi.Arguments = "-v error -select_streams v:0 -show_entries stream=codec_name,width,height,r_frame_rate,avg_frame_rate,pix_fmt,duration -of default=noprint_wrappers=1:nokey=1 -- $out.FullName"
$psi.UseShellExecute = $false
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.CreateNoWindow = $true
$proc = [System.Diagnostics.Process]::Start($psi)
$stdout = $proc.StandardOutput.ReadToEnd()
$proc.WaitForExit()
Write-Host "=== Video ==="
Write-Host $stdout

# Audio stream
$psi2 = New-Object System.Diagnostics.ProcessStartInfo
$psi2.FileName = $ffprobe
$psi2.Arguments = "-v error -select_streams a:0 -show_entries stream=codec_name,sample_rate,channels -of default=noprint_wrappers=1:nokey=1 -- $out.FullName"
$psi2.UseShellExecute = $false
$psi2.RedirectStandardOutput = $true
$psi2.RedirectStandardError = $true
$psi2.CreateNoWindow = $true
$proc2 = [System.Diagnostics.Process]::Start($psi2)
$stdout2 = $proc2.StandardOutput.ReadToEnd()
$proc2.WaitForExit()
Write-Host ""
Write-Host "=== Audio ==="
if ($stdout2) { Write-Host $stdout2 } else { Write-Host "(NO AUDIO STREAM)" -ForegroundColor Red }

# Stream all info
Write-Host ""
Write-Host "=== All streams ===" -ForegroundColor Cyan
$psi3 = New-Object System.Diagnostics.ProcessStartInfo
$psi3.FileName = $ffprobe
$psi3.Arguments = "-v error -show_streams -of json -- $out.FullName"
$psi3.UseShellExecute = $false
$psi3.RedirectStandardOutput = $true
$psi3.RedirectStandardError = $true
$psi3.CreateNoWindow = $true
$proc3 = [System.Diagnostics.Process]::Start($psi3)
$stdout3 = $proc3.StandardOutput.ReadToEnd()
$proc3.WaitForExit()
$info = $stdout3 | ConvertFrom-Json
foreach ($s in $info.streams) {
    Write-Host "  Stream #$($s.index): $($s.codec_type) - $($s.codec_name)"
    if ($s.codec_type -eq "video") {
        Write-Host "    Resolution: $($s.width)x$($s.height)"
        Write-Host "    Frame rate: $($s.r_frame_rate)"
        Write-Host "    Avg frame rate: $($s.avg_frame_rate)"
        Write-Host "    Pixel format: $($s.pix_fmt)"
        Write-Host "    Duration: $($s.duration)s"
        Write-Host "    Bitrate: $([Math]::Round($s.bit_rate/1000)) kbps"
    }
    if ($s.codec_type -eq "audio") {
        Write-Host "    Sample rate: $($s.sample_rate)"
        Write-Host "    Channels: $($s.channels)"
    }
}

Write-Host ""
Write-Host "=== Format ===" -ForegroundColor Cyan
Write-Host "  Duration: $([Math]::Round([double]$info.format.duration))s"
Write-Host "  Size: $([Math]::Round($info.format.size/1MB)) MB"
Write-Host "  Bitrate: $([Math]::Round($info.format.bit_rate/1000)) kbps"

# Calculate expected vs actual frame count
$fps = [double]$info.streams[0].r_frame_rate.Split("/")[0]
$duration = [double]$info.streams[0].duration
$expectedFrames = [Math]::Round($fps * $duration)
Write-Host ""
Write-Host "Expected frames: $expectedFrames ($fps fps x $duration s)"
