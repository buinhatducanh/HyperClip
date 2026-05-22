$proc = Start-Process -FilePath 'C:\Users\MSI\AppData\Local\Programs\HyperClip\HyperClip.exe' -PassThru -NoNewWindow -RedirectStandardOutput "$env:TEMP\hc_out.txt" -RedirectStandardError "$env:TEMP\hc_err.txt"
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
Get-Content 'D:\HyperClip-Data\logs\hyperclip.log' -Tail 10
