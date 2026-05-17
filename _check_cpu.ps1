$cpuCount = [Environment]::ProcessorCount
Write-Host "Logical Cores: $cpuCount"
Write-Host "95% overall = $([math]::Round($cpuCount * 0.95, 1)) core-eq in use"
Write-Host ""

Get-Process | Where-Object { $_.ProcessName -match "node|chrome|Antigravity|electron|ffmpeg" } | ForEach-Object {
    $age = New-TimeSpan -Start $_.StartTime -End (Get-Date)
    $ageStr = if ($age.TotalHours -ge 24) { "$([math]::Round($age.TotalHours/24,1))d" } else { "$([math]::Round($age.TotalHours,1))h" }
    [PSCustomObject]@{
        Name = $_.ProcessName
        Id = $_.Id
        CPU = "$([math]::Round($_.CPU,0))s"
        Age = $ageStr
        WS = "$([math]::Round($_.WS/1MB,0))MB"
    }
} | Sort-Object CPU -Descending | Format-Table -AutoSize
