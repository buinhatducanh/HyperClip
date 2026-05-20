$ffprobe = "D:\LOOP_COMPANY\HyperClip\resources\ffmpeg\bin\ffprobe.exe"
$archived = "D:\HyperClip-Data\archived"
if (Test-Path $archived) {
    $files = @(Get-ChildItem $archived -Filter "*.mp4" -EA SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 3)
    if ($files.Count -gt 0) {
        $files | ForEach-Object {
            $sz = [Math]::Round($_.Length / 1MB, 1)
            Write-Host "ARCHIVED: $($_.FullName)"
            Write-Host ("  Size: {0} MB  Time: {1}" -f $sz, $_.LastWriteTime)
        }
        $latest = $files[0]
        Write-Host ""
        Write-Host "=== PROBE: $($latest.Name) ===" -ForegroundColor Cyan
        $psi = New-Object System.Diagnostics.ProcessStartInfo
        $psi.FileName = $ffprobe
        $psi.Arguments = "-v error -select_streams v:0 -show_entries stream=codec_name,width,height,r_frame_rate,avg_frame_rate,pix_fmt -of default=noprint_wrappers=1 -- $($latest.FullName)"
        $psi.UseShellExecute = $false
        $psi.RedirectStandardOutput = $true
        $psi.RedirectStandardError = $true
        $psi.CreateNoWindow = $true
        $p = [System.Diagnostics.Process]::Start($psi)
        $out = $p.StandardOutput.ReadToEnd()
        $p.WaitForExit()
        Write-Host $out
        if ($out -match "r_frame_rate=(\d+)/(\d+)") {
            $fpsNum = [double]$Matches[1]
            $fpsDen = [double]$Matches[2]
            if ($fpsDen -gt 0) {
                $fps = [Math]::Round($fpsNum / $fpsDen, 2)
                Write-Host ("FPS: {0}" -f $fps) -ForegroundColor Green
            }
        }
        Write-Host ""
        $psi2 = New-Object System.Diagnostics.ProcessStartInfo
        $psi2.FileName = $ffprobe
        $psi2.Arguments = "-v error -select_streams a:0 -show_entries stream=codec_name,sample_rate -of default=noprint_wrappers=1 -- $($latest.FullName)"
        $psi2.UseShellExecute = $false
        $psi2.RedirectStandardOutput = $true
        $psi2.RedirectStandardError = $true
        $psi2.CreateNoWindow = $true
        $p2 = [System.Diagnostics.Process]::Start($psi2)
        $out2 = $p2.StandardOutput.ReadToEnd()
        $p2.WaitForExit()
        Write-Host "AUDIO:"
        if ($out2 -match "codec_name=") { Write-Host $out2 } else { Write-Host "(NO AUDIO)" -ForegroundColor Red }
    } else {
        Write-Host "No archived MP4 files."
    }
} else {
    Write-Host "Archived dir not found."
}
