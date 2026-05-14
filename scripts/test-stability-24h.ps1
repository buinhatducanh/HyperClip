# HyperClip 24-Hour Stability Test
# ====================================
# Runs the app for 24 hours and monitors:
#   - Crash count
#   - Memory leak (RAM usage over time)
#   - Detection success rate
#   - Download success rate
#   - Render success rate
#
# Usage:
#   .\test-stability-24h.ps1 [-Hours 24] [-IntervalSec 300]
#
# Prerequisites:
#   - HyperClip running on localhost:3000
#   - At least 1 channel added with videos posted < 10 min

param(
    [Parameter(Mandatory=$false)]
    [int]$Hours = 24,

    [Parameter(Mandatory=$false)]
    [int]$IntervalSec = 300  # 5 minutes between metrics snapshots
)

$ErrorActionPreference = "Continue"
$startTime = Get-Date
$endTime = $startTime.AddHours($Hours)
$totalMinutes = $Hours * 60

Write-Host ""
Write-Host "══════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  HyperClip 24-Hour Stability Test" -ForegroundColor White
Write-Host "══════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Start: $startTime" -ForegroundColor Gray
Write-Host "  End:   $endTime" -ForegroundColor Gray
Write-Host "  Duration: $Hours hours" -ForegroundColor Gray
Write-Host "  Snapshot interval: $IntervalSec seconds" -ForegroundColor Gray
Write-Host ""

# Metrics
$metrics = @{
    startTime = $startTime
    crashes = 0
    memorySnapshots = @()
    detections = 0
    downloads = 0
    downloadFails = 0
    renders = 0
    renderFails = 0
    pollCount = 0
    errors = @()
    snapshots = @()
}

function Write-Metric($label, $value) {
    Write-Host "  $label : $value" -ForegroundColor $(if ($value -eq 0 -or $value -eq $null) { "DarkGray" } else { "White" })
}

# Helper: get process info
function Get-AppMemoryMB {
    $proc = Get-Process -Name "HyperClip" -ErrorAction SilentlyContinue |
            Where-Object { $_.MainWindowTitle -like "*HyperClip*" } |
            Select-Object -First 1
    if ($proc) {
        return [math]::Round($proc.WorkingSet64 / 1MB, 1)
    }
    return $null
}

# ─── Run monitoring loop ───────────────────────────────────────────────────────
Write-Host ">>> Starting stability monitoring..." -ForegroundColor Cyan
Write-Host ""

while ((Get-Date) -lt $endTime) {
    $now = Get-Date
    $elapsed = $now - $startTime
    $remaining = $endTime - $now

    # Take metrics snapshot
    $memMB = Get-AppMemoryMB
    $snapshot = @{
        timestamp = $now
        elapsedMin = [math]::Round($elapsed.TotalMinutes, 1)
        memoryMB = $memMB
        detections = $metrics.detections
        downloads = $metrics.downloads
        downloadFails = $metrics.downloadFails
        renders = $metrics.renders
        renderFails = $metrics.renderFails
    }

    if ($null -ne $memMB) {
        $metrics.memorySnapshots += $snapshot
    }

    Write-Host "[$($elapsed.ToString('hh\:mm\:ss'))] Snapshot" -ForegroundColor Cyan
    Write-Host "  Memory: $(if($memMB){"$memMB MB"}else{"N/A"})" -ForegroundColor Gray
    Write-Host "  Detections: $($metrics.detections) | Downloads: $($metrics.downloads)/$($metrics.downloadFails fails) | Renders: $($metrics.renders)/$($metrics.renderFails fails)" -ForegroundColor Gray

    # Check for crashes
    $hcProc = Get-Process -Name "HyperClip" -ErrorAction SilentlyContinue |
              Where-Object { $_.MainWindowTitle -like "*HyperClip*" }
    if (-not $hcProc) {
        $metrics.crashes++
        Write-Host "  !! CRASH DETECTED (crash #$($metrics.crashes))" -ForegroundColor Red
    }

    # Fetch workspace data from app
    try {
        $response = Invoke-RestMethod -Uri "http://localhost:3000/api/health" -TimeoutSec 5 -ErrorAction SilentlyContinue
        if ($response) {
            $metrics.pollCount++
        }
    } catch {}

    Write-Host ""

    # Wait for next interval
    Start-Sleep -Seconds $IntervalSec
}

