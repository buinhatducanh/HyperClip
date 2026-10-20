<#
.SYNOPSIS
    Tinh chinh Windows cho may chay HyperClip 24/7 (RTX 5070).

.DESCRIPTION
    Moi thay doi deu GHI LAI gia tri cu vao windows-tuning-revert.json, va
    -Revert tra lai dung nhu cu. Khong dong vao gi ngoai pham vi liet ke duoi.

    Nhung gi script lam:
      1. Power plan -> High performance, tat sleep / hibernate
      2. Bat Hardware-accelerated GPU Scheduling (HAGS) — giam do tre gui lenh NVENC
      3. Tat Game Bar / Game DVR (ban ghi nen cua Windows chiem chinh NVENC)
      4. Dat HyperClip.exe sang che do "High performance GPU"

    Script nay CO Y KHONG dong vao Windows Defender. Viec loai thu muc khoi
    real-time scan co giup render nhanh hon that (Defender quet tung file .mp4
    vua ghi ra), nhung do la thay doi ve BAO MAT cua may — nguoi dung nen tu
    quyet dinh va tu bam. Cach lam thu cong nam trong
    docs\HUONG-DAN-KHACH-5070-NHAT.md, muc "Tuy chon: loai tru Defender".

    CAN QUYEN ADMIN.

.PARAMETER Revert
    Tra moi thiet lap ve gia tri da luu.
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string] $PackageRoot,
    [switch] $Revert
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $PackageRoot) { $PackageRoot = Split-Path -Parent $ScriptDir }
$revertFile = Join-Path $ScriptDir 'windows-tuning-revert.json'

function Test-Admin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
}
if (-not (Test-Admin)) {
    throw "Can chay bang quyen Administrator. Chuot phai vao CAI-DAT.bat -> Run as administrator."
}

function Write-Ok   { param([string]$m) Write-Host "  OK  $m" -ForegroundColor Green }
function Write-Warn { param([string]$m) Write-Host "  !!  $m" -ForegroundColor Yellow }

# ─── Luu / doc gia tri cu ───────────────────────────────────────────────────
$saved = @{}
if (Test-Path $revertFile) {
    (Get-Content -LiteralPath $revertFile -Raw -Encoding UTF8 | ConvertFrom-Json).PSObject.Properties |
        ForEach-Object { $saved[$_.Name] = $_.Value }
}
function Save-Old { param([string]$Key, $Value) if (-not $saved.ContainsKey($Key)) { $saved[$Key] = $Value } }

function Get-RegValue {
    param([string]$Path, [string]$Name)
    try {
        if (-not (Test-Path $Path)) { return $null }
        return (Get-ItemProperty -Path $Path -Name $Name -ErrorAction Stop).$Name
    } catch { return $null }
}
function Set-RegValue {
    param([string]$Path, [string]$Name, $Value, [string]$Type = 'DWord')
    if (-not (Test-Path $Path)) { New-Item -Path $Path -Force | Out-Null }
    New-ItemProperty -Path $Path -Name $Name -Value $Value -PropertyType $Type -Force | Out-Null
}

$REG = @{
    hags    = @{ p = 'HKLM:\SYSTEM\CurrentControlSet\Control\GraphicsDrivers'; n = 'HwSchMode' }
    gameDvr = @{ p = 'HKCU:\System\GameConfigStore';                           n = 'GameDVR_Enabled' }
    gameBar = @{ p = 'HKCU:\Software\Microsoft\GameBar';                       n = 'AutoGameModeEnabled' }
}

