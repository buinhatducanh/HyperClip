$outFile = "$env:TEMP\hc_stderr.txt"
$errFile = "$env:TEMP\hc_stdout.txt"
$proc = Start-Process -FilePath 'D:\LOOP_COMPANY\HyperClip\release\win-unpacked\HyperClip.exe' -PassThru -NoNewWindow -RedirectStandardOutput $outFile -RedirectStandardError $errFile
Start-Sleep 5
$proc.Refresh()
Write-Host "PID: $($proc.Id), ExitCode: $($proc.ExitCode), HasExited: $($proc.HasExited)"
Write-Host "---STDERR---"
Get-Content $errFile -ErrorAction SilentlyContinue
Write-Host "---STDOUT---"
Get-Content $outFile -ErrorAction SilentlyContinue
Write-Host "---LOG---"
Get-Content 'D:\HyperClip-Data\logs\hyperclip.log' -Tail 10
