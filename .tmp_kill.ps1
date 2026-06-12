$patterns = @('hyperclip-tauri', 'hyperclip', 'main.py', 'HyperClip')
$killNames = @('hyperclip-tauri.exe', 'python.exe', 'node.exe', 'yt-dlp.exe', 'ffmpeg.exe')

Get-Process | ForEach-Object {
    $p = $_
    foreach ($pat in $patterns) {
        if ($p.ProcessName -like "*$pat*" -or $p.Path -like "*$pat*" -or $p.MainWindowTitle -like "*$pat*") {
            Write-Host "PID $($p.Id)  $($p.ProcessName)  $($p.MainWindowTitle)"
            break
        }
    }
}

Write-Host "---"
Write-Host "Killing processes..."
foreach ($name in $killNames) {
    Get-Process -Name $name -ErrorAction SilentlyContinue | ForEach-Object {
        try {
            Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
            Write-Host "Killed $name (PID $($_.Id))"
        } catch {}
    }
}

Write-Host "---"
Write-Host "Remaining hyperclip/python/node processes:"
Get-Process | Where-Object {
    $_.ProcessName -match 'hyperclip|main\.py|node'
} | Select-Object Id, ProcessName, MainWindowTitle | Format-Table -AutoSize