# ════════════════════════════════════════════════════════════════════════════
if ($Revert) {
    Write-Host ""
    Write-Host "Tra lai thiet lap Windows nhu truoc khi cai HyperClip..." -ForegroundColor White
    if (-not (Test-Path $revertFile)) { throw "Khong co file $revertFile — chua tung tinh chinh." }

    if ($saved.ContainsKey('powerScheme') -and $saved['powerScheme']) {
        & powercfg /setactive $saved['powerScheme'] 2>$null
        Write-Ok "Power plan"
    }
    foreach ($k in $REG.Keys) {
        if (-not $saved.ContainsKey($k)) { continue }
        $spec = $REG[$k]
        if ($null -eq $saved[$k]) {
            Remove-ItemProperty -Path $spec.p -Name $spec.n -ErrorAction SilentlyContinue
        } else {
            Set-RegValue -Path $spec.p -Name $spec.n -Value $saved[$k]
        }
        Write-Ok "Registry: $k"
    }
    if ($saved.ContainsKey('gpuPrefExes')) {
        foreach ($e in @($saved['gpuPrefExes'])) {
            Remove-ItemProperty -Path 'HKCU:\Software\Microsoft\DirectX\UserGpuPreferences' `
                                -Name $e -ErrorAction SilentlyContinue
        }
        Write-Ok "GPU preference"
    }
    Remove-Item -LiteralPath $revertFile -Force
    Write-Host ""
    Write-Host "Da tra lai nhu cu." -ForegroundColor Green
    return
}

Write-Host ""
Write-Host "Tinh chinh Windows cho HyperClip (RTX 5070, chay 24/7)" -ForegroundColor White
Write-Host ""

# ─── 1. Power plan ──────────────────────────────────────────────────────────
# May chay 24/7 ma ngu thi poller chet, khach mat video. Man hinh van tat duoc.
try {
    $active = (& powercfg /getactivescheme) -join ' '
    if ($active -match '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})') {
        Save-Old 'powerScheme' $Matches[1]
    }
    if ($PSCmdlet.ShouldProcess('Power plan', 'High performance + khong ngu')) {
        # 8c5e7fda-... = SCHEME_MIN (High performance), GUID co dinh cua Windows
        & powercfg /setactive '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c' 2>$null
        & powercfg /change standby-timeout-ac   0  2>$null
        & powercfg /change hibernate-timeout-ac 0  2>$null
        & powercfg /change disk-timeout-ac      0  2>$null
        & powercfg /change monitor-timeout-ac  15  2>$null
        Write-Ok "Power plan: High performance, khong sleep/hibernate (man hinh van tat sau 15 phut)"
    }
} catch { Write-Warn "Power plan: $($_.Exception.Message)" }

# ─── 2. HAGS ────────────────────────────────────────────────────────────────
try {
    Save-Old 'hags' (Get-RegValue -Path $REG.hags.p -Name $REG.hags.n)
    if ($PSCmdlet.ShouldProcess('HwSchMode', 'Bat GPU Scheduling')) {
        Set-RegValue -Path $REG.hags.p -Name $REG.hags.n -Value 2
        Write-Ok "Hardware-accelerated GPU Scheduling: BAT (can khoi dong lai may)"
    }
} catch { Write-Warn "HAGS: $($_.Exception.Message)" }

# ─── 3. Game DVR / Game Bar ─────────────────────────────────────────────────
# Ban ghi nen cua Windows dung chung chip NVENC voi render.
try {
    Save-Old 'gameDvr' (Get-RegValue -Path $REG.gameDvr.p -Name $REG.gameDvr.n)
    Save-Old 'gameBar' (Get-RegValue -Path $REG.gameBar.p -Name $REG.gameBar.n)
    if ($PSCmdlet.ShouldProcess('Game DVR', 'Tat')) {
        Set-RegValue -Path $REG.gameDvr.p -Name $REG.gameDvr.n -Value 0
        Set-RegValue -Path $REG.gameBar.p -Name $REG.gameBar.n -Value 0
        Write-Ok "Game Bar / Game DVR: TAT (khong con giu NVENC nen)"
    }
} catch { Write-Warn "Game DVR: $($_.Exception.Message)" }

# ─── 4. Uu tien GPU roi cho HyperClip ───────────────────────────────────────
try {
    $p = 'HKCU:\Software\Microsoft\DirectX\UserGpuPreferences'
    $exes = @(
        (Join-Path $PackageRoot 'HyperClip.exe'),
        (Join-Path $PackageRoot 'app\HyperClip.exe')
    ) | Where-Object { Test-Path $_ }
    Save-Old 'gpuPrefExes' $exes
    foreach ($e in $exes) {
        if ($PSCmdlet.ShouldProcess($e, 'Dat High performance GPU')) {
            Set-RegValue -Path $p -Name $e -Value 'GpuPreference=2;' -Type String
        }
    }
    Write-Ok "GPU preference: High performance cho $($exes.Count) file exe"
} catch { Write-Warn "GPU preference: $($_.Exception.Message)" }

# ─── Ghi file revert ────────────────────────────────────────────────────────
$json = [pscustomobject]$saved | ConvertTo-Json -Depth 6
[System.IO.File]::WriteAllText($revertFile, $json, (New-Object System.Text.UTF8Encoding($false)))

Write-Host ""
Write-Host "Xong. Muon tra lai nhu cu:  .\Tune-Windows-Performance.ps1 -Revert" -ForegroundColor Yellow
Write-Host "HAGS chi co hieu luc SAU KHI KHOI DONG LAI MAY." -ForegroundColor Yellow
Write-Host ""
