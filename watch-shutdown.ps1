# watch-shutdown.ps1
# Theo dõi tiến trình HyperClip.exe, khi cửa sổ HyperClip đóng -> tự động dọn sạch 100% tiến trình liên quan
param(
    [int]$TargetPid = 0
)

$ErrorActionPreference = "SilentlyContinue"

# Đảm bảo chỉ 1 tiến trình watch chạy duy nhất
$mutexName = "Global\HyperClip_WatchShutdown_Mutex"
$createdNew = $false
$mutex = $null
try {
    $mutex = New-Object System.Threading.Mutex($true, $mutexName, [ref]$createdNew)
    if (-not $createdNew) {
        exit 0
    }
} catch {
    exit 0
}

$proc = $null
if ($TargetPid -gt 0) {
    $proc = Get-Process -Id $TargetPid -ErrorAction SilentlyContinue
}

# Nếu không truyền PID hoặc PID không tìm thấy, tìm theo tên
if (-not $proc) {
    # Chờ tối đa 20s để HyperClip khởi chạy
    for ($i = 0; $i -lt 20; $i++) {
        $proc = Get-Process | Where-Object { $_.ProcessName -eq "HyperClip" -and $_.MainWindowTitle -ne "" } | Select-Object -First 1
        if (-not $proc) {
            $proc = Get-Process | Where-Object { $_.ProcessName -match "HyperClip" -and $_.ProcessName -notmatch "tauri" } | Select-Object -First 1
        }
        if ($proc) { break }
        Start-Sleep -Seconds 1
    }
}

if ($proc) {
    try {
        $proc.WaitForExit()
    } catch {}
}

# HyperClip đã đóng -> Thực hiện tắt sạch toàn bộ các cửa sổ và tiến trình liên quan
$cleanupScript = Join-Path $PSScriptRoot "cleanup-all.ps1"
if (Test-Path $cleanupScript) {
    & $cleanupScript
}

if ($mutex) {
    try { $mutex.ReleaseMutex() } catch {}
}
