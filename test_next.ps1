$ErrorActionPreference = "Stop"
$resourcesPath = "D:\LOOP_COMPANY\HyperClip\release\win-unpacked\resources"
$nextBin = Join-Path $resourcesPath "app.asar.unpacked\node_modules\next\dist\bin\next"
$nodeExe = "C:\Program Files\nodejs\node.exe"

if (-not (Test-Path $nodeExe)) {
    $nodeExe = (Get-Command node -ErrorAction SilentlyContinue).Source
}
Write-Host "Node: $nodeExe"
Write-Host "Next bin: $nextBin"
Write-Host "Next exists: $(Test-Path $nextBin)"

$proc = Start-Process -FilePath $nodeExe -ArgumentList $nextBin, "-p", "3003" -WorkingDirectory $resourcesPath -PassThru -NoNewWindow -RedirectStandardOutput "$env:TEMP\njout.txt" -RedirectStandardError "$env:TEMP\njerr.txt" -Wait -WindowStyle Hidden
Write-Host "Exit code: $($proc.ExitCode)"
Write-Host "--- stdout ---"
Get-Content "$env:TEMP\njout.txt" -ErrorAction SilentlyContinue | Select-Object -First 10
Write-Host "--- stderr ---"
Get-Content "$env:TEMP\njerr.txt" -ErrorAction SilentlyContinue | Select-Object -First 10
