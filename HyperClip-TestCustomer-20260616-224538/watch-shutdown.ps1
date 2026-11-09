# watch-shutdown.ps1
# Tự động theo dõi tiến trình HyperClip. Khi cửa sổ HyperClip đóng -> tự động dọn sạch 100% cửa sổ và tiến trình liên quan

$debugLog = "D:\HyperClip\watch_debug.log"
"Starting watch-shutdown at $(Get-Date)" | Out-File $debugLog

# Đảm bảo chỉ 1 tiến trình watch chạy duy nhất
$mutexName = "Global\HyperClip_WatchShutdown_Mutex"
$createdNew = $false
$mutex = $null
try {
    $mutex = New-Object System.Threading.Mutex($true, $mutexName, [ref]$createdNew)
    "Mutex createdNew: $createdNew" | Out-File $debugLog -Append
    if (-not $createdNew) {
        "Exiting because mutex already held" | Out-File $debugLog -Append
        exit 0
    }
} catch {
    "Mutex exception: $_" | Out-File $debugLog -Append
}

$cleanupScript = Join-Path $PSScriptRoot "cleanup-all.ps1"
if (-not (Test-Path $cleanupScript)) {
    $cleanupScript = "D:\HyperClip\HyperClip-TestCustomer-20260616-224538\cleanup-all.ps1"
}
"Cleanup script: $cleanupScript" | Out-File $debugLog -Append

while ($true) {
    # 1. Chờ cho đến khi tìm thấy tiến trình HyperClip (UI chính)
    $target = $null
    while (-not $target) {
        $procs = Get-Process -Name "HyperClip" -ErrorAction SilentlyContinue
        if (-not $procs) {
            $procs = Get-Process -Name "hyperclip-tauri" -ErrorAction SilentlyContinue
        }
        if ($procs) {
            $target = $procs | Select-Object -First 1
            "Found target: $($target.ProcessName) PID $($target.Id)" | Out-File $debugLog -Append
            break
        }
        Start-Sleep -Seconds 1
    }

    # 2. HyperClip đang chạy -> Lắng nghe sự kiện kết thúc qua Process Handle (WaitForExit)
    "Waiting for exit of PID $($target.Id)..." | Out-File $debugLog -Append
    try {
        $target.WaitForExit()
        "WaitForExit returned" | Out-File $debugLog -Append
    } catch {
        "WaitForExit error: $_" | Out-File $debugLog -Append
        while (Get-Process -Id $target.Id -ErrorAction SilentlyContinue) {
            Start-Sleep -Milliseconds 500
        }
    }

    # 3. Đợi thêm 500ms để kiểm tra lại
    Start-Sleep -Milliseconds 500

    $remainingGui = Get-Process -Name "HyperClip" -ErrorAction SilentlyContinue | Where-Object {
        try {
            $_.Path -match "HyperClip"
        } catch { $true }
    }

    "Remaining GUI count: $(@($remainingGui).Count)" | Out-File $debugLog -Append

    if (-not $remainingGui) {
        "Triggering cleanup script!" | Out-File $debugLog -Append
        if (Test-Path $cleanupScript) {
            & $cleanupScript
        }
    }
}
