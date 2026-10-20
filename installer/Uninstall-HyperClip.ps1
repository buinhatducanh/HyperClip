<#
.SYNOPSIS
    Go HyperClip khoi may.

.DESCRIPTION
    Mac dinh GIU LAI HyperClip-Data (video, cookie, lich su, cau hinh) va chi go
    phan chuong trinh + shortcut + thiet lap Windows. Muon xoa sach du lieu thi
    them -RemoveData — script se hoi lai mot lan nua truoc khi xoa.

.PARAMETER InstallDir
    Thu muc da cai. Mac dinh: thu muc cha cua script.

.PARAMETER RemoveData
    Xoa luon HyperClip-Data. KHONG HOI PHUC DUOC.

.PARAMETER KeepTuning
    Giu nguyen cac thiet lap Windows da tinh chinh (mac dinh la tra ve nhu cu).
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string] $InstallDir,
    [switch] $RemoveData,
    [switch] $KeepTuning
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $InstallDir) { $InstallDir = Split-Path -Parent $ScriptDir }

function Write-Ok   { param([string]$m) Write-Host "  OK  $m" -ForegroundColor Green }
function Write-Warn { param([string]$m) Write-Host "  !!  $m" -ForegroundColor Yellow }

Write-Host ""
Write-Host "  GO CAI DAT HYPERCLIP" -ForegroundColor White
Write-Host "  Thu muc: $InstallDir"
Write-Host ""

# ─── 1. Dong app ────────────────────────────────────────────────────────────
foreach ($p in @('HyperClip', 'hyperclip-tauri')) {
    $procs = Get-Process -Name $p -ErrorAction SilentlyContinue
    if ($procs) {
        if ($PSCmdlet.ShouldProcess($p, 'Dong tien trinh')) {
            $procs | Stop-Process -Force -ErrorAction SilentlyContinue
            Write-Ok "Da dong $p"
        }
    }
}

# ─── 2. Tra lai thiet lap Windows ───────────────────────────────────────────
if ($KeepTuning) {
    Write-Warn "Giu nguyen thiet lap Windows (-KeepTuning)."
} else {
    $tune = Join-Path $ScriptDir 'Tune-Windows-Performance.ps1'
    $revertFile = Join-Path $ScriptDir 'windows-tuning-revert.json'
    if ((Test-Path $tune) -and (Test-Path $revertFile)) {
        try { & $tune -Revert -PackageRoot $InstallDir }
        catch { Write-Warn "Khong tra lai duoc thiet lap Windows: $($_.Exception.Message)" }
    } else {
        Write-Warn "Khong co gi de tra lai (may chua tung duoc tinh chinh)."
    }
}

# ─── 3. Shortcut ────────────────────────────────────────────────────────────
$appData = [Environment]::GetFolderPath('ApplicationData')
$links = @(
    (Join-Path ([Environment]::GetFolderPath('Desktop')) 'HyperClip.lnk'),
    (Join-Path $appData 'Microsoft\Windows\Start Menu\Programs\HyperClip.lnk'),
    (Join-Path $appData 'Microsoft\Windows\Start Menu\Programs\Startup\HyperClip.lnk')
)
$n = 0
foreach ($l in $links) {
    if (Test-Path $l) {
        if ($PSCmdlet.ShouldProcess($l, 'Xoa shortcut')) { Remove-Item -LiteralPath $l -Force; $n++ }
    }
}
Write-Ok "Da xoa $n shortcut"

# ─── 4. File chuong trinh ───────────────────────────────────────────────────
$dataDir = Join-Path $InstallDir 'HyperClip-Data'
$appDir  = Join-Path $InstallDir 'app'

foreach ($item in @($appDir, (Join-Path $InstallDir 'HyperClip.exe'), (Join-Path $InstallDir 'HyperClip-Debug.bat'))) {
    if (Test-Path $item) {
        if ($PSCmdlet.ShouldProcess($item, 'Xoa')) {
            Remove-Item -LiteralPath $item -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}
Write-Ok "Da go phan chuong trinh"

# ─── 5. Du lieu ─────────────────────────────────────────────────────────────
if ($RemoveData) {
    if (-not (Test-Path $dataDir)) {
        Write-Warn "Khong co HyperClip-Data de xoa."
    } else {
        $size = 0
        try {
            $size = [Math]::Round(((Get-ChildItem -LiteralPath $dataDir -Recurse -File -ErrorAction SilentlyContinue |
                     Measure-Object -Property Length -Sum).Sum) / 1GB, 2)
        } catch { }
        Write-Host ""
        Write-Host "  CANH BAO: sap xoa vinh vien $dataDir ($size GB)." -ForegroundColor Red
        Write-Host "  Bao gom video da tai, ban render, cookie dang nhap, API key, lich su." -ForegroundColor Red
        $ans = Read-Host "  Go nguyen van chu XOA de xac nhan"
        if ($ans -ceq 'XOA') {
            if ($PSCmdlet.ShouldProcess($dataDir, 'Xoa toan bo du lieu')) {
                Remove-Item -LiteralPath $dataDir -Recurse -Force
                Write-Ok "Da xoa toan bo du lieu."
            }
        } else {
            Write-Warn "Khong khop — GIU LAI du lieu."
        }
    }
} else {
    if (Test-Path $dataDir) {
        Write-Host ""
        Write-Host "  Du lieu duoc GIU LAI tai: $dataDir" -ForegroundColor Yellow
        Write-Host "  Muon xoa sach: chay lai voi -RemoveData" -ForegroundColor DarkGray
    }
}

Write-Host ""
Write-Host "  Da go xong." -ForegroundColor Green
Write-Host ""
