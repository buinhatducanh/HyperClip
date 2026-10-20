<#
.SYNOPSIS
    Kiem tra may khach da du dieu kien chay HyperClip chua. Khong sua gi ca.

.DESCRIPTION
    In bang ket qua PASS / WARN / FAIL. Dung truoc khi cai, va dung lai moi khi
    may co van de de gui ket qua cho ky thuat.

.PARAMETER PackageRoot
    Thu muc goc cua goi (cho co HyperClip.exe). Mac dinh: thu muc cha cua script.

.PARAMETER Json
    Xuat ket qua dang JSON (de dinh kem khi bao loi).
#>
[CmdletBinding()]
param(
    [string] $PackageRoot,
    [switch] $Json
)

$ErrorActionPreference = 'Continue'
Set-StrictMode -Version Latest

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $PackageRoot) { $PackageRoot = Split-Path -Parent $ScriptDir }

$results = New-Object System.Collections.Generic.List[object]
function Add-Check {
    param([string]$Area, [string]$Name, [string]$Status, [string]$Detail, [string]$Fix = '')
    $results.Add([pscustomobject]@{ area = $Area; name = $Name; status = $Status; detail = $Detail; fix = $Fix })
}

# ─── Windows ────────────────────────────────────────────────────────────────
try {
    $osInfo = Get-CimInstance Win32_OperatingSystem -ErrorAction Stop
    $build  = [int]$osInfo.BuildNumber
    $is64   = [Environment]::Is64BitOperatingSystem
    if (-not $is64) {
        Add-Check 'He dieu hanh' 'Windows 64-bit' 'FAIL' "$($osInfo.Caption)" 'HyperClip chi chay tren Windows 64-bit.'
    } elseif ($build -lt 19041) {
        Add-Check 'He dieu hanh' 'Phien ban Windows' 'WARN' "$($osInfo.Caption) build $build" 'Nen dung Windows 10 2004 (build 19041) tro len.'
    } else {
        Add-Check 'He dieu hanh' 'Phien ban Windows' 'PASS' "$($osInfo.Caption) build $build"
    }
} catch { Add-Check 'He dieu hanh' 'Phien ban Windows' 'WARN' "Khong doc duoc: $($_.Exception.Message)" }

# ─── Timezone (chi de log de doc — logic app khong phu thuoc) ───────────────
try {
    $tz = (Get-TimeZone).Id
    if ($tz -eq 'Tokyo Standard Time') {
        Add-Check 'Khu vuc' 'Mui gio' 'PASS' "$tz (JST, UTC+9)"
    } else {
        Add-Check 'Khu vuc' 'Mui gio' 'WARN' $tz 'May dat o Nhat nen de "Tokyo Standard Time" cho log de doi chieu. Logic quet KHONG phu thuoc mui gio may.'
    }
} catch { Add-Check 'Khu vuc' 'Mui gio' 'WARN' 'Khong doc duoc mui gio' }

# ─── GPU / NVENC ────────────────────────────────────────────────────────────
$gpuName = ''; $vramGB = 0; $driver = ''
if (Get-Command nvidia-smi -ErrorAction SilentlyContinue) {
    $raw = & nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader,nounits 2>$null
    if ($LASTEXITCODE -eq 0 -and $raw) {
        $p = ($raw | Select-Object -First 1) -split ','
        if ($p.Count -ge 3) {
            $gpuName = $p[0].Trim()
            $vramGB  = [int][Math]::Round([double]$p[1].Trim() / 1024.0, 0)
            $driver  = $p[2].Trim()
        }
    }
}
if (-not $gpuName) {
    Add-Check 'GPU' 'Card NVIDIA' 'FAIL' 'Khong chay duoc nvidia-smi' 'Cai driver NVIDIA. Khong co NVENC thi render se dung CPU, cham hang chuc lan.'
} else {
    Add-Check 'GPU' 'Card' 'PASS' "$gpuName ($vramGB GB VRAM)"

    # Blackwell (RTX 50xx) can driver R570 tro len cho NVENC gen 9.
    if ($gpuName -match 'RTX 50\d\d') {
        $minDrv = [version]'572.16'
        try {
            if ([version]$driver -lt $minDrv) {
                Add-Check 'GPU' 'Driver NVIDIA' 'FAIL' "$driver" "Card Blackwell can driver >= $minDrv. Tai tai nvidia.com/Download."
            } else {
                Add-Check 'GPU' 'Driver NVIDIA' 'PASS' "$driver"
            }
        } catch { Add-Check 'GPU' 'Driver NVIDIA' 'WARN' "Khong doc duoc so hieu driver: $driver" }
    } else {
        Add-Check 'GPU' 'Driver NVIDIA' 'PASS' "$driver"
    }

    if ($vramGB -lt 8) {
        Add-Check 'GPU' 'VRAM' 'WARN' "$vramGB GB" 'Duoi 8GB thi app tu ha xuong tier thap, render se cham.'
    } else {
        Add-Check 'GPU' 'VRAM' 'PASS' "$vramGB GB"
    }
}

# ─── RAM / dia ──────────────────────────────────────────────────────────────
try {
    $ramGB = [int][Math]::Round((Get-CimInstance Win32_ComputerSystem -ErrorAction Stop).TotalPhysicalMemory / 1GB, 0)
    if     ($ramGB -lt 16) { Add-Check 'Phan cung' 'RAM' 'FAIL' "$ramGB GB" 'Duoi 16GB app tu ep ve 1 luong render.' }
    elseif ($ramGB -lt 32) { Add-Check 'Phan cung' 'RAM' 'WARN' "$ramGB GB" 'Duoi 32GB bi cap so luong render song song.' }
    else                   { Add-Check 'Phan cung' 'RAM' 'PASS' "$ramGB GB" }
} catch { Add-Check 'Phan cung' 'RAM' 'WARN' 'Khong doc duoc dung luong RAM' }

