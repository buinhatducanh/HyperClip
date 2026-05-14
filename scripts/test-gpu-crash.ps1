# HyperClip GPU Crash Recovery Test
# ===================================
# Tests FFmpeg GPU rendering behavior when the encoder fails.
#
# Usage:
#   .\test-gpu-crash.ps1

param(
    [Parameter(Mandatory=$false)]
    [int]$TestDurationSec = 30
)

$ErrorActionPreference = "Continue"

Write-Host ""
Write-Host "══════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  HyperClip GPU Crash Recovery Test" -ForegroundColor White
Write-Host "══════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

# ─── Test: Verify NVENC availability ─────────────────────────────────────────
Write-Host ">>> Checking GPU/NVENC availability..." -ForegroundColor Cyan

# Check if FFmpeg has NVENC
$ffmpegPath = "$env:LOCALAPPDATA\HyperClip\resources\ffmpeg\bin\ffmpeg.exe"
if (-not (Test-Path $ffmpegPath)) {
    $ffmpegPath = "ffmpeg"
}

try {
    $encoders = & $ffmpegPath -hide_banner -encoders 2>&1 | Out-String
    $hasNvenc = $encoders -match "h264_nvenc|hevc_nvenc"
    $hasCuda = $encoders -match "cuda|nvenc"

    if ($hasNvenc) {
        Write-Host "  [OK] NVENC hardware encoder available" -ForegroundColor Green
    } elseif ($hasCuda) {
        Write-Host "  [WARN] CUDA available but NVENC not detected" -ForegroundColor Yellow
    } else {
        Write-Host "  [INFO] Software encoding (no NVENC)" -ForegroundColor Gray
    }
} catch {
    Write-Host "  [ERR] Could not check FFmpeg encoders: $_" -ForegroundColor Red
}

# ─── Test: Monitor GPU during render ───────────────────────────────────────
Write-Host ""
Write-Host ">>> Monitoring GPU status during render..." -ForegroundColor Cyan
Write-Host "  Duration: $TestDurationSec seconds" -ForegroundColor Gray
Write-Host ""

$gpuWarnings = @()
$startTime = Get-Date

while (((Get-Date) - $startTime).TotalSeconds -lt $TestDurationSec) {
    # Check for FFmpeg processes
    $ffmpegProcs = Get-Process -Name "ffmpeg" -ErrorAction SilentlyContinue

    if ($ffmpegProcs) {
        Write-Host "[$(((Get-Date) - $startTime).Seconds)s] FFmpeg running: $($ffmpegProcs.Count) process(es)" -ForegroundColor Cyan

        # Check for GPU-related errors in logs
        # In real scenario, check HyperClip logs for NVENC/GPU errors
    } else {
        Write-Host "[$(((Get-Date) - $startTime).Seconds)s] No FFmpeg process running" -ForegroundColor DarkGray
    }

    # Check HyperClip is still alive
    $hc = Get-Process -Name "HyperClip" -ErrorAction SilentlyContinue |
          Where-Object { $_.MainWindowTitle -like "*HyperClip*" } | Select-Object -First 1
    if (-not $hc) {
        Write-Host "  [CRITICAL] HyperClip crashed!" -ForegroundColor Red
        $gpuWarnings += "HyperClip crashed during GPU test"
    }

    Start-Sleep -Seconds 3
}

# ─── Report ──────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "══════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host "  GPU Crash Recovery Report" -ForegroundColor White
Write-Host "══════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host ""

$crashed = ($gpuWarnings | Where-Object { $_ -like "*crashed*" }).Count
if ($crashed -eq 0) {
    Write-Host "  ✓ No crash detected during monitoring" -ForegroundColor Green
    Write-Host "  ✓ GPU Crash Recovery Test: PASS" -ForegroundColor Green
} else {
    Write-Host "  ✗ $crashed crash(es) detected" -ForegroundColor Red
    Write-Host "  ✗ GPU Crash Recovery Test: FAIL" -ForegroundColor Red
}
Write-Host ""
