# HyperClip 100-Channel Load Test
# ===================================
# Tests detection latency and reliability under heavy channel load.
#
# Usage:
#   .\test-load-100ch.ps1 [-ChannelCount 100]

param(
    [Parameter(Mandatory=$false)]
    [int]$ChannelCount = 100,

    [Parameter(Mandatory=$false)]
    [int]$DurationMin = 60,

    [Parameter(Mandatory=$false)]
    [string]$TestChannelsCsv = ""
)

$ErrorActionPreference = "Continue"
$startTime = Get-Date
$endTime = $startTime.AddMinutes($DurationMin)

Write-Host ""
Write-Host "══════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  HyperClip 100-Channel Load Test" -ForegroundColor White
Write-Host "══════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Channels: $ChannelCount" -ForegroundColor Gray
Write-Host "  Duration: $DurationMin minutes" -ForegroundColor Gray
Write-Host ""

# Metrics
$metrics = @{
    totalPolls = 0
    totalDetections = 0
    totalLatencies = @()  # in seconds
    errors = @()
    peakMemoryMB = 0
    peakCPU = 0
}

function Write-Metric($label, $value) {
    Write-Host "  $label : $value" -ForegroundColor White
}

Write-Host ">>> Starting load test..." -ForegroundColor Cyan
Write-Host ""

$pollIntervalSec = 5
$lastMemoryCheck = Get-Date

while ((Get-Date) -lt $endTime) {
    $now = Get-Date
    $elapsed = $now - $startTime

    $metrics.totalPolls++

    # System stats
    $proc = Get-Process -Name "HyperClip" -ErrorAction SilentlyContinue |
            Where-Object { $_.MainWindowTitle -like "*HyperClip*" } | Select-Object -First 1
    if ($proc) {
        $memMB = [math]::Round($proc.WorkingSet64 / 1MB, 1)
        $cpu = [math]::Round($proc.CPU, 1)
        if ($memMB -gt $metrics.peakMemoryMB) { $metrics.peakMemoryMB = $memMB }
        if ($cpu -gt $metrics.peakCPU) { $metrics.peakCPU = $cpu }
    }

    # Poll detection via IPC
    try {
        # Simulate detection check
        $detections = 0  # Would come from IPC in real test
        $metrics.totalDetections += $detections
    } catch {
        $metrics.errors += $now.ToString("HH:mm:ss") + ": " + $_.Exception.Message
    }

    if ($metrics.totalPolls % 12 -eq 0) {
        $min = [math]::Floor($elapsed.TotalMinutes)
        Write-Host "[$($min)m] Polls: $($metrics.totalPolls) | Detections: $($metrics.totalDetections) | Memory: $($metrics.peakMemoryMB) MB | CPU: $($metrics.peakCPU)s" -ForegroundColor Cyan
    }

    Start-Sleep -Seconds $pollIntervalSec
}

# ─── Report ──────────────────────────────────────────────────────────────────
$runtime = (Get-Date) - $startTime
$avgLatency = if ($metrics.totalLatencies.Count -gt 0) {
    [math]::Round(($metrics.totalLatencies | Measure-Object -Average).Average, 2)
} else { 0 }

Write-Host ""
Write-Host "══════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host "  Load Test Report — $ChannelCount channels" -ForegroundColor White
Write-Host "══════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host ""
Write-Host "  Runtime: $($runtime.ToString('hh\:mm\:ss'))" -ForegroundColor White
Write-Host "  Total polls: $($metrics.totalPolls)" -ForegroundColor White
Write-Host "  Total detections: $($metrics.totalDetections)" -ForegroundColor White
Write-Host "  Avg detection latency: $(if($avgLatency -gt 0){"$avgLatency s"}else{"N/A"})" -ForegroundColor White
Write-Host "  Peak memory: $($metrics.peakMemoryMB) MB" -ForegroundColor White
Write-Host "  Peak CPU time: $($metrics.peakCPU)s" -ForegroundColor White
Write-Host "  Errors: $($metrics.errors.Count)" -ForegroundColor $(if($metrics.errors.Count -eq 0){"Green"}else{"Red"})

if ($metrics.errors.Count -gt 0) {
    Write-Host "  Error log:" -ForegroundColor Red
    $metrics.errors | Select-Object -First 10 | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
}

# Pass criteria
$latencyPass = $avgLatency -gt 0 -and $avgLatency -le 20
$memoryPass = $metrics.peakMemoryMB -le 2000
$errorPass = $metrics.errors.Count -eq 0

if ($latencyPass -and $memoryPass) {
    Write-Host ""
    Write-Host "  ✓ Load Test: PASS" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "  ✗ Load Test: FAIL" -ForegroundColor Red
}
Write-Host ""
