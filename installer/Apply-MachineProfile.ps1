<#
.SYNOPSIS
    Ap mot machine profile (deploy/profiles/*.json) vao settings.json cua HyperClip.

.DESCRIPTION
    Doc profile, do phan cung that (VRAM qua nvidia-smi, RAM qua CIM), xoa cac khoa
    chet, roi merge overlay vao <DataDir>\.hyperclip\settings.json.

    Chay duoc doc lap: neu sau nay khach doi card hoac nang RAM, chay lai script nay
    la du, khong can cai lai app.

.PARAMETER DataDir
    Thu muc HyperClip-Data. Mac dinh: <thu muc cha cua script>\HyperClip-Data.

.PARAMETER ProfilePath
    Duong dan toi file profile JSON.

.PARAMETER Force
    Ap profile ngay ca khi ten GPU khong khop targetGpuMatch.

.PARAMETER WhatIf
    Chi in ra nhung gi se doi, khong ghi file.
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string] $DataDir,
    [string] $ProfilePath,
    [switch] $Force,

    # Ghi de ket qua do phan cung. Dung de operator dung thu / kiem tra truoc
    # file settings.json ngay tren may dev truoc khi gui goi cho khach.
    [string] $AssumeGpuName,
    [int]    $AssumeVramGB,
    [int]    $AssumeRamGB
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# Duoi Set-StrictMode -Version Latest, `$obj.PSObject.Properties.Name` NEM LOI
# khi object khong co property nao (truy cap .Name tren tap rong). Do dung dip
# settings.json vua tao con la "{}" nen phai di qua ham nay, khong goi truc tiep.
function Get-PropNames {
    param($Obj)
    if ($null -eq $Obj) { return @() }
    return @($Obj.PSObject.Properties | ForEach-Object { $_.Name })
}
function Test-HasProp {
    param($Obj, [string]$Name)
    return ((Get-PropNames $Obj) -contains $Name)
}

function Write-Step { param([string]$m) Write-Host "  -> $m" -ForegroundColor Cyan }
function Write-Ok   { param([string]$m) Write-Host "  OK  $m" -ForegroundColor Green }
function Write-Warn { param([string]$m) Write-Host "  !!  $m" -ForegroundColor Yellow }

# ─── Resolve paths ──────────────────────────────────────────────────────────
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $DataDir) {
    $DataDir = Join-Path (Split-Path -Parent $ScriptDir) 'HyperClip-Data'
}
if (-not $ProfilePath) {
    $candidates = @(
        (Join-Path $ScriptDir 'machine-profile.json'),
        (Join-Path $ScriptDir '..\profiles\rtx5070-jp.json')
    )
    $ProfilePath = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $ProfilePath -or -not (Test-Path $ProfilePath)) {
    throw "Khong tim thay file profile. Truyen -ProfilePath <duong dan>."
}

$prof      = Get-Content -LiteralPath $ProfilePath -Raw -Encoding UTF8 | ConvertFrom-Json
$storeDir     = Join-Path $DataDir '.hyperclip'
$settingsPath = Join-Path $storeDir 'settings.json'

Write-Host ""
Write-Host "Machine profile : $($prof.displayName)" -ForegroundColor White
Write-Host "settings.json   : $settingsPath" -ForegroundColor White
Write-Host ""

# ─── 1. Do phan cung that ───────────────────────────────────────────────────
Write-Step "Do phan cung..."

$detected = @{ gpuName = ''; gpuVramGB = 0; systemRamGB = 0; driver = '' }

$smi = Get-Command nvidia-smi -ErrorAction SilentlyContinue
if ($smi) {
    # nvidia-smi tra "name, memory.total(MiB), driver_version"
    $raw = & nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader,nounits 2>$null
    if ($LASTEXITCODE -eq 0 -and $raw) {
        $line = ($raw | Select-Object -First 1) -split ','
        if ($line.Count -ge 3) {
            $detected.gpuName = $line[0].Trim()
            # MiB -> GB, lam tron len (12288 MiB = 12 GB)
            $detected.gpuVramGB = [int][Math]::Round([double]$line[1].Trim() / 1024.0, 0)
            $detected.driver = $line[2].Trim()
        }
    }
}
if (-not $detected.gpuName) {
    Write-Warn "Khong chay duoc nvidia-smi — khong do duoc GPU."
}

# Get-CimInstance chi co tren Windows PowerShell / pwsh tren Windows.
try {
    if (Get-Command Get-CimInstance -ErrorAction SilentlyContinue) {
        $os = Get-CimInstance Win32_ComputerSystem -ErrorAction Stop
        if ($os) { $detected.systemRamGB = [int][Math]::Round($os.TotalPhysicalMemory / 1GB, 0) }
    }
} catch {
    Write-Warn "Khong doc duoc dung luong RAM qua CIM: $($_.Exception.Message)"
}

# Tham so -Assume* de len tren ket qua do duoc.
if ($AssumeGpuName) { $detected.gpuName    = $AssumeGpuName; Write-Warn "Dung -AssumeGpuName: $AssumeGpuName" }
if ($AssumeVramGB)  { $detected.gpuVramGB  = $AssumeVramGB;  Write-Warn "Dung -AssumeVramGB: $AssumeVramGB" }
if ($AssumeRamGB)   { $detected.systemRamGB = $AssumeRamGB;  Write-Warn "Dung -AssumeRamGB: $AssumeRamGB" }

Write-Host "     GPU    : $($detected.gpuName)  ($($detected.gpuVramGB) GB VRAM)"
Write-Host "     Driver : $($detected.driver)"
Write-Host "     RAM    : $($detected.systemRamGB) GB"

# ─── 2. Kiem tra profile co dung may nay khong ──────────────────────────────
if ($detected.gpuName) {
    $rejected = $false
    if (Test-HasProp $prof 'targetGpuReject') {
        foreach ($r in $prof.targetGpuReject) {
            if ($detected.gpuName -like "*$r*") { $rejected = $true; break }
        }
    }
    $matched = $false
    foreach ($m in $prof.targetGpuMatch) {
        if ($detected.gpuName -like "*$m*") { $matched = $true; break }
    }
    if ($rejected -or -not $matched) {
        $msg = "GPU '$($detected.gpuName)' khong khop profile '$($prof.profileId)' (can: $($prof.targetGpuMatch -join ', '))."
        if ($Force) {
            Write-Warn "$msg  -Force duoc bat, van ap."
        } else {
            Write-Warn $msg
            throw "Dung lai de tranh ap sai cau hinh. Chay lai voi -Force neu ban chac chan."
        }
    } else {
        Write-Ok "GPU khop profile."
    }
}

if ($detected.driver -and (Test-HasProp $prof 'minNvidiaDriver')) {
    try {
        if ([version]$detected.driver -lt [version]$prof.minNvidiaDriver) {
            Write-Warn "Driver NVIDIA $($detected.driver) cu hon muc toi thieu $($prof.minNvidiaDriver) cho NVENC Blackwell. Hay cap nhat driver."
        }
    } catch { }
}

# ─── 3. Doc settings.json hien co ───────────────────────────────────────────
if (-not (Test-Path $storeDir)) {
    if ($PSCmdlet.ShouldProcess($storeDir, 'Tao thu muc')) {
        New-Item -ItemType Directory -Path $storeDir -Force | Out-Null
    }
}

$root = $null
if (Test-Path $settingsPath) {
    $backup = "$settingsPath.bak-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    if ($PSCmdlet.ShouldProcess($settingsPath, "Sao luu -> $(Split-Path -Leaf $backup)")) {
        Copy-Item -LiteralPath $settingsPath -Destination $backup -Force
        Write-Ok "Da sao luu settings cu: $(Split-Path -Leaf $backup)"
    }
    try {
        $root = Get-Content -LiteralPath $settingsPath -Raw -Encoding UTF8 | ConvertFrom-Json
    } catch {
        Write-Warn "settings.json cu hong, tao lai tu dau. ($_)"
        $root = $null
    }
}

# SettingsStore cua Rust luon boc trong { "settings": { ... } }.
if (-not $root) { $root = [pscustomobject]@{ settings = [pscustomobject]@{} } }
if (-not (Test-HasProp $root 'settings') -or $null -eq $root.settings) {
    $root | Add-Member -NotePropertyName settings -NotePropertyValue ([pscustomobject]@{}) -Force
}
$s = $root.settings

function Set-Key {
    param([object]$Obj, [string]$Name, [object]$Value)
    $old = if (Test-HasProp $Obj $Name) { $Obj.$Name } else { $null }
    $oldStr = if ($null -eq $old) { '(khong co)' } else { ($old | ConvertTo-Json -Compress -Depth 5) }
    $newStr = ($Value | ConvertTo-Json -Compress -Depth 5)
    if ($oldStr -ne $newStr) {
        Write-Host ("     {0,-28} {1}  ->  {2}" -f $Name, $oldStr, $newStr)
    }
    $Obj | Add-Member -NotePropertyName $Name -NotePropertyValue $Value -Force
}

# ─── 4. Xoa khoa chet ───────────────────────────────────────────────────────
Write-Step "Xoa cac khoa chet..."
$removed = 0
foreach ($k in $prof.removeKeys) {
    if (Test-HasProp $s $k) {
        $s.PSObject.Properties.Remove($k)
        Write-Host "     - $k"
        $removed++
    }
}
Write-Ok "$removed khoa chet da xoa."

# ─── 5. Ap overlay ──────────────────────────────────────────────────────────
Write-Step "Ap gia tri tu profile..."
foreach ($p in $prof.settings.PSObject.Properties) {
    if ($p.Name -eq 'hardwareProfile') { continue }   # xu ly rieng o buoc 6
    Set-Key -Obj $s -Name $p.Name -Value $p.Value
}

# ─── 6. hardwareProfile — lay so DO DUOC, khong lay so trong profile ────────
Write-Step "Ghi hardwareProfile theo phan cung do duoc..."
$hw = [pscustomobject]@{
    vramGB = if ($detected.gpuVramGB -gt 0) { $detected.gpuVramGB } else { [int]$prof.settings.hardwareProfile.vramGB }
    ramGB  = if ($detected.systemRamGB -gt 0) { $detected.systemRamGB } else { [int]$prof.settings.hardwareProfile.ramGB }
}
Set-Key -Obj $s -Name 'hardwareProfile' -Value $hw

# Canh bao neu VRAM do duoc lech xa ky vong -> co the dat nham profile.
if ((Test-HasProp $prof 'expectedVramGB') -and $detected.gpuVramGB -gt 0) {
    if ([Math]::Abs($detected.gpuVramGB - [int]$prof.expectedVramGB) -gt 2) {
        Write-Warn "VRAM do duoc ($($detected.gpuVramGB) GB) lech nhieu so voi ky vong cua profile ($($prof.expectedVramGB) GB)."
    }
}

# ─── 7. Duong dan luu tru — PHAI ghi TUONG DOI ──────────────────────────────
# store/settings.rs SettingsStore::load() chi ghep voi data dir nhung duong dan
# TUONG DOI (is_relative_path); duong dan tuyet doi no giu nguyen. Neu ghi tuyet
# doi o day thi settings.json dong vao goi se mang theo duong dan cua MAY BUILD
# (vd D:\HyperClip-build\...) — tren may khach la thu muc khong ton tai.
# Ghi tuong doi thi Rust tu ghep voi HYPERCLIP_DATA_DIR that luc chay, dung o
# ca hai noi: luc dung goi va luc khach cai.
Write-Step "Dat duong dan luu tru (tuong doi theo data dir)..."
Set-Key -Obj $s -Name 'videoStoragePath' -Value 'downloads'
Set-Key -Obj $s -Name 'outputPath'       -Value 'renders'
Set-Key -Obj $s -Name 'outputFolder'     -Value 'renders'

# ─── 8. Ghi ────────────────────────────────────────────────────────────────
$json = $root | ConvertTo-Json -Depth 12
if ($PSCmdlet.ShouldProcess($settingsPath, 'Ghi settings.json')) {
    # UTF-8 KHONG BOM: serde_json cua Rust khong an duoc BOM.
    $tmp = "$settingsPath.tmp"
    [System.IO.File]::WriteAllText($tmp, $json, (New-Object System.Text.UTF8Encoding($false)))
    Move-Item -LiteralPath $tmp -Destination $settingsPath -Force
    Write-Ok "Da ghi settings.json"
} else {
    Write-Host ""
    Write-Host $json
}

Write-Host ""
Write-Host "Tom tat cau hinh hieu nang se co hieu luc:" -ForegroundColor White
$vram = $hw.vramGB
$ram  = $hw.ramGB
$tierBranch = if ($vram -ge 16) { 'Ultra (>=16GB): render 6 / chunk 14 / preset p4 / tier High' }
        elseif ($vram -ge 12)   { 'High  (>=12GB): render 3 / chunk 6  / preset p3 / tier High' }
        elseif ($vram -ge 8)    { 'Medium (>=8GB): render 2 / chunk 4  / preset p2 / tier Mid' }
        elseif ($vram -ge 6)    { 'Low    (>=6GB): render 2 / chunk 2  / preset p1 / tier Low' }
        else                    { 'Minimal: render 1 / chunk 1 / preset p1 / tier Low' }
Write-Host "   Nhanh phan cung : $tierBranch"
$ramCap = if ($ram -lt 16) { 1 } elseif ($ram -lt 24) { 2 } elseif ($ram -lt 32) { 3 } elseif ($ram -lt 48) { 4 } else { 99 }
Write-Host "   Tran theo RAM   : render_workers <= $ramCap  (RAM $ram GB)"
Write-Host "   maxConcurrentRenders (override cuoi cung) : $($s.maxConcurrentRenders)"
$codec = if ($vram -ge 12) { 'hevc_nvenc' } elseif ($vram -ge 6) { 'h264_nvenc' } else { 'libx264' }
Write-Host "   Encoder du kien : $codec"
Write-Host ""
