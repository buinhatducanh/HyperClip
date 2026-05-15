$ffprobe = "D:\LOOP_COMPANY\HyperClip\resources\ffmpeg\bin\ffprobe.exe"
$archived = "D:\HyperClip-Data\archived"

Write-Host "Checking: $archived" -ForegroundColor Cyan

# List all files
Get-ChildItem $archived -EA SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object Name, Length, LastWriteTime | Format-Table

# Find most recent MP4
$mp4 = Get-ChildItem $archived -Filter "*.mp4" -EA SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($mp4) {
    Write-Host ""
    Write-Host ("Latest: " + $mp4.Name) -ForegroundColor Yellow
    Write-Host ("Size: " + [Math]::Round($mp4.Length/1MB) + " MB")

    # Probe video
    $psi = [System.Diagnostics.ProcessStartInfo]::new()
    $psi.FileName = $ffprobe
    $psi.Arguments = "-v error -select_streams v:0 -show_entries stream=codec_name,width,height,r_frame_rate,avg_frame_rate,pix_fmt,duration -of default=noprint_wrappers=1 -- `"$($mp4.FullName)`""
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true
    $p = [System.Diagnostics.Process]::Start($psi)
    $vinfo = $p.StandardOutput.ReadToEnd()
    $p.WaitForExit()
    Write-Host ""
    Write-Host "=== VIDEO ===" -ForegroundColor Green
    $vinfo -split "`n" | ForEach-Object { if ($_.Trim()) { Write-Host $_ } }

    # Probe audio
    $psi2 = [System.Diagnostics.ProcessStartInfo]::new()
    $psi2.FileName = $ffprobe
    $psi2.Arguments = "-v error -select_streams a -show_entries stream=codec_name,sample_rate,channels -of default=noprint_wrappers=1 -- `"$($mp4.FullName)`""
    $psi2.UseShellExecute = $false
    $psi2.RedirectStandardOutput = $true
    $psi2.RedirectStandardError = $true
    $psi2.CreateNoWindow = $true
    $p2 = [System.Diagnostics.Process]::Start($psi2)
    $ainfo = $p2.StandardOutput.ReadToEnd()
    $p2.WaitForExit()
    Write-Host ""
    Write-Host "=== AUDIO ===" -ForegroundColor Green
    if ($ainfo.Trim()) { $ainfo -split "`n" | ForEach-Object { if ($_.Trim()) { Write-Host $_ } } }
    else { Write-Host "(NO AUDIO)" -ForegroundColor Red }

    # FPS summary
    if ($vinfo -match "r_frame_rate=(\d+)/(\d+)") {
        $fps = [Math]::Round([double]$Matches[1] / [double]$Matches[2], 2)
        Write-Host ""
        Write-Host ("FPS: " + $fps + " fps") -ForegroundColor Cyan
    }
} else {
    Write-Host "No MP4 files found in archived folder." -ForegroundColor Red
}