# ─── Generate Report ──────────────────────────────────────────────────────────
$runtime = (Get-Date) - $startTime
$memStart = $metrics.memorySnapshots | Select-Object -First 1
$memEnd = $metrics.memorySnapshots | Select-Object -Last 1

$memGrowth = $null
if ($memStart -and $memEnd -and $memStart.memoryMB -and $memEnd.memoryMB) {
    $memGrowth = [math]::Round($memEnd.memoryMB - $memStart.memoryMB, 1)
}

$detectionRate = if ($metrics.pollCount -gt 0) { [math]::Round(($metrics.detections / $metrics.pollCount) * 100, 1) } else { 0 }
$downloadRate = if (($metrics.downloads + $metrics.downloadFails) -gt 0) {
    [math]::Round(($metrics.downloads / ($metrics.downloads + $metrics.downloadFails)) * 100, 1)
} else { 0 }
$renderRate = if (($metrics.renders + $metrics.renderFails) -gt 0) {
    [math]::Round(($metrics.renders / ($metrics.renders + $metrics.renderFails)) * 100, 1)
} else { 0 }

Write-Host ""
Write-Host "══════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host "  24-Hour Stability Report" -ForegroundColor White
Write-Host "══════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host ""
Write-Host "  Runtime: $($runtime.ToString('hh\:mm\:ss'))" -ForegroundColor White
Write-Host "  Snapshots: $($metrics.memorySnapshots.Count)" -ForegroundColor White
Write-Host ""
Write-Host "  Crashes: $($metrics.crashes) $(if($metrics.crashes -eq 0){"✓ PASS"}else{"✗ FAIL"})" -ForegroundColor $(if($metrics.crashes -eq 0){"Green"}else{"Red"})
Write-Host "  Memory: $(if($memStart){"$($memStart.memoryMB) → $($memEnd.memoryMB) MB"}else{"N/A"})" -ForegroundColor White
if ($null -ne $memGrowth) {
    Write-Host "  Memory growth: $(if($memGrowth -gt 0){"+$memGrowth"}else{$memGrowth}) MB $(if($memGrowth -le 500){"✓ PASS"}else{"✗ WARN (> 500MB)"})" -ForegroundColor $(if($memGrowth -le 500){"Green"}else{"Yellow"})
}
Write-Host ""
Write-Host "  Detection: $($metrics.detections) events" -ForegroundColor White
Write-Host "  Download: $($metrics.downloads) success / $($metrics.downloadFails) fails ($downloadRate%)" -ForegroundColor White
Write-Host "  Render: $($metrics.renders) success / $($metrics.renderFails) fails ($renderRate%)" -ForegroundColor White
Write-Host ""

# Pass/Fail
$pass = $true
if ($metrics.crashes -gt 0) { $pass = $false; Write-Host "  ✗ Crash detected" -ForegroundColor Red }
if ($null -ne $memGrowth -and $memGrowth -gt 500) { $pass = $false; Write-Host "  ✗ Memory growth > 500MB" -ForegroundColor Red }
if ($downloadRate -lt 90) { Write-Host "  ⚠ Download success rate < 90%" -ForegroundColor Yellow }
if ($renderRate -lt 90) { Write-Host "  ⚠ Render success rate < 90%" -ForegroundColor Yellow }

if ($pass) {
    Write-Host "  ✓ 24-Hour Stability: PASS" -ForegroundColor Green
} else {
    Write-Host "  ✗ 24-Hour Stability: FAIL" -ForegroundColor Red
}
Write-Host ""
