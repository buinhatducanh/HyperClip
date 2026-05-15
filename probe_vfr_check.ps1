$ffmpeg = "D:\LOOP_COMPANY\HyperClip\resources\ffmpeg\bin\ffmpeg.exe"
$src = Get-ChildItem "D:\HyperClip-Data\downloads\*.mkv" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
$tmp = "$env:TEMP\src_frames"
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

Write-Host "SOURCE: Frame uniqueness at 1-second intervals (full motion = all different)"
Write-Host "========================================"

$hashes = @{}
for ($t = 0; $t -le 30; $t++) {
    $out = "$tmp\s_$($t).png"
    & $ffmpeg -ss $t -i $src.FullName -frames:v 1 -y $out 2>&1 | Out-Null
    if (Test-Path $out) {
        $h = (Get-FileHash $out -Algorithm MD5).Hash
        $hashes[$t] = $h
        $prev = if ($t -gt 0) { $hashes[$t-1] } else { $null }
        $diff = if ($prev -and $h -ne $prev) { "CHANGED" } elseif ($prev) { "SAME!" } else { "" }
        Write-Host "  t=$($t)s: $diff"
    }
}

$unique = ($hashes.Values | Select-Object -Unique).Count
Write-Host "`nUnique: $unique / $($hashes.Count)"

if ($unique -lt ($hashes.Count * 0.5)) {
    Write-Host "CONFIRMED: Most frames are IDENTICAL (video is static at most 1fps)"
    Write-Host "This is NOT a FFmpeg issue - the SOURCE video itself has 1fps content!"
} else {
    Write-Host "Source has full motion content"
}
