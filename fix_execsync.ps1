# Fix execSync calls in ffmpeg-paths.ts
$path = "D:\LOOP_COMPANY\HyperClip\electron\services\ffmpeg-paths.ts"
$c = [System.IO.File]::ReadAllText($path)

# Replace decoders execSync in getFfmpegVersion
$c = $c -replace 'const decodersOut = execSync\(`"\$\{ffmpegPath\}" -hide_banner -decoders 2>&1`,\s*\{[^}]*encoding:[^']*utf-8[^']*timeout:\s*8000[^}]*\}\)', 'const decodersOut = ffmpegExec([ffmpegPath, "-hide_banner", "-decoders"])'
# Replace encoders execSync in getFfmpegVersion
$c = $c -replace 'const encodersOut = execSync\(`"\$\{ffmpegPath\}" -hide_banner -encoders 2>&1`,\s*\{[^}]*encoding:[^']*utf-8[^']*timeout:\s*8000[^}]*\}\)', 'const encodersOut = ffmpegExec([ffmpegPath, "-hide_banner", "-encoders"])'

[System.IO.File]::WriteAllText($path, $c, [System.Text.UTF8Encoding]::new($false))
Write-Host "Done"
Get-Content $path | Select-String 'decodersOut|encodersOut' | Select-Object -First 5
