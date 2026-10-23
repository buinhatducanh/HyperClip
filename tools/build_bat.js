const fs = require('fs');
const path = require('path');

const psScript = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Write-Host "=======================================================================" -ForegroundColor Cyan
Write-Host "   HYPERCLIP - DONG BO TU DONG HO SO TU ADSPOWER (LOCAL API)" -ForegroundColor Cyan
Write-Host "=======================================================================" -ForegroundColor Cyan
Write-Host ""

$apiUrl = if ($env:ADSPOWER_API_URL) { $env:ADSPOWER_API_URL } else { "http://127.0.0.1:50325" }

# 1. Kiem tra AdsPower Local API
Write-Host "[1/3] Dang ket noi toi AdsPower Local API ($apiUrl)..." -ForegroundColor Yellow
try {
    $statusRes = Invoke-RestMethod -Uri "$apiUrl/status" -TimeoutSec 3 -ErrorAction Stop
    Write-Host "      -> AdsPower Local API: DANG SAN SANG (Online)" -ForegroundColor Green
    Write-Host ""
} catch {
    Write-Host "      -> [LOI] Khong ket noi duoc toi AdsPower Local API!" -ForegroundColor Red
    Write-Host "         Chi tiet: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host ""
    Write-Host "   HUONG DAN KHAC PHUC:" -ForegroundColor Yellow
    Write-Host "      1. Mo ung dung AdsPower tren may tinh."
    Write-Host "      2. Vao Cai dat (Settings) -> Chon muc Local API."
    Write-Host "      3. Bat [ON] Local API va dam bao cong la 50325."
    Write-Host "      4. Sau do nhap dup chay lai file nay."
    Write-Host ""
    return
}

# 2. Lay danh sach ho so (Profiles)
Write-Host "[2/3] Dang tai danh sach ho so tu AdsPower..." -ForegroundColor Yellow
$profileList = @()
try {
    $userRes = Invoke-RestMethod -Uri "$apiUrl/api/v1/user/list?page=1&page_size=100" -TimeoutSec 5 -ErrorAction Stop
    if ($userRes.code -ne 0) { throw $userRes.msg }
    if ($userRes.data -and $userRes.data.list) { $profileList = @($userRes.data.list) }
} catch {
    Write-Host "      -> [LOI] Khong the doc danh sach ho so: $($_.Exception.Message)" -ForegroundColor Red
    return
}

if ($profileList.Count -eq 0) {
    Write-Host "      -> Khong tim thay ho so nao tren AdsPower! Hay tao ho so truoc." -ForegroundColor Yellow
    return
}

Write-Host "      -> Da phat hien $($profileList.Count) ho so tren AdsPower!" -ForegroundColor Green
Write-Host ""

# 3. Tim vi tri cac file tiktok.json can dong bo
Write-Host "[3/3] Dang cap nhat vao cau hinh HyperClip (tiktok.json)..." -ForegroundColor Yellow
$scriptDir = (Get-Location).Path

$candidatePaths = @(
    (Join-Path $scriptDir "HyperClipB-Package\\HyperClipB-Data\\.hyperclip\\tiktok.json"),
    (Join-Path $scriptDir "HyperClipB-Data\\.hyperclip\\tiktok.json"),
    (Join-Path $scriptDir "HyperClip-Data\\.hyperclip\\tiktok.json"),
    (Join-Path $scriptDir "..\\HyperClipB-Package\\HyperClipB-Data\\.hyperclip\\tiktok.json"),
    (Join-Path $scriptDir "..\\HyperClipB-Data\\.hyperclip\\tiktok.json"),
    (Join-Path $scriptDir "..\\HyperClip-Data\\.hyperclip\\tiktok.json"),
    "C:\\HyperClipB-Package\\HyperClipB-Data\\.hyperclip\\tiktok.json",
    "C:\\HyperClip-Data\\.hyperclip\\tiktok.json"
)

