@echo off
set "SCRIPT_DIR=%~dp0"
set "HYPERCLIP_DATA_DIR=%SCRIPT_DIR%HyperClip-Data"
set "HYPERCLIP_EDITION=long"
title HyperClip

echo Starting HyperClip (Video Dai)...
echo =========================================================

:: Khoi dong watcher tu dong don dep sach se khi cua so HyperClip dong
start "" /B powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "%SCRIPT_DIR%watch-shutdown.ps1"

:: Chay ung dung HyperClip chinh
"%SCRIPT_DIR%HyperClip.exe" --debug

echo.
echo =========================================================
echo Cua so HyperClip da dong. Dang tat sach cac tien trinh lien quan...
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%cleanup-all.ps1"
exit /b 0
