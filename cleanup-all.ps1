# cleanup-all.ps1
# Tu dong tat sach toan bo cac tien trinh va cua so lien quan khi HyperClip dong
param(
    [switch]$IncludeHyperClip
)

$ErrorActionPreference = "SilentlyContinue"

# 1. Dong cac profile AdsPower (SunBrowser) qua AdsPower Local API (chuan xac & an toan du lieu)
try {
    # 1.1 Lay danh sach tat ca browser dang Active truc tiep tu AdsPower API
    $activeRes = Invoke-RestMethod -Uri "http://127.0.0.1:50325/api/v1/browser/local-active" -Method Get -TimeoutSec 2 -ErrorAction SilentlyContinue
    if ($activeRes -and $activeRes.data -and $activeRes.data.list) {
        foreach ($item in $activeRes.data.list) {
            if ($item.user_id) {
                Invoke-RestMethod -Uri "http://127.0.0.1:50325/api/v1/browser/stop?user_id=$($item.user_id)" -Method Get -TimeoutSec 2 -ErrorAction SilentlyContinue | Out-Null
                Start-Sleep -Milliseconds 150
            }
        }
    }
} catch {}

# 1.2 Fallback: Duyet qua danh sach tai khoan trong tiktok.json neu local-active chua bao quat het
try {
    $candidatePaths = @(
        (Join-Path $PSScriptRoot "HyperClip-Data\.hyperclip\tiktok.json"),
        (Join-Path $PSScriptRoot "..\HyperClip-Data\.hyperclip\tiktok.json"),
        "D:\HyperClip\HyperClip-TestCustomer-20260616-224538\HyperClip-Data\.hyperclip\tiktok.json",
        "D:\HyperClip\HyperClip-Data\.hyperclip\tiktok.json"
    )
    foreach ($ttJsonPath in $candidatePaths) {
        if (Test-Path $ttJsonPath) {
            $ttData = Get-Content $ttJsonPath -Raw | ConvertFrom-Json
            foreach ($acc in $ttData.accounts) {
                if ($acc.profileId) {
                    Invoke-RestMethod -Uri "http://127.0.0.1:50325/api/v1/browser/stop?user_id=$($acc.profileId)" -Method Get -TimeoutSec 1 -ErrorAction SilentlyContinue | Out-Null
                }
            }
            break
        }
    }
} catch {}

# 1.3 Cho trinh duyet AdsPower dong em diu trong 800ms
Start-Sleep -Milliseconds 800

# 2. Dong dut diem bat ky tien trinh SunBrowser nao con sot lai (giai phong RAM/GPU)
Get-Process -Name SunBrowser -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

# 3. Dong cac trinh duyet Chrome chay rieng cho HyperClip (YouTube CDP port 9222, TikTok profiles)
# TUYET DOI khong tat nham Chrome ca nhan cua nguoi dung
Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $_.Name -eq "chrome.exe" -and (
        $_.CommandLine -match "HyperClip-Data" -or
        $_.CommandLine -match "TikTok-Profiles" -or
        $_.CommandLine -match "HyperClipB-Data" -or
        $_.CommandLine -match "remote-debugging-port=9222" -or
        $_.CommandLine -match "remote-debugging-port=9223" -or
        $_.CommandLine -match "remote-debugging-port=9224" -or
        $_.CommandLine -match "remote-debugging-port=9234"
    )
} | ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
}

# 4. Dong engine backend hyperclip-tauri neu HyperClip da dong
$hcRunning = Get-Process -Name "HyperClip" -ErrorAction SilentlyContinue | Where-Object {
    try { $_.Path -match "app\\HyperClip\.exe" } catch { $false }
}
if (-not $hcRunning -or $IncludeHyperClip) {
    Get-Process -Name "hyperclip-tauri" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}

# 5. Dong cac tien trinh helper con cua HyperClip
if (-not $hcRunning -or $IncludeHyperClip) {
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
        ($_.Name -match "ffmpeg|ffprobe" -and $_.ExecutablePath -match "HyperClip") -or
        ($_.Name -eq "node.exe" -and $_.CommandLine -match "tiktok_helper|innertube_helper|adspower_bridge")
    } | ForEach-Object {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
}

# 6. Dong HyperClip neu duoc yeu cau
if ($IncludeHyperClip) {
    Get-Process | Where-Object { $_.ProcessName -match "HyperClip|HyperShort" } | Stop-Process -Force -ErrorAction SilentlyContinue
}

# 7. Dong cua so CMD chay watchdog/debug neu duoc yeu cau tat hoan toan
if ($IncludeHyperClip) {
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
        $_.Name -eq "cmd.exe" -and (
            $_.CommandLine -match "HyperClip-Debug.bat" -or
            $_.CommandLine -match "HyperClip-AutoRestart.bat"
        )
    } | ForEach-Object {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
}
