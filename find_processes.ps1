# Check if HyperClip/Electron is running
Write-Host "=== Electron processes ==="
Get-Process -Name "electron" -EA SilentlyContinue | Select-Object Id, ProcessName, @{N="MemMB";E={[math]::Round($_.WorkingSet64/1MB,1)}}, StartTime, Path | Format-Table -AutoSize

Write-Host "`n=== Node/Next.js dev server ==="
Get-Process -Name "node" -EA SilentlyContinue | Where-Object { $_.Path -like "*hyperclip*" -or $_.Path -like "*next*" } | Select-Object Id, ProcessName, @{N="MemMB";E={[math]::Round($_.WorkingSet64/1MB,1)}}, StartTime, Path | Format-Table -AutoSize

Write-Host "`n=== Taskbar tray icon check ==="
Get-Process -EA SilentlyContinue | Where-Object { $_.MainWindowTitle -ne "" -and ($_.MainWindowTitle -like "*HyperClip*" -or $_.MainWindowTitle -like "*electron*") } | Select-Object Id, ProcessName, MainWindowTitle, @{N="MemMB";E={[math]::Round($_.WorkingSet64/1MB,1)}} | Format-Table -AutoSize
