# Quick verify: extract 10 evenly-spaced frames from latest output
$ffmpeg = "D:\LOOP_COMPANY\HyperClip\resources\ffmpeg\bin\ffmpeg.exe"
$ffprobe = "D:\LOOP_COMPANY\HyperClip\resources\ffmpeg\bin\ffprobe.exe"

$latest = Get-ChildItem "D:\HyperClip-Data\archived\*.mp4" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (!$latest) { Write-Host "[ERROR] No output files"; exit 1 }

$output = $latest.FullName
Write-Host "Checking: $($latest.Name)"

# Get duration
$dur = & $ffprobe -v error -show_entries format=duration -of csv=p=0 -- $output 2>&1
$duration = [double]$dur
Write-Host "Duration: $duration s"

# Get frame count
$nb = & $ffprobe -v error -select_streams v:0 -show_entries stream=nb_frames -of csv=p=0 -- $output 2>&1
Write-Host "nb_frames: $nb"

# Extract frames every 60 seconds
$tempDir = "$env\TEMP\quick_verify"
Remove-Item $tempDir -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $tempDir | Out-Null

$hashes = @{}
$step = [Math]::Max(1, [int]($duration / 10))
for ($t = 0; $t -lt $duration; $t += $step) {
    $out = "$tempDir\f_$([int]$t).png"
    & $ffmpeg -ss $t -i $output -frames:v 1 -y $out 2>&1 | Out-Null
    if (Test-Path $out) {
        $h = (Get-FileHash $out -Algorithm MD5).Hash
        $hashes[[int]$t] = $h
    }
}

$unique = ($hashes.Values | Select-Object -Unique).Count
$total = $hashes.Count
Write-Host "`nUnique frames: $unique / $total"
if ($unique -ge ($total * 0.8)) {
    Write-Host "PASS: Video has varying content (not static/1fps)"
} elseif ($unique -ge ($total * 0.5)) {
    Write-Host "WARN: Some frames repeat, possible VFR or low-motion sections"
} else {
    Write-Host "FAIL: Most frames identical - video is likely static or 1fps!"
}

Write-Host "`nFrame hashes:"
$hashes.GetEnumerator() | Sort-Object Name | ForEach-Object { Write-Host "  t=$($_.Key)s: $($_.Value)" }
