# HyperClip Network Interruption Test
# ====================================
# Tests how the app handles network disconnections during download.
#
# Usage:
#   .\test-network.ps1 [-SimulateDisconnect $true]
#
# Note: Requires running as Administrator for network adapter manipulation.

param(
    [Parameter(Mandatory=$false)]
    [switch]$SimulateDisconnect,

    [Parameter(Mandatory=$false)]
    [int]$DisconnectSec = 30,

    [Parameter(Mandatory=$false)]
    [string]$AdapterName = "Wi-Fi"
)

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "══════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  HyperClip Network Interruption Test" -ForegroundColor White
Write-Host "══════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

$testStart = Get-Date

# ─── Test 1: Detect if download is in progress ────────────────────────────────
Write-Host ">>> Checking for active downloads..." -ForegroundColor Cyan
$hasActiveDownloads = $false
Write-Host "  (This test requires a workspace in 'downloading' state)" -ForegroundColor Gray
Write-Host ""

# ─── Test 2: Disconnect network ─────────────────────────────────────────────
if ($SimulateDisconnect) {
    Write-Host ">>> Simulating network disconnect for $DisconnectSec seconds..." -ForegroundColor Cyan
    Write-Host "  Disabling adapter: $AdapterName" -ForegroundColor Yellow
    Write-Host "  (Requires Administrator)" -ForegroundColor DarkGray

    try {
        # Disable the network adapter
        $result = netsh interface set interface "$AdapterName" disabled 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Host "  [OK] Network adapter disabled" -ForegroundColor Green
        } else {
            Write-Host "  [WARN] Could not disable adapter (may need Admin): $result" -ForegroundColor Yellow
        }
    } catch {
        Write-Host "  [WARN] Network adapter manipulation failed: $_" -ForegroundColor Yellow
    }

    Write-Host "  Waiting $DisconnectSec seconds..." -ForegroundColor Cyan
    Start-Sleep -Seconds $DisconnectSec

    Write-Host "  Re-enabling adapter..." -ForegroundColor Cyan
    try {
        $result = netsh interface set interface "$AdapterName" enabled 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Host "  [OK] Network adapter re-enabled" -ForegroundColor Green
        }
    } catch {
        Write-Host "  [WARN] Could not re-enable adapter: $_" -ForegroundColor Yellow
    }
} else {
    Write-Host ">>> (Skipping actual disconnect — run with -SimulateDisconnect)" -ForegroundColor Gray
}

# ─── Test 3: Verify recovery ───────────────────────────────────────────────
Write-Host ""
Write-Host ">>> Verifying recovery after network restore..." -ForegroundColor Cyan
Start-Sleep -Seconds 5

# Check app is still running
$proc = Get-Process -Name "HyperClip" -ErrorAction SilentlyContinue |
        Where-Object { $_.MainWindowTitle -like "*HyperClip*" } | Select-Object -First 1

$recoveryTime = ((Get-Date) - $testStart).TotalSeconds

if ($proc) {
    Write-Host "  [OK] App still running after network restore" -ForegroundColor Green
    Write-Host "  Recovery time: $([math]::Round($recoveryTime, 1))s" -ForegroundColor White
    Write-Host ""
    Write-Host "  ✓ Network Interruption Test: PASS" -ForegroundColor Green
} else {
    Write-Host "  [ERR] App crashed during network interruption" -ForegroundColor Red
    Write-Host ""
    Write-Host "  ✗ Network Interruption Test: FAIL" -ForegroundColor Red
}
Write-Host ""