$newAccounts = @()
$idx = 1
foreach ($p in $profileList) {
    $label = if ($p.name) {
        if ($p.name.StartsWith("@")) { $p.name } else { "@" + $p.name }
    } else {
        "@Profile_" + (if ($p.serial_number) { $p.serial_number } else { $p.user_id })
    }

    $serial = if ($p.serial_number) { [string]$p.serial_number } else { [string]$idx }

    $newAccounts += [ordered]@{
        id              = "adspower_" + (if ($p.user_id) { $p.user_id } else { $p.serial_number })
        label           = $label
        profileId       = [string]$p.user_id
        adsPowerSerial  = $serial
        captionMode     = "auto"
        captionTemplate = ""
        enabled         = $true
        status          = "connected"
        groupName       = if ($p.group_name) { [string]$p.group_name } else { "" }
        createdAt       = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        lastUploadAt    = $null
    }
    $idx++
}

$updatedAny = $false
foreach ($tPath in $candidatePaths) {
    $parentDir = Split-Path -Parent $tPath
    if (Test-Path $parentDir) {
        try {
            $existing = @{ accounts = @(); mappings = @{}; history = @() }
            if (Test-Path $tPath) {
                try {
                    $jsonContent = Get-Content -LiteralPath $tPath -Raw -Encoding UTF8
                    $parsed = $jsonContent | ConvertFrom-Json
                    if ($parsed.mappings) { $existing.mappings = $parsed.mappings }
                    if ($parsed.history)  { $existing.history = $parsed.history }
                } catch {}
            }

            $existing.accounts = $newAccounts
            $jsonOut = $existing | ConvertTo-Json -Depth 10
            [System.IO.File]::WriteAllText($tPath, $jsonOut, [System.Text.Encoding]::UTF8)
            Write-Host "      -> Da cap nhat: $tPath" -ForegroundColor Green
            $updatedAny = $true
        } catch {
            Write-Host ("      -> Loi khi ghi {0}: {1}" -f $tPath, $_.Exception.Message) -ForegroundColor Red
        }
    }
}

if (-not $updatedAny) {
    $fallbackDir = Join-Path $scriptDir "HyperClipB-Package\\HyperClipB-Data\\.hyperclip"
    $fallbackPath = Join-Path $fallbackDir "tiktok.json"
    New-Item -ItemType Directory -Path $fallbackDir -Force | Out-Null
    $existing = @{ accounts = $newAccounts; mappings = @{}; history = @() }
    $jsonOut = $existing | ConvertTo-Json -Depth 10
    [System.IO.File]::WriteAllText($fallbackPath, $jsonOut, [System.Text.Encoding]::UTF8)
    Write-Host "      -> Khoi tao moi tai: $fallbackPath" -ForegroundColor Green
}

# 4. In bang danh sach doi chieu
Write-Host ""
Write-Host "=======================================================================" -ForegroundColor Cyan
Write-Host "   DANH SACH HO SO ADSPOWER DA LIEN KET THANH CONG:" -ForegroundColor Cyan
Write-Host "=======================================================================" -ForegroundColor Cyan
Write-Host ("{0,-5} | {1,-10} | {2,-16} | {3,-30}" -f "STT", "Serial", "Profile ID", "Ten Profile / TikTok")
Write-Host "-----------------------------------------------------------------------"
$i = 1
foreach ($acc in $newAccounts) {
    $stt = "$i"
    $ser = [string]$acc.adsPowerSerial
    $pid = [string]$acc.profileId
    $name = [string]$acc.label
    if ($name.Length -gt 30) { $name = $name.Substring(0, 27) + "..." }
    Write-Host ("{0,-5} | {1,-10} | {2,-16} | {3,-30}" -f $stt, $ser, $pid, $name)
    $i++
}
Write-Host "=======================================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host " Hoan tat! HyperClip da nhan dien day du $($newAccounts.Count) tai khoan tu AdsPower." -ForegroundColor Green
Write-Host " Bay gio ban chi can mo app HyperClip la app se tu dung cac ho so nay!" -ForegroundColor Green
Write-Host ""
`;

// Encode as UTF-16LE Base64 (required by PowerShell -EncodedCommand)
const buffer = Buffer.from(psScript, 'utf16le');
const base64 = buffer.toString('base64');

const batContent = `@echo off
chcp 65001 >nul
title DONG BO HO SO ADSPOWER VAO HYPERCLIP
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${base64}
echo.
pause
`;

fs.writeFileSync(path.resolve(__dirname, '../DONG_BO_ADSPOWER.bat'), batContent, 'utf8');
console.log('Successfully generated standalone DONG_BO_ADSPOWER.bat');
