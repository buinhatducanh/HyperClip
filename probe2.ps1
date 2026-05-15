$ffprobe = "D:\LOOP_COMPANY\HyperClip\resources\ffmpeg\bin\ffprobe.exe"
$out = Get-ChildItem "D:\HyperClip-Data\archived\*.mp4" -EA SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($out) {
    Write-Host "Output: $($out.FullName)"
    Write-Host ""

    # Method 1: ffprobe -show_entries
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $ffprobe
    $psi.Arguments = "-v error -select_streams v:0 -show_entries stream=codec_name,width,height,r_frame_rate,avg_frame_rate,pix_fmt,duration -of default=noprint_wrappers=1 `"" + $out.FullName + "`""
    $psi.UseShellExecute = $false; $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true; $psi.CreateNoWindow = $true
    $proc = [System.Diagnostics.Process]::Start($psi)
    $stdout = $proc.StandardOutput.ReadToEnd()
    $proc.WaitForExit()
    Write-Host "=== Video stream ==="
    Write-Host $stdout

    # Check audio
    $psi2 = New-Object System.Diagnostics.ProcessStartInfo
    $psi2.FileName = $ffprobe
    $psi2.Arguments = "-v error -select_streams a:0 -show_entries stream=codec_name,sample_rate,channels -of default=noprint_wrappers=1 `"" + $out.FullName + "`""
    $psi2.UseShellExecute = $false; $psi2.RedirectStandardOutput = $true; $psi2.RedirectStandardError = $true; $psi2.CreateNoWindow = $true
    $proc2 = [System.Diagnostics.Process]::Start($psi2)
    $stdout2 = $proc2.StandardOutput.ReadToEnd()
    $proc2.WaitForExit()
    Write-Host "=== Audio stream ==="
    Write-Host $stdout2

    # Method 2: ffprobe fps
    Write-Host ""
    Write-Host "=== FPS via ffmpeg ==="
    $psi3 = New-Object System.Diagnostics.ProcessStartInfo
    $psi3.FileName = $ffprobe
    $psi3.Arguments = "-v error -count_frames -select_streams v:0 -show_entries stream=nb_read_frames,r_frame_rate -of default=noprint_wrappers=1 `"" + $out.FullName + "`""
    $psi3.UseShellExecute = $false; $psi3.RedirectStandardOutput = $true; $psi3.RedirectStandardError = $true; $psi3.CreateNoWindow = $true
    $proc3 = [System.Diagnostics.Process]::Start($psi3)
    $stdout3 = $proc3.StandardOutput.ReadToEnd()
    $proc3.WaitForExit()
    Write-Host $stdout3
}
