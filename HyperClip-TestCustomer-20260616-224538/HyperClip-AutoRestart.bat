@echo off
setlocal enabledelayedexpansion
title HyperClip Watchdog ^& Auto-Restart
set "SCRIPT_DIR=%~dp0"
set "HYPERCLIP_DATA_DIR=%SCRIPT_DIR%HyperClip-Data"
set "HYPERCLIP_EDITION=long"

:LOOP
cls
echo =======================================================================
echo    HYPERCLIP WATCHDOG - CHE DO TU DONG DUY TRI HOAT DONG LIEN TUC
echo =======================================================================
echo.
echo [1/3] Kiem tra AdsPower Local API (port 50325)...
powershell -ExecutionPolicy Bypass -NoProfile -Command "$r = try { (Invoke-WebRequest -Uri 'http://127.0.0.1:50325/status' -TimeoutSec 2).StatusCode } catch { 0 }; if ($r -eq 200) { Write-Host '       -> AdsPower API OK (Port 50325 dang san sang)' -ForegroundColor Green } else { Write-Host '       -> CANH BAO: AdsPower chua bat hoac API port 50325 chua mo!' -ForegroundColor Yellow }"

echo [2/3] Khoi dong watcher tu dong don dep khi thoat...
start "" /B powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -File "%SCRIPT_DIR%watch-shutdown.ps1"

echo [3/3] Khoi dong HyperClip (Video Dai)...
echo       Data Dir: %HYPERCLIP_DATA_DIR%
echo =======================================================================
echo.

"%SCRIPT_DIR%HyperClip.exe" --debug

:: Doi cho den khi app\HyperClip.exe khoi dong va thuc su tat
powershell -ExecutionPolicy Bypass -NoProfile -Command "$p = $null; for ($i=0; $i -lt 30; $i++) { $p = Get-Process -Name HyperClip -ErrorAction SilentlyContinue | Where-Object { $_.Path -match 'app\\HyperClip\.exe' } | Select-Object -First 1; if ($p) { break }; Start-Sleep -Seconds 1 }; if ($p) { Write-Host '       -> HyperClip dang chay (PID: ' + $p.Id + ')'; $p.WaitForExit() } else { Write-Host '       -> Khong tim thay tien trinh HyperClip sau 30 giay.' -ForegroundColor Yellow }"

echo.
echo =======================================================================
echo [CANH BAO] HyperClip da dung hoac bi dong ngoai y muon!
echo Dang khoi dong lai sau 5 giay de duy tri on dinh...
echo (Nhan phim Ctrl+C hoac dong cua so de thoat han)
echo =======================================================================
timeout /t 5
goto LOOP
