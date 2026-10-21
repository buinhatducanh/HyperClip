# cleanup-all.ps1
# Tự động tắt sạch toàn bộ các tiến trình và cửa sổ liên quan khi HyperClip đóng
param(
    [switch]$IncludeHyperClip
)

$ErrorActionPreference = "SilentlyContinue"

# 1. Đóng các profile AdsPower (SunBrowser) qua AdsPower Local API (chuẩn xác & an toàn dữ liệu)
try {
    $ttJsonPath = Join-Path $PSScriptRoot "HyperClip-Data\.hyperclip\tiktok.json"
    if (Test-Path $ttJsonPath) {
        $ttData = Get-Content $ttJsonPath -Raw | ConvertFrom-Json
        foreach ($acc in $ttData.accounts) {
            if ($acc.profileId) {
                Invoke-RestMethod -Uri "http://127.0.0.1:50325/api/v1/browser/stop?user_id=$($acc.profileId)" -Method Get -TimeoutSec 1 -ErrorAction SilentlyContinue | Out-Null
            }
        }
    }
} catch {}

# Fallback tắt các profile AdsPower phổ biến
1..5 | ForEach-Object {
    Invoke-RestMethod -Uri "http://127.0.0.1:50325/api/v1/browser/stop?serial_number=$_" -Method Get -TimeoutSec 1 -ErrorAction SilentlyContinue | Out-Null
}

# 2. Đóng dứt điểm bất kỳ tiến trình SunBrowser nào còn sót lại
Get-Process -Name SunBrowser -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

# 3. Đóng các trình duyệt Chrome chạy riêng cho HyperClip (YouTube CDP port 9222, TikTok profiles)
# TUYỆT ĐỐI không tắt nhầm Chrome cá nhân của người dùng
Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $_.Name -eq "chrome.exe" -and (
        $_.CommandLine -match "HyperClip-Data" -or
        $_.CommandLine -match "TikTok-Profiles" -or
        $_.CommandLine -match "HyperClipB-Data" -or
        $_.CommandLine -match "remote-debugging-port=9222" -or
        $_.CommandLine -match "remote-debugging-port=9223" -or
        $_.CommandLine -match "remote-debugging-port=9224"
    )
} | ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
}

# 4. Đóng engine backend hyperclip-tauri
Get-Process -Name "hyperclip-tauri" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

# 5. Đóng các tiến trình render hoặc helper con của HyperClip
Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    ($_.Name -match "ffmpeg|ffprobe" -and $_.ExecutablePath -match "HyperClip") -or
    ($_.Name -eq "node.exe" -and $_.CommandLine -match "tiktok_helper|innertube_helper")
} | ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
}

# 6. Đóng HyperClip nếu được yêu cầu
if ($IncludeHyperClip) {
    Get-Process | Where-Object { $_.ProcessName -match "HyperClip|HyperShort" } | Stop-Process -Force -ErrorAction SilentlyContinue
}

# 7. Đóng cửa sổ CMD chạy watchdog/debug nếu HyperClip đã tắt
Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $_.Name -eq "cmd.exe" -and (
        $_.CommandLine -match "HyperClip-Debug.bat" -or
        $_.CommandLine -match "HyperClip-AutoRestart.bat"
    )
} | ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
}
