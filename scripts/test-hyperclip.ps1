$exePath = Join-Path $env:LOCALAPPDATA "Programs\HyperClip\HyperClip.exe"
if (-not (Test-Path $exePath)) {
    $exePath = Join-Path $PSScriptRoot "..\release\win-unpacked\HyperClip.exe"
}
$proc = Start-Process -FilePath $exePath -PassThru -NoNewWindow -RedirectStandardOutput "$env:TEMP\hc_out.txt" -RedirectStandardError "$env:TEMP\hc_err.txt"
Start-Sleep 5
$out = Get-Content "$env:TEMP\hc_out.txt" -Raw -ErrorAction SilentlyContinue
$err = Get-Content "$env:TEMP\hc_err.txt" -Raw -ErrorAction SilentlyContinue
$proc.Refresh()
Write-Host "ExitCode: $($proc.ExitCode), HasExited: $($proc.HasExited)"
Write-Host "---STDOUT---"
Write-Host $out
Write-Host "---STDERR---"
Write-Host $err
Write-Host "---LOG TAIL---"
$dataDir = $env:HYPERCLIP_DATA_DIR
if (-not $dataDir) {
    $dataDir = if (Test-Path "D:\HyperClip-Data") { "D:\HyperClip-Data" } else { "$env:APPDATA\HyperClip" }
}
Get-Content (Join-Path $dataDir "logs\hyperclip.log") -Tail 10
