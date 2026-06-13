$ErrorActionPreference = "SilentlyContinue"
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  HyperClip C-Drive Cleanup" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
$totalFreed = 0

# 1. HyperClip log
$logPath = Join-Path $env:USERPROFILE ".hyperclip\logs\hyperclip.log"
if (Test-Path $logPath) {
    $size = (Get-Item $logPath).Length
    $sizeGB = [math]::Round($size/1GB, 2)
    Remove-Item $logPath -Force
    Write-Host "[CLEARED] hyperclip.log ($sizeGB GB)" -ForegroundColor Green
    $totalFreed = $totalFreed + $size
}

# 2. Project build artifacts
$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$folders = @(
    (Join-Path $projectRoot "node_modules"),
    (Join-Path $projectRoot ".next"),
    (Join-Path $projectRoot "release"),
    (Join-Path $projectRoot ".hyperclip")
)
foreach ($f in $folders) {
    if (Test-Path $f) {
        $s = (Get-ChildItem $f -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
        $sGB = [math]::Round($s/1GB, 2)
        Remove-Item $f -Recurse -Force
        Write-Host "[CLEARED] $f ($sGB GB)" -ForegroundColor Green
        $totalFreed = $totalFreed + $s
    }
}

# 3. npm/pnpm cache
$cachePaths = @(
    (Join-Path $env:LOCALAPPDATA "npm-cache"),
    (Join-Path $env:LOCALAPPDATA "pnpm-cache"),
    (Join-Path $env:APPDATA "npm")
)
foreach ($c in $cachePaths) {
    if (Test-Path $c) {
        $s = (Get-ChildItem $c -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
        $sGB = [math]::Round($s/1GB, 2)
        Remove-Item $c -Recurse -Force
        Write-Host "[CLEARED] $c ($sGB GB)" -ForegroundColor Green
        $totalFreed = $totalFreed + $s
    }
}

# 4. Windows temp
$tempPaths = @(
    $env:TEMP,
    "C:\Windows\Temp"
)
foreach ($t in $tempPaths) {
    if (Test-Path $t) {
        $s = (Get-ChildItem $t -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
        $sGB = [math]::Round($s/1GB, 2)
        if ($sGB -gt 0.01) {
            Remove-Item $t -Recurse -Force
            Write-Host "[CLEARED] $t ($sGB GB)" -ForegroundColor Green
            $totalFreed = $totalFreed + $s
        }
    }
}

# 5. electron-builder cache
$eb = Join-Path $env:LOCALAPPDATA "electron-builder"
if (Test-Path $eb) {
    $s = (Get-ChildItem $eb -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
    $sGB = [math]::Round($s/1GB, 2)
    Remove-Item $eb -Recurse -Force
    Write-Host "[CLEARED] electron-builder cache ($sGB GB)" -ForegroundColor Green
    $totalFreed = $totalFreed + $s
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ("  TOTAL FREED: " + [math]::Round($totalFreed/1GB, 2) + " GB") -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Sau khi cleanup, chay lai:" -ForegroundColor Yellow
Write-Host "  cd $projectRoot" -ForegroundColor White
Write-Host "  pnpm install" -ForegroundColor White
Write-Host ""
Write-Host "Manual (tuy chon):" -ForegroundColor Yellow
Write-Host "  CapCut:  AppData\Local\CapCut          ~16.8 GB" -ForegroundColor White
Write-Host "  Docker:  AppData\Local\Docker          ~18.2 GB" -ForegroundColor White
Write-Host "  Chrome:  chrome://settings/clearBrowserData" -ForegroundColor White
Write-Host "  Minecraft: AppData\Roaming\.minecraft ~10.5 GB" -ForegroundColor White
Write-Host "  ZaloData: AppData\Roaming\ZaloData    ~6.5 GB" -ForegroundColor White