try {
    $drive = (Get-Item -LiteralPath $PackageRoot).PSDrive.Name
    $free  = [int][Math]::Round((Get-PSDrive $drive).Free / 1GB, 0)
    if     ($free -lt 20) { Add-Check 'Phan cung' 'Dung luong trong' 'FAIL' "$free GB tren o $drive`:" 'Can it nhat 50GB cho video tai ve.' }
    elseif ($free -lt 50) { Add-Check 'Phan cung' 'Dung luong trong' 'WARN' "$free GB tren o $drive`:" 'Nen co 50GB tro len.' }
    else                  { Add-Check 'Phan cung' 'Dung luong trong' 'PASS' "$free GB tren o $drive`:" }
} catch { Add-Check 'Phan cung' 'Dung luong trong' 'WARN' 'Khong do duoc dung luong trong' }

# ─── Cac file trong goi ─────────────────────────────────────────────────────
$need = @(
    @{ p = 'HyperClip.exe';                              why = 'trinh khoi dong' },
    @{ p = 'app\HyperClip.exe';                          why = 'ung dung chinh' },
    @{ p = 'app\_internal\hyperclip-tauri.exe';          why = 'backend Rust' },
    @{ p = 'app\_internal\resources\ffmpeg\bin\ffmpeg.exe'; why = 'render video' },
    @{ p = 'app\_internal\resources\yt-dlp\yt-dlp.exe';  why = 'tai video' },
    @{ p = 'app\_internal\resources\node\node.exe';      why = 'tai native + upload TikTok' },
    @{ p = 'HyperClip-Data\.hyperclip\settings.json';    why = 'cau hinh' }
)
foreach ($n in $need) {
    $full = Join-Path $PackageRoot $n.p
    if (Test-Path $full) {
        Add-Check 'Goi cai dat' $n.p 'PASS' $n.why
    } else {
        Add-Check 'Goi cai dat' $n.p 'FAIL' "Thieu — $($n.why)" 'Giai nen lai goi, hoac tai lai tu Drive (co the tai thieu file).'
    }
}

# ─── Chrome (bat buoc cho dang nhap YouTube + upload TikTok) ────────────────
$chrome = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if ($chrome) { Add-Check 'Phu thuoc' 'Google Chrome' 'PASS' $chrome }
else { Add-Check 'Phu thuoc' 'Google Chrome' 'FAIL' 'Khong tim thay' 'Cai Chrome — can de dang nhap YouTube lay cookie va de upload TikTok.' }

# ─── Visual C++ runtime (PySide6/Qt can) ────────────────────────────────────
$vcOk = Test-Path "$env:SystemRoot\System32\vcruntime140.dll"
if ($vcOk) { Add-Check 'Phu thuoc' 'Visual C++ 2015-2022 x64' 'PASS' 'vcruntime140.dll co san' }
else { Add-Check 'Phu thuoc' 'Visual C++ 2015-2022 x64' 'FAIL' 'Thieu vcruntime140.dll' 'Cai "Microsoft Visual C++ Redistributable x64" (co kem trong thu muc prereq cua goi).' }

# ─── Mang ───────────────────────────────────────────────────────────────────
foreach ($h in @('www.googleapis.com', 'www.youtube.com')) {
    try {
        $r = Test-NetConnection -ComputerName $h -Port 443 -WarningAction SilentlyContinue -ErrorAction Stop
        if ($r.TcpTestSucceeded) { Add-Check 'Mang' $h 'PASS' 'ket noi 443 OK' }
        else { Add-Check 'Mang' $h 'FAIL' 'khong mo duoc cong 443' 'Kiem tra firewall / proxy.' }
    } catch { Add-Check 'Mang' $h 'WARN' "Khong kiem tra duoc: $($_.Exception.Message)" }
}

# ─── In ket qua ─────────────────────────────────────────────────────────────
if ($Json) {
    $results | ConvertTo-Json -Depth 5
} else {
    Write-Host ""
    Write-Host "=========== KIEM TRA HE THONG HYPERCLIP ===========" -ForegroundColor White
    $lastArea = ''
    foreach ($r in $results) {
        if ($r.area -ne $lastArea) { Write-Host ""; Write-Host " [$($r.area)]" -ForegroundColor White; $lastArea = $r.area }
        $color = switch ($r.status) { 'PASS' { 'Green' } 'WARN' { 'Yellow' } default { 'Red' } }
        Write-Host ("   {0,-5} {1,-42} {2}" -f $r.status, $r.name, $r.detail) -ForegroundColor $color
        if ($r.fix) { Write-Host ("         -> {0}" -f $r.fix) -ForegroundColor DarkGray }
    }
    $f = @($results | Where-Object status -eq 'FAIL').Count
    $w = @($results | Where-Object status -eq 'WARN').Count
    Write-Host ""
    if ($f -gt 0) { Write-Host " KET LUAN: $f loi CAN SUA, $w canh bao." -ForegroundColor Red }
    elseif ($w -gt 0) { Write-Host " KET LUAN: dat, co $w canh bao nen xem qua." -ForegroundColor Yellow }
    else { Write-Host " KET LUAN: may du dieu kien chay HyperClip." -ForegroundColor Green }
    Write-Host ""
}

exit (@($results | Where-Object status -eq 'FAIL').Count)
