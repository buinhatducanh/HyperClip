Get-CimInstance Win32_Process -Filter "name = 'node.exe'" | ForEach-Object {
    Write-Host ("PID: " + $_.ProcessId + " CMD: " + $_.CommandLine)
}

