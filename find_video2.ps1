$base = "D:\HyperClip-Data"
$outDir = Join-Path $base "output"
$archDir = Join-Path $base "archived"

# Check output
if (Test-Path $outDir) {
    $mp4s = @(Get-ChildItem $outDir -Filter "*.mp4" -Recurse -EA SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 5)
    foreach ($f in $mp4s) {
        Write-Host ("OUTPUT: {0} ({1}MB, {2})" -f $f.Name, [Math]::Round($f.Length/1MB), $f.LastWriteTime) -ForegroundColor Yellow
    }
}

# Check archived
if (Test-Path $archDir) {
    $archs = @(Get-ChildItem $archDir -Filter "*.mp4" -EA SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 5)
    if ($archs.Count -eq 0) {
        Write-Host "Archived: empty" -ForegroundColor Gray
    }
    foreach ($f in $archs) {
        Write-Host ("ARCHIVED: {0} ({1}MB, {2})" -f $f.Name, [Math]::Round($f.Length/1MB), $f.LastWriteTime) -ForegroundColor Green
        $ffprobe = "D:\LOOP_COMPANY\HyperClip\resources\ffmpeg\bin\ffprobe.exe"
        $psi = New-Object System.Diagnostics.ProcessStartInfo
        $psi.FileName = $ffprobe
        $psi.Arguments = "-v error -select_streams v:0 -show_entries stream=codec_name,width,height,r_frame_rate,pix_fmt -of default=noprint_wrappers=1 -- $($f.FullName)"
        $psi.UseShellExecute = $false
        $psi.RedirectStandardOutput = $true
        $psi.RedirectStandardError = $true
        $psi.CreateNoWindow = $true
        $p = [System.Diagnostics.Process]::Start($psi)
        $stdout = $p.StandardOutput.ReadToEnd()
        $p.WaitForExit()
        Write-Host "  $($stdout)" -ForegroundColor White

        # Audio
        $psi2 = New-Object System.Diagnostics.ProcessStartInfo
        $psi2.FileName = $ffprobe
        $psi2.Arguments = "-v error -select_streams a:0 -show_entries stream=codec_name -of default=noprint_wrappers=1 -- $($f.FullName)"
        $psi2.UseShellExecute = $false
        $psi2.RedirectStandardOutput = $true
        $psi2.RedirectStandardError = $true
        $psi2.CreateNoWindow = $true
        $p2 = [System.Diagnostics.Process]::Start($psi2)
        $stdout2 = $p2.StandardOutput.ReadToEnd()
        $p2.WaitForExit()
        if ($stdout2 -match "codec_name=") {
            Write-Host "  AUDIO: $($stdout2.Trim())" -ForegroundColor Green
        } else {
            Write-Host "  AUDIO: NONE" -ForegroundColor Red
        }
        Write-Host ""
    }
} else {
    Write-Host "Archived dir not found: $archDir" -ForegroundColor Red
}
