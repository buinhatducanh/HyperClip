# Drill down into AppData\Roaming and AppData\Local

function Get-FolderSize {
    param([string]$Path, [int]$Depth = 1)
    if (-not (Test-Path $Path)) { return }
    $items = Get-ChildItem $Path -Directory -ErrorAction SilentlyContinue
    foreach ($item in $items) {
        $size = (Get-ChildItem $item.FullName -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
        [PSCustomObject]@{
            Folder = $item.Name
            Path = $item.FullName
            GB = [math]::Round($size/1GB, 2)
            MB = [math]::Round($size/1MB, 0)
        }
    }
}

Write-Host "=== AppData\Roaming (>0.01 GB) ===" -ForegroundColor Cyan
Get-FolderSize -Path "$env:APPDATA" | Sort-Object GB -Descending | Where-Object { $_.GB -ge 0.01 } | Format-Table -AutoSize

Write-Host "`n=== AppData\Local (>0.1 GB) ===" -ForegroundColor Cyan
Get-FolderSize -Path "$env:LOCALAPPDATA" | Sort-Object GB -Descending | Where-Object { $_.GB -ge 0.1 } | Format-Table -AutoSize

Write-Host "`n=== .hyperclip folder (>0.01 GB) ===" -ForegroundColor Cyan
if (Test-Path "C:\Users\MSI\.hyperclip") {
    Get-FolderSize -Path "C:\Users\MSI\.hyperclip" -Depth 3 | Sort-Object GB -Descending | Where-Object { $_.GB -ge 0.01 } | Format-Table -AutoSize
}

Write-Host "`n=== .android folder (>0.01 GB) ===" -ForegroundColor Cyan
if (Test-Path "C:\Users\MSI\.android") {
    Get-FolderSize -Path "C:\Users\MSI\.android" -Depth 3 | Sort-Object GB -Descending | Where-Object { $_.GB -ge 0.01 } | Format-Table -AutoSize
}

Write-Host "`n=== HyperClip D:\LOOP_COMPANY\HyperClip detail ===" -ForegroundColor Cyan
Get-FolderSize -Path "D:\LOOP_COMPANY\HyperClip" | Sort-Object GB -Descending | Format-Table -AutoSize
