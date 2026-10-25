$procs = Get-Process -Name chrome -ErrorAction SilentlyContinue
$count = 0
foreach ($p in $procs) {
    try {
        $cim = Get-CimInstance Win32_Process -Filter "ProcessId = $($p.Id)"
        if ($cim -and $cim.CommandLine -like "*TikTok-Profiles*") {
            Stop-Process -Id $p.Id -Force
            Write-Host "Killed TikTok Chrome PID $($p.Id)"
            $count++
        }
    } catch {
    }
}
Write-Host "Cleaned up $count legacy TikTok Chrome processes."
