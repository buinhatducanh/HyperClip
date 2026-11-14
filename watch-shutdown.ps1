# watch-shutdown.ps1
# Tự động theo dõi tiến trình HyperClip. Khi cửa sổ HyperClip đóng -> tự động dọn sạch 100% cửa sổ và tiến trình liên quan

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

$cleanupScript = Join-Path $PSScriptRoot "cleanup-all.ps1"

while ($true) {
    # 1. Tìm tiến trình UI HyperClip (app\HyperClip.exe)
    $target = $null
    while (-not $target) {
        $procs = Get-Process -Name "HyperClip" -ErrorAction SilentlyContinue
        foreach ($p in $procs) {
            try {
                if ($p.Path -match "app\\HyperClip\.exe") {
                    $target = $p
                    break
                }
            } catch {}
        }
        if (-not $target) {
            Start-Sleep -Seconds 2
        }
    }

    # 2. HyperClip đang mở. Theo dõi cho đến khi tiến trình kết thúc (người dùng đóng cửa sổ)
    try {
        $target.WaitForExit()
    } catch {
        while (Get-Process -Id $target.Id -ErrorAction SilentlyContinue) {
            Start-Sleep -Seconds 1
        }
    }

    # 3. Đợi khoảng thời gian 10 giây (grace period) để kiểm tra xem app có đang reload/restart không
    $isReallyGone = $true
    for ($check = 0; $check -lt 5; $check++) {
        Start-Sleep -Seconds 2
        $running = Get-Process -Name "HyperClip" -ErrorAction SilentlyContinue | Where-Object {
            try { $_.Path -match "app\\HyperClip\.exe" } catch { $false }
        }
        if ($running) {
            $isReallyGone = $false
            break
        }
    }

    if ($isReallyGone) {
        # CỬA SỔ HYPERCLIP ĐÃ ĐÓNG HOÀN TOÀN -> DỌN SẠCH CÁC TIẾN TRÌNH CON
        if (Test-Path $cleanupScript) {
            & $cleanupScript
        }
    }
}
