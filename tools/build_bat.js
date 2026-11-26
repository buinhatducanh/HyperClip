const fs = require('fs');
const path = require('path');

const psScript = String.raw`
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Write-Host "=======================================================================" -ForegroundColor Cyan
Write-Host "   HYPERCLIP - DONG BO TU DONG HO SO TU ADSPOWER (LOCAL API)" -ForegroundColor Cyan
Write-Host "=======================================================================" -ForegroundColor Cyan
Write-Host ""

$scriptDir = (Get-Location).Path
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$adsConfigPath = Join-Path $scriptDir "HyperClip-Data\.hyperclip\adspower.json"
$uiIniPath = if ($env:APPDATA) { Join-Path $env:APPDATA "HyperClip\adspower_ui.ini" } else { "" }
$dryRun = ([string]$env:HYPERCLIP_DRY_RUN).Trim() -eq "1"
$noRelaunch = ([string]$env:HYPERCLIP_NO_RELAUNCH).Trim() -eq "1"

$apiUrl = if ($env:ADSPOWER_API_URL) { [string]$env:ADSPOWER_API_URL } else { "" }
$apiKey = if ($env:ADSPOWER_API_KEY) { [string]$env:ADSPOWER_API_KEY } else { "" }

if ((Test-Path $adsConfigPath) -and (-not $apiUrl -or -not $apiKey)) {
    try {
        $cfgJson = [System.IO.File]::ReadAllText($adsConfigPath, [System.Text.Encoding]::UTF8).TrimStart([char]0xFEFF)
        $cfg = $cfgJson | ConvertFrom-Json
        if (-not $apiUrl -and $cfg.apiUrl) { $apiUrl = [string]$cfg.apiUrl }
        if (-not $apiKey -and $cfg.apiKey) { $apiKey = [string]$cfg.apiKey }
    } catch {}
}

if ($uiIniPath -and (Test-Path $uiIniPath) -and (-not $apiUrl -or -not $apiKey)) {
    try {
        $inSec = $false
        foreach ($rawLine in [System.IO.File]::ReadAllLines($uiIniPath, [System.Text.Encoding]::UTF8)) {
            $ln = $rawLine.Trim()
            if (-not $ln -or $ln.StartsWith(";") -or $ln.StartsWith("#")) { continue }
            if ($ln.StartsWith("[")) { $inSec = ($ln -match "^\[AdsPower\]$"); continue }
            if (-not $inSec) { continue }
            $eq = $ln.IndexOf("=")
            if ($eq -lt 0) { continue }
            $k = $ln.Substring(0, $eq).Trim()
            $v = $ln.Substring($eq + 1).Trim()
            if ($v.Length -ge 2 -and $v.StartsWith('"') -and $v.EndsWith('"')) {
                $v = $v.Substring(1, $v.Length - 2).Replace('\"', '"')
            }
            if ($k -eq "apiUrl" -and -not $apiUrl -and $v) { $apiUrl = $v }
            if ($k -eq "apiKey" -and -not $apiKey) { $apiKey = $v }
        }
    } catch {}
}

if (-not $apiUrl) { $apiUrl = "http://127.0.0.1:50325" }
$apiUrl = $apiUrl.Trim().TrimEnd('/')
$apiKey = $apiKey.Trim()

function Invoke-AdsPowerApi {
    param([string]$Endpoint, [int]$TimeoutSec = 8, [int]$Retries = 3)
    for ($attempt = 0; $attempt -le $Retries; $attempt++) {
        $fullUrl = $apiUrl + $Endpoint
        $headers = @{}
        if ($apiKey) {
            $sep = if ($fullUrl.Contains("?")) { "&" } else { "?" }
            if (-not $fullUrl.Contains("api_key=")) {
                $fullUrl = $fullUrl + $sep + "api_key=" + [Uri]::EscapeDataString($apiKey)
            }
            $headers["Authorization"] = "Bearer $apiKey"
        }
        $res = Invoke-RestMethod -Uri $fullUrl -Headers $headers -TimeoutSec $TimeoutSec -ErrorAction Stop
        if ($res -and ($null -ne $res.code) -and ($res.code -ne 0) -and ($res.msg -match "Too many request") -and ($attempt -lt $Retries)) {
            Start-Sleep -Milliseconds 1200
            continue
        }
        return $res
    }
}

# 1. Kiem tra AdsPower Local API
Write-Host "[1/3] Dang ket noi toi AdsPower Local API ($apiUrl)..." -ForegroundColor Yellow
try {
    $statusRes = Invoke-AdsPowerApi -Endpoint "/status" -TimeoutSec 3
    if ($statusRes -and ($null -ne $statusRes.code) -and ($statusRes.code -ne 0) -and (-not $apiKey)) {
        Write-Host "      -> AdsPower yeu cau API Key ($($statusRes.msg))." -ForegroundColor Yellow
        $apiKey = (Read-Host "      -> Nhap AdsPower API Key (Enter de bo qua)").Trim()
        $statusRes = Invoke-AdsPowerApi -Endpoint "/status" -TimeoutSec 3
    }
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
    exit 1
}

# 2. Lay danh sach ho so (Profiles) TRUOC KHI dong app
Write-Host "[2/3] Dang tai danh sach ho so tu AdsPower..." -ForegroundColor Yellow
$profileList = @()
try {
    Start-Sleep -Milliseconds 1100
    $userRes = Invoke-AdsPowerApi -Endpoint "/api/v1/user/list?page=1&page_size=200" -TimeoutSec 8
    if ($userRes.code -ne 0) {
        if (-not $apiKey -and ($userRes.msg -match "key|auth|token|permission")) {
            Write-Host "      -> AdsPower bao loi xac thuc: $($userRes.msg)" -ForegroundColor Yellow
            $apiKey = (Read-Host "      -> Nhap AdsPower API Key").Trim()
            $userRes = Invoke-AdsPowerApi -Endpoint "/api/v1/user/list?page=1&page_size=200" -TimeoutSec 8
        }
        if ($userRes.code -ne 0) { throw $userRes.msg }
    }
    if ($userRes.data -and $userRes.data.list) { $profileList = @($userRes.data.list) }
} catch {
    Write-Host "      -> [LOI] Khong the doc danh sach ho so: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

if ($profileList.Count -eq 0) {
    Write-Host "      -> [CANH BAO] AdsPower tra ve 0 ho so - DUNG LAI de khong ghi de mat du lieu tiktok.json!" -ForegroundColor Yellow
    exit 1
}

Write-Host "      -> Da phat hien $($profileList.Count) ho so tren AdsPower!" -ForegroundColor Green
Write-Host ""

# Luu adspower.json neu co cau hinh custom (de tiktok_helper.js doc duoc API Key/URL)
if (-not $dryRun -and ($apiKey -or ($apiUrl -ne "http://127.0.0.1:50325"))) {
    try {
        $cfgDir = Split-Path -Parent $adsConfigPath
        if (-not (Test-Path $cfgDir)) { New-Item -ItemType Directory -Path $cfgDir -Force | Out-Null }
        $cfgOut = @{ apiUrl = $apiUrl; apiKey = $apiKey } | ConvertTo-Json -Depth 4
        [System.IO.File]::WriteAllText($adsConfigPath, $cfgOut, $utf8NoBom)
    } catch {}
}

# 3. Tao danh sach ho so chuan (KHONG dung (if...) trong bieu thuc)
$newAccounts = @()
$idx = 1
$nowMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
foreach ($p in $profileList) {
    $rawUid = if ($p.user_id) { [string]$p.user_id } else { "" }
    $rawSer = if ($p.serial_number) { [string]$p.serial_number } else { "" }

    $idSuffix = if ($rawUid) { $rawUid } elseif ($rawSer) { $rawSer } else { [string]$idx }
    $accId = "adspower_" + $idSuffix

    if ($p.name) {
        $pName = [string]$p.name
        $label = if ($pName.StartsWith("@")) { $pName } else { "@" + $pName }
    } else {
        $fbSuffix = if ($rawSer) { $rawSer } else { $idSuffix }
        $label = "@Profile_" + $fbSuffix
    }

    $serial = if ($rawSer) { $rawSer } else { [string]$idx }
    $grpName = if ($p.group_name) { [string]$p.group_name } else { "" }

    $newAccounts += [ordered]@{
        id              = $accId
        label           = $label
        profileId       = $rawUid
        adsPowerSerial  = $serial
        captionMode     = "auto"
        captionTemplate = ""
        enabled         = $true
        status          = "connected"
        groupName       = $grpName
        createdAt       = $nowMs
        lastUploadAt    = $null
    }
    $idx++
}

if ($newAccounts.Count -eq 0) {
    Write-Host "      -> [LOI] Khong tao duoc danh sach tai khoan hop le - DUNG LAI de bao ve tiktok.json!" -ForegroundColor Red
    exit 1
}

# Dong HyperClip neu dang chay (tranh ghi de tu RAM)
$wasHyperClipRunning = $false
if ($dryRun) {
    Write-Host "[3/3] [DRY-RUN] Che do kiem tra: khong dong HyperClip va khong ghi tiktok.json." -ForegroundColor Yellow
} else {
    $runningProc = Get-Process -Name "HyperClip","hyperclip-tauri" -ErrorAction SilentlyContinue
    $wasHyperClipRunning = $null -ne $runningProc
    if ($wasHyperClipRunning) {
        Write-Host "      -> Dang tam dong HyperClip de ghi cau hinh an toan..." -ForegroundColor Yellow
        Stop-Process -Name "HyperClip","hyperclip-tauri" -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
    }

    # 4. Cap nhat cac file tiktok.json
    Write-Host "[3/3] Dang cap nhat vao cau hinh HyperClip (tiktok.json)..." -ForegroundColor Yellow
}

$candidatePaths = @(
    (Join-Path $scriptDir "HyperClip-Data\.hyperclip\tiktok.json"),
    (Join-Path $scriptDir "HyperClipB-Data\.hyperclip\tiktok.json"),
    (Join-Path $scriptDir "app\data\.hyperclip\tiktok.json"),
    (Join-Path $scriptDir "HyperClipB-Package\HyperClipB-Data\.hyperclip\tiktok.json"),
    (Join-Path $scriptDir "..\HyperClipB-Package\HyperClipB-Data\.hyperclip\tiktok.json"),
    (Join-Path $scriptDir "..\HyperClipB-Data\.hyperclip\tiktok.json"),
    (Join-Path $scriptDir "..\HyperClip-Data\.hyperclip\tiktok.json"),
    "C:\HyperClip-Data\.hyperclip\tiktok.json",
    "C:\HyperClipB-Package\HyperClipB-Data\.hyperclip\tiktok.json"
)

$updatedAny = $false
$displayAccounts = $newAccounts

if (-not $dryRun) {
  foreach ($tPath in $candidatePaths) {
    $parentDir = Split-Path -Parent $tPath
    if (Test-Path $parentDir) {
        try {
            $existing = [ordered]@{ accounts = @(); mappings = @{}; history = @() }
            $oldAccounts = @()
            $oldByPid = @{}
            $oldByLabel = @{}
            $oldOrder = @{}
            $idRemap = @{}

            if (Test-Path $tPath) {
                try {
                    $jsonContent = [System.IO.File]::ReadAllText($tPath, [System.Text.Encoding]::UTF8).TrimStart([char]0xFEFF)
                    $parsed = $jsonContent | ConvertFrom-Json
                    if ($parsed.accounts) {
                        $oldAccounts = @($parsed.accounts)
                        for ($oi = 0; $oi -lt $oldAccounts.Count; $oi++) {
                            $oa = $oldAccounts[$oi]
                            if ($oa.profileId) {
                                $oldByPid[[string]$oa.profileId] = $oa
                                $oldOrder[[string]$oa.profileId] = $oi
                            }
                            if ($oa.label) { $oldByLabel[[string]$oa.label] = $oa }
                        }
                    }
                    if ($parsed.history) { $existing.history = @($parsed.history) }
                } catch {}
            }

            $mergedAccounts = @()
            foreach ($fresh in $newAccounts) {
                $prev = $null
                if ($fresh.profileId -and $oldByPid.ContainsKey($fresh.profileId)) {
                    $prev = $oldByPid[$fresh.profileId]
                } elseif ($oldByLabel.ContainsKey($fresh.label)) {
                    $prev = $oldByLabel[$fresh.label]
                }

                if ($prev) {
                    if ($prev.id -and ([string]$prev.id -ne $fresh.id)) {
                        $idRemap[[string]$prev.id] = $fresh.id
                    }
                    $capMode = if ($prev.captionMode) { [string]$prev.captionMode } else { $fresh.captionMode }
                    $capTpl = if ($null -ne $prev.captionTemplate) { [string]$prev.captionTemplate } else { $fresh.captionTemplate }
                    $enabledVal = if ($null -ne $prev.enabled) { [bool]$prev.enabled } else { $fresh.enabled }
                    $createdVal = if ($prev.createdAt) { $prev.createdAt } else { $fresh.createdAt }

                    $mergedAccounts += [ordered]@{
                        id              = $fresh.id
                        label           = $fresh.label
                        profileId       = $fresh.profileId
                        adsPowerSerial  = $fresh.adsPowerSerial
                        captionMode     = $capMode
                        captionTemplate = $capTpl
                        enabled         = $enabledVal
                        status          = $fresh.status
                        groupName       = $fresh.groupName
                        createdAt       = $createdVal
                        lastUploadAt    = $prev.lastUploadAt
                    }
                } else {
                    $mergedAccounts += $fresh
                }
            }

            $mappedIds = @{}
            if (Test-Path $tPath) {
                try {
                    $jsonContent = [System.IO.File]::ReadAllText($tPath, [System.Text.Encoding]::UTF8).TrimStart([char]0xFEFF)
                    $parsed = $jsonContent | ConvertFrom-Json
                    if ($parsed.mappings) {
                        $cleanedMaps = [ordered]@{}
                        foreach ($prop in $parsed.mappings.PSObject.Properties) {
                            $val = [string]$prop.Value
                            if ($idRemap.ContainsKey($val)) {
                                $val = $idRemap[$val]
                            } elseif ($val.StartsWith("tt_adspower_")) {
                                $val = $val.Replace("tt_adspower_", "adspower_")
                            }
                            $cleanedMaps[$prop.Name] = $val
                            $mappedIds[$val] = $true
                        }
                        $existing.mappings = $cleanedMaps
                    }
                } catch {}
            }

            $sortedAccounts = @(
                $mergedAccounts | Sort-Object @{ Expression = { if ($mappedIds.ContainsKey($_.id)) { 0 } else { 1 } } }, @{ Expression = { if ($_.profileId -and $oldOrder.ContainsKey($_.profileId)) { 0 } else { 1 } } }, @{ Expression = { if ($_.label -match "us\s*nhuan") { 1 } else { 0 } } }, @{ Expression = { if ($_.profileId -and $oldOrder.ContainsKey($_.profileId)) { $oldOrder[$_.profileId] } else { 9999 } } }, @{ Expression = { $n = 0; [void][int]::TryParse([string]$_.adsPowerSerial, [ref]$n); $n } }
            )

            $existing.accounts = $sortedAccounts
            if ($tPath -like "*HyperClip-Data*") { $displayAccounts = $sortedAccounts }

            $jsonOut = $existing | ConvertTo-Json -Depth 10
            [System.IO.File]::WriteAllText($tPath, $jsonOut, $utf8NoBom)
            try {
                $statePath = Join-Path $parentDir "adspower_sync_state.json"
                $seenIds = New-Object System.Collections.Generic.HashSet[string]
                if (Test-Path $statePath) {
                    try {
                        $prevState = [System.IO.File]::ReadAllText($statePath, [System.Text.Encoding]::UTF8).TrimStart([char]0xFEFF) | ConvertFrom-Json
                        if ($prevState.seenProfileIds) {
                            foreach ($sid in $prevState.seenProfileIds) {
                                if ($sid) { [void]$seenIds.Add([string]$sid) }
                            }
                        }
                    } catch {}
                }
                foreach ($na in $newAccounts) {
                    if ($na.profileId) { [void]$seenIds.Add([string]$na.profileId) }
                }
                $stateOut = @{ seenProfileIds = @($seenIds); updatedAt = [DateTime]::UtcNow.ToString("o") } | ConvertTo-Json -Depth 4
                [System.IO.File]::WriteAllText($statePath, $stateOut, $utf8NoBom)
            } catch {}
            Write-Host "      -> Da cap nhat ($($sortedAccounts.Count) nick): $tPath" -ForegroundColor Green
            $updatedAny = $true
        } catch {
            Write-Host ("      -> Loi khi ghi {0}: {1}" -f $tPath, $_.Exception.Message) -ForegroundColor Red
        }
    }
  }
  if (-not $updatedAny) {
    $fallbackDir = Join-Path $scriptDir "HyperClipB-Package\HyperClipB-Data\.hyperclip"
    $fallbackPath = Join-Path $fallbackDir "tiktok.json"
    New-Item -ItemType Directory -Path $fallbackDir -Force | Out-Null
    $existing = [ordered]@{ accounts = @($newAccounts); mappings = @{}; history = @() }
    $jsonOut = $existing | ConvertTo-Json -Depth 10
    [System.IO.File]::WriteAllText($fallbackPath, $jsonOut, $utf8NoBom)
    Write-Host "      -> Khoi tao moi tai: $fallbackPath" -ForegroundColor Green
  }
}

# 5. In bang danh sach doi chieu
Write-Host ""
Write-Host "=======================================================================" -ForegroundColor Cyan
Write-Host "   DANH SACH HO SO ADSPOWER DA LIEN KET THANH CONG:" -ForegroundColor Cyan
Write-Host "=======================================================================" -ForegroundColor Cyan
Write-Host ("{0,-5} | {1,-10} | {2,-16} | {3,-30}" -f "STT", "Serial", "Profile ID", "Ten Profile / TikTok")
Write-Host "-----------------------------------------------------------------------"
$i = 1
foreach ($acc in $displayAccounts) {
    $stt = "$i"
    $ser = [string]$acc.adsPowerSerial
    $pidVal = [string]$acc.profileId
    $name = [string]$acc.label
    if ($name.Length -gt 30) { $name = $name.Substring(0, 27) + "..." }
    Write-Host ("{0,-5} | {1,-10} | {2,-16} | {3,-30}" -f $stt, $ser, $pidVal, $name)
    $i++
}
Write-Host "=======================================================================" -ForegroundColor Cyan
Write-Host ""
if ($dryRun) {
    Write-Host " Hoan tat kiem tra (DRY-RUN): da doc $($displayAccounts.Count) ho so tu AdsPower, khong thay doi app/cau hinh." -ForegroundColor Yellow
} else {
    Write-Host " Hoan tat! HyperClip da nhan dien day du $($displayAccounts.Count) tai khoan tu AdsPower." -ForegroundColor Green
}

if ((-not $dryRun) -and $wasHyperClipRunning -and (-not $noRelaunch)) {
    $vbsPath = Join-Path $scriptDir "HyperClip-Launcher.vbs"
    $exePath = Join-Path $scriptDir "HyperClip.exe"
    if (Test-Path $vbsPath) {
        Start-Process -FilePath "wscript.exe" -ArgumentList ('"' + $vbsPath + '"')
        Write-Host " Da tu dong mo lai HyperClip!" -ForegroundColor Green
    } elseif (Test-Path $exePath) {
        Start-Process -FilePath $exePath -WorkingDirectory $scriptDir
        Write-Host " Da tu dong mo lai HyperClip!" -ForegroundColor Green
    }
}
Write-Host ""
`;

const cleanPs = psScript.replace(/^\r?\n/, '').replace(/\r?\n/g, '\r\n');

const batContent = `@echo off\r
chcp 65001 >nul\r
title DONG BO HO SO ADSPOWER VAO HYPERCLIP\r
cd /d "%~dp0"\r
set "HYPERCLIP_BAT_SELF=%~f0"\r
powershell -NoProfile -ExecutionPolicy Bypass -Command "$c=[System.IO.File]::ReadAllText($env:HYPERCLIP_BAT_SELF,[System.Text.Encoding]::UTF8);$m='###PS_'+'BEGIN###';$i=$c.IndexOf($m);if($i -lt 0){throw 'Missing PS payload'};& ([scriptblock]::Create($c.Substring($i+$m.Length)))"\r
set "PS_EXIT=%ERRORLEVEL%"\r
echo.\r
if /i not "%HYPERCLIP_DRY_RUN: =%"=="1" pause\r
exit /b %PS_EXIT%\r
###PS_BEGIN###\r
${cleanPs}`;

fs.writeFileSync(path.resolve(__dirname, '../DONG_BO_ADSPOWER.bat'), batContent, 'utf8');
console.log('Successfully generated standalone DONG_BO_ADSPOWER.bat');
