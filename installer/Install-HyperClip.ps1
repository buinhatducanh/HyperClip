<#
.SYNOPSIS
    Trinh cai dat HyperClip cho may khach — ban day du (full install).

.DESCRIPTION
    Chay tu trong thu muc da giai nen. Cac buoc:
      1. Kiem tra may (Check-System.ps1) — dung lai neu co loi nghiem trong
      2. Chep toan bo goi sang thu muc cai dat co dinh
      3. Ap machine profile (Apply-MachineProfile.ps1) theo phan cung do duoc
      4. Tinh chinh Windows (tuy chon)
      5. Tao shortcut Desktop + Start Menu, tuy chon tu khoi dong cung Windows
      6. In cac buoc con lai cho khach

    App chay dang portable: launcher.rs tu dat HYPERCLIP_DATA_DIR =
    <thu muc chua HyperClip.exe>\HyperClip-Data. Nen "cai dat" o day chinh la
    dat toan bo thu muc vao mot cho co dinh roi tao shortcut — khong dung
    Program Files (can quyen ghi vao HyperClip-Data luc chay).

.PARAMETER InstallDir
    Noi cai. Mac dinh C:\HyperClip.

.PARAMETER InPlace
    Khong chep di dau, cai ngay tai cho dang giai nen.

.PARAMETER Autostart
    Tao shortcut trong thu muc Startup de app tu chay cung Windows.

.PARAMETER TestMode
    Bat toan bo kenh de test hieu nang (xem Set-TestMode.ps1).

.PARAMETER NoTune
    Bo qua buoc tinh chinh Windows.

.PARAMETER Force
    Van cai tiep du Check-System bao loi.

.EXAMPLE
    .\Install-HyperClip.ps1
    .\Install-HyperClip.ps1 -InstallDir D:\HyperClip -Autostart -TestMode
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string] $InstallDir = 'C:\HyperClip',
    [switch] $InPlace,
    [switch] $Autostart,
    [switch] $TestMode,
    [switch] $NoTune,
    [switch] $NoShortcut,
    [switch] $Force
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ScriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$PackageRoot = Split-Path -Parent $ScriptDir

function Write-Head {
    param([string]$n, [string]$m)
    Write-Host ""
    Write-Host "[$n] $m" -ForegroundColor Cyan
    Write-Host ("-" * 62) -ForegroundColor DarkGray
}
function Write-Ok   { param([string]$m) Write-Host "  OK  $m" -ForegroundColor Green }
function Write-Warn { param([string]$m) Write-Host "  !!  $m" -ForegroundColor Yellow }
function Test-Admin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
}

Write-Host ""
Write-Host "  ============================================================" -ForegroundColor White
Write-Host "     HYPERCLIP  —  CAI DAT DAY DU" -ForegroundColor White
Write-Host "     Cau hinh muc tieu: RTX 5070 12GB / Nhat Ban (JST)" -ForegroundColor Gray
Write-Host "  ============================================================" -ForegroundColor White
Write-Host "  Nguon : $PackageRoot"

# ─── 1. Kiem tra may ────────────────────────────────────────────────────────
Write-Head '1/6' 'Kiem tra may'
$checkScript = Join-Path $ScriptDir 'Check-System.ps1'
$failCount = 0
if (Test-Path $checkScript) {
    & $checkScript -PackageRoot $PackageRoot
    $failCount = $LASTEXITCODE
} else {
    Write-Warn "Khong thay Check-System.ps1 — bo qua buoc kiem tra."
}
if ($failCount -gt 0 -and -not $Force) {
    Write-Host ""
    Write-Host "  DUNG LAI: con $failCount loi can sua o tren." -ForegroundColor Red
    Write-Host "  Sua xong chay lai, hoac them -Force de cai bat chap." -ForegroundColor Red
    exit 1
}
if ($failCount -gt 0) { Write-Warn "Co $failCount loi nhung -Force duoc bat — cai tiep." }

