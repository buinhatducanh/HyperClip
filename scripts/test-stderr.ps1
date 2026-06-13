$outFile = "$env:TEMP\hc_stderr.txt"
$errFile = "$env:TEMP\hc_stdout.txt"
$exePath = Join-Path $PSScriptRoot "..\release\win-unpacked\HyperClip.exe"
$proc = Start-Process -FilePath $exePath -PassThru -NoNewWindow -RedirectStandardOutput $outFile -RedirectStandardError $errFile
Start-Sleep 5
$proc.Refresh()
Write-Host "PID: $($proc.Id), ExitCode: $($proc.ExitCode), HasExited: $($proc.HasExited)"
Write-Host "---STDERR---"
Get-Content $errFile -ErrorAction SilentlyContinue
Write-Host "---STDOUT---"
Get-Content $outFile -ErrorAction SilentlyContinue
Write-Host "---LOG---"
$dataDir = $env:HYPERCLIP_DATA_DIR
if (-not $dataDir) {
    $dataDir = if (Test-Path "D:\HyperClip-Data") { "D:\HyperClip-Data" } else { "$env:APPDATA\HyperClip" }
}
Get-Content (Join-Path $dataDir "logs\hyperclip.log") -Tail 10
