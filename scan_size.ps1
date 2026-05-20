# Scan the biggest folders in C:\Users\MSI

Write-Host "=== C:\Users\MSI top-level ===" -ForegroundColor Cyan
Get-ChildItem "C:\Users\MSI" -Directory -ErrorAction SilentlyContinue |
    ForEach-Object {
        $size = (Get-ChildItem $_.FullName -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
        [PSCustomObject]@{
            Folder = $_.Name
            GB = [math]::Round($size/1GB, 2)
        }
    } | Sort-Object GB -Descending | Format-Table -AutoSize

Write-Host "`n=== AppData folders ===" -ForegroundColor Cyan
$appPaths = @(
    $env:APPDATA,
    $env:LOCALAPPDATA,
    $env:TEMP,
    "C:\Windows\Temp",
    "$env:LOCALAPPDATA\D--LOOP-COMPANY-HyperClip",
    "$env:APPDATA\D--LOOP-COMPANY-HyperClip",
    "D:\ramdisk"
)
foreach ($p in $appPaths) {
    if (Test-Path $p) {
        $size = (Get-ChildItem $p -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
        Write-Host "$p ---> $([math]::Round($size/1GB,2)) GB"
    } else {
        Write-Host "$p ---> NOT FOUND" -ForegroundColor Yellow
    }
}

Write-Host "`n=== C:\ drive root large files ===" -ForegroundColor Cyan
Get-ChildItem "C:\" -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Length -gt 100MB } |
    ForEach-Object {
        [PSCustomObject]@{
            File = $_.Name
            GB = [math]::Round($_.Length/1GB, 2)
        }
    } | Sort-Object GB -Descending | Format-Table -AutoSize

Write-Host "`n=== HyperClip project node_modules + .next ===" -ForegroundColor Cyan
$projPaths = @("D:\LOOP_COMPANY\HyperClip\node_modules", "D:\LOOP_COMPANY\HyperClip\.next", "D:\LOOP_COMPANY\HyperClip\dist")
foreach ($p in $projPaths) {
    if (Test-Path $p) {
        $size = (Get-ChildItem $p -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
        Write-Host "$p ---> $([math]::Round($size/1GB,2)) GB"
    } else {
        Write-Host "$p ---> NOT FOUND" -ForegroundColor Yellow
    }
}

Write-Host "`n=== Windows Cleanup Candidate ===" -ForegroundColor Cyan
$wuc = @(
    "C:\Windows\SoftwareDistribution\Download",
    "C:\Windows\Panther",
    "C:\Windows\Logs",
    "C:\Windows\WinSxS\Backup",
    "$env:LOCALAPPDATA\Temp",
    "$env:WINDIR\Temp"
)
foreach ($p in $wuc) {
    if (Test-Path $p) {
        $size = (Get-ChildItem $p -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
        Write-Host "$p ---> $([math]::Round($size/1GB,2)) GB"
    }
}

Write-Host "`n=== Done ===" -ForegroundColor Green
