# Check output video details
$ffprobe = "D:\LOOP_COMPANY\HyperClip\resources\ffmpeg\bin\ffprobe.exe"

Write-Host "=== Latest archived video ===" -ForegroundColor Cyan
$out = Get-ChildItem "D:\HyperClip-Data\archived\*.mp4" -EA SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($out) {
    Write-Host "File: $($out.FullName)"
    Write-Host "Size: $([Math]::Round($out.Length/1MB, 1)) MB"
    Write-Host ""

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $ffprobe
    $psi.Arguments = "-v error -show_entries format=duration,size,bit_rate:stream=codec_name,width,height,r_frame_rate,avg_frame_rate,pix_fmt -of json `"" + $out.FullName + "`""
    $psi.UseShellExecute = $false; $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true; $psi.CreateNoWindow = $true
    $proc = [System.Diagnostics.Process]::Start($psi)
    $stdout = $proc.StandardOutput.ReadToEnd()
    $proc.WaitForExit()
    $json = $stdout | ConvertFrom-Json
    $streams = $json.streams
    $format = $json.format

    Write-Host "Duration: $($format.duration) seconds"
    Write-Host "Bitrate: $([Math]::Round($format.bit_rate/1000)) kbps"
    Write-Host "Size: $([Math]::Round($format.size/1MB, 1)) MB"
    Write-Host ""
    foreach ($s in $streams) {
        if ($s.codec_type -eq "video") {
            Write-Host "Video: $($s.codec_name)"
            Write-Host "Resolution: $($s.width)x$($s.height)"
            Write-Host "Frame rate: $($s.r_frame_rate)"
            Write-Host "Avg frame rate: $($s.avg_frame_rate)"
            Write-Host "Pixel format: $($s.pix_fmt)"
            Write-Host ""
        }
        if ($s.codec_type -eq "audio") {
            Write-Host "Audio: $($s.codec_name) @ $($s.sample_rate) Hz"
        }
    }
}

Write-Host ""
Write-Host "=== Compare to source video ===" -ForegroundColor Cyan
$src = "D:\HyperClip-Data\downloads\ws-1778818913969-nyae9.mp4"
if (-not (Test-Path $src)) {
    $mp4 = Get-ChildItem "D:\HyperClip-Data\downloads\*.mp4" -EA SilentlyContinue | Select-Object -First 1
    if ($mp4) { $src = $mp4.FullName }
}
if (Test-Path $src) {
    Write-Host "Source: $src"
    $psi2 = New-Object System.Diagnostics.ProcessStartInfo
    $psi2.FileName = $ffprobe
    $psi2.Arguments = "-v error -select_streams v:0 -show_entries stream=codec_name,width,height,r_frame_rate,pix_fmt -of json `"" + $src + "`""
    $psi2.UseShellExecute = $false; $psi2.RedirectStandardOutput = $true; $psi2.RedirectStandardError = $true; $psi2.CreateNoWindow = $true
    $proc2 = [System.Diagnostics.Process]::Start($psi2)
    $stdout2 = $proc2.StandardOutput.ReadToEnd()
    $proc2.WaitForExit()
    $json2 = $stdout2 | ConvertFrom-Json
    $srcStream = $json2.streams[0]
    Write-Host "Source frame rate: $($srcStream.r_frame_rate)"
    Write-Host "Source resolution: $($srcStream.width)x$($srcStream.height)"
    Write-Host "Source codec: $($srcStream.codec_name)"
}
