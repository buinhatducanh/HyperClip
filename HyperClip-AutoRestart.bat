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
echo [1/2] Kiem tra AdsPower Local API (port 50325)...
powershell -NoProfile -Command "$r = try { (Invoke-WebRequest -Uri 'http://127.0.0.1:50325/status' -TimeoutSec 2).StatusCode } catch { 0 }; if ($r -eq 200) { Write-Host '       -> AdsPower API OK (Port 50325 dang san sang)' -ForegroundColor Green } else { Write-Host '       -> CANH BAO: AdsPower chua bat hoac API port 50325 chua mo!' -ForegroundColor Yellow }"

echo [2/2] Khoi dong HyperClip (Video Dai)...
echo       Data Dir: %HYPERCLIP_DATA_DIR%
echo =======================================================================
echo.

"%SCRIPT_DIR%HyperClip.exe" --debug

echo.
echo =======================================================================
echo [CANH BAO] HyperClip da dung hoac bi dong ngoai y muon!
echo Dang khoi dong lai sau 5 giay de duy tri on dinh...
echo (Nhan phim Ctrl+C hoac dong cua so de thoat han)
echo =======================================================================
timeout /t 5
goto LOOP