# ─── 2. Chep sang thu muc cai dat ───────────────────────────────────────────
Write-Head '2/6' 'Dat file vao thu muc cai dat'
$Target = $PackageRoot
if ($InPlace) {
    Write-Ok "Cai tai cho: $Target"
} else {
    # So sanh duong dan da chuan hoa — tranh truong hop "C:\HyperClip" vs
    # "C:\HyperClip\" vs duong dan tuong doi lam chep de len chinh no.
    $srcFull = [System.IO.Path]::GetFullPath((Resolve-Path -LiteralPath $PackageRoot).Path).TrimEnd('\')
    $dstFull = [System.IO.Path]::GetFullPath($InstallDir).TrimEnd('\')
    if ($srcFull -ieq $dstFull) {
        Write-Ok "Da nam dung cho: $dstFull"
        $Target = $dstFull
    } else {
        if (Test-Path $InstallDir) {
            $old = Get-ChildItem -LiteralPath $InstallDir -Force -ErrorAction SilentlyContinue
            if ($old) {
                $dataDir = Join-Path $InstallDir 'HyperClip-Data'
                if (Test-Path $dataDir) {
                    Write-Warn "$InstallDir da co san — GIU NGUYEN HyperClip-Data (du lieu, cookie, lich su), chi thay phan chuong trinh."
                } else {
                    Write-Warn "$InstallDir da ton tai va khong rong."
                }
            }
        }
        if ($PSCmdlet.ShouldProcess($InstallDir, 'Chep goi cai dat')) {
            New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
            # Chep tat ca TRU HyperClip-Data neu dich da co du lieu cu.
            $keepData = Test-Path (Join-Path $InstallDir 'HyperClip-Data\.hyperclip')
            Get-ChildItem -LiteralPath $PackageRoot -Force | ForEach-Object {
                if ($keepData -and $_.Name -eq 'HyperClip-Data') {
                    Write-Warn "Bo qua HyperClip-Data (giu du lieu cu cua khach)"
                    return
                }
                Copy-Item -LiteralPath $_.FullName -Destination $InstallDir -Recurse -Force
            }
            Write-Ok "Da chep sang $InstallDir"
        }
        $Target = $InstallDir
    }
}
$TargetInstaller = Join-Path $Target 'installer'
$launcher = Join-Path $Target 'HyperClip.exe'
if (-not (Test-Path $launcher)) { throw "Khong thay $launcher sau khi chep — goi bi thieu file." }

# ─── 3. Machine profile ─────────────────────────────────────────────────────
Write-Head '3/6' 'Ap cau hinh hieu nang cho may nay'
$applyScript = Join-Path $TargetInstaller 'Apply-MachineProfile.ps1'
if (Test-Path $applyScript) {
    & $applyScript -DataDir (Join-Path $Target 'HyperClip-Data')
} else {
    Write-Warn "Khong thay Apply-MachineProfile.ps1 — bo qua. App se dung cau hinh mac dinh."
}

# ─── 4. Tinh chinh Windows ──────────────────────────────────────────────────
Write-Head '4/6' 'Tinh chinh Windows'
if ($NoTune) {
    Write-Warn "Bo qua theo yeu cau (-NoTune)."
} elseif (-not (Test-Admin)) {
    Write-Warn "Khong co quyen Administrator — bo qua buoc nay."
    Write-Host "      Chay lai bang: chuot phai CAI-DAT.bat -> Run as administrator" -ForegroundColor DarkGray
} else {
    $tuneScript = Join-Path $TargetInstaller 'Tune-Windows-Performance.ps1'
    if (Test-Path $tuneScript) { & $tuneScript -PackageRoot $Target }
    else { Write-Warn "Khong thay Tune-Windows-Performance.ps1." }
}

# ─── 5. Shortcut ────────────────────────────────────────────────────────────
Write-Head '5/6' 'Tao shortcut'
function New-Shortcut {
    param([string]$LinkPath, [string]$TargetPath, [string]$WorkDir, [string]$IconPath, [string]$Desc)
    $sh = New-Object -ComObject WScript.Shell
    $lnk = $sh.CreateShortcut($LinkPath)
    $lnk.TargetPath       = $TargetPath
    $lnk.WorkingDirectory = $WorkDir
    $lnk.Description      = $Desc
    if ($IconPath -and (Test-Path $IconPath)) { $lnk.IconLocation = $IconPath }
    $lnk.Save()
}

if ($NoShortcut) {
    Write-Warn "Bo qua theo yeu cau (-NoShortcut)."
} else {
    try {
        $desktop   = [Environment]::GetFolderPath('Desktop')
        $startMenu = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'Microsoft\Windows\Start Menu\Programs'
        foreach ($dir in @($desktop, $startMenu)) {
            if (-not $dir -or -not (Test-Path $dir)) { continue }
            $lnkPath = Join-Path $dir 'HyperClip.lnk'
            if ($PSCmdlet.ShouldProcess($lnkPath, 'Tao shortcut')) {
                New-Shortcut -LinkPath $lnkPath -TargetPath $launcher -WorkDir $Target `
                             -IconPath $launcher -Desc 'HyperClip — tu dong bat va render video'
            }
        }
        Write-Ok "Shortcut: Desktop + Start Menu"
    } catch { Write-Warn "Khong tao duoc shortcut: $($_.Exception.Message)" }

    if ($Autostart) {
        try {
            $startup = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'Microsoft\Windows\Start Menu\Programs\Startup'
            $lnkPath = Join-Path $startup 'HyperClip.lnk'
            if ($PSCmdlet.ShouldProcess($lnkPath, 'Tu khoi dong cung Windows')) {
                New-Shortcut -LinkPath $lnkPath -TargetPath $launcher -WorkDir $Target `
                             -IconPath $launcher -Desc 'HyperClip tu chay cung Windows'
            }
            Write-Ok "Tu khoi dong cung Windows: BAT"
            Write-Host "      (bo bang cach xoa shortcut trong shell:startup)" -ForegroundColor DarkGray
        } catch { Write-Warn "Khong dat duoc tu khoi dong: $($_.Exception.Message)" }
    }
}

# ─── 6. Che do test hieu nang ───────────────────────────────────────────────
Write-Head '6/6' 'Che do test hieu nang'
if ($TestMode) {
    $tm = Join-Path $TargetInstaller 'Set-TestMode.ps1'
    if (Test-Path $tm) { & $tm -On -DataDir (Join-Path $Target 'HyperClip-Data') }
    else { Write-Warn "Khong thay Set-TestMode.ps1." }
} else {
    Write-Host "  Khong bat. Bo kenh cua khach co 42/54 kenh dang de 'off' nen may se rat" -ForegroundColor DarkGray
    Write-Host "  nhan roi. Muon tao tai that de do hieu nang, chay:" -ForegroundColor DarkGray
    Write-Host "     powershell -ExecutionPolicy Bypass -File `"$TargetInstaller\Set-TestMode.ps1`" -On" -ForegroundColor Yellow
}

# ─── Ket ────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  ============================================================" -ForegroundColor Green
Write-Host "     CAI DAT XONG" -ForegroundColor Green
Write-Host "  ============================================================" -ForegroundColor Green
Write-Host "  Thu muc cai   : $Target"
Write-Host "  Chay app      : bam shortcut HyperClip tren Desktop"
Write-Host "  Khi loi       : chay HyperClip-Debug.bat de xem log truc tiep"
Write-Host "  Log           : $Target\HyperClip-Data\logs\"
Write-Host ""
Write-Host "  CON 2 VIEC KHACH PHAI TU LAM (khong the lam ho tu xa):" -ForegroundColor Yellow
Write-Host "    1. Dang nhap YouTube bang Chrome ngay trong app (buoc 1 cua wizard)."
Write-Host "       Cookie Chrome ma hoa gan voi tai khoan Windows nen KHONG the"
Write-Host "       chep tu may khac sang — bat buoc dang nhap tren chinh may nay."
Write-Host "    2. Khoi dong lai may mot lan de HAGS co hieu luc."
Write-Host ""
Write-Host "  LUU Y GIO GIAC (may dat o Nhat):" -ForegroundColor Yellow
Write-Host "    - Khung gio quet cua kenh tinh theo GIO VIET NAM (UTC+7), khong"
Write-Host "      phai gio may. Dat '18:00' trong app = 20:00 gio Nhat."
Write-Host "    - Quota API reset luc 17:00 gio Nhat hang ngay."
Write-Host ""
