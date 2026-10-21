@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
set "HYPERCLIP_DATA_DIR=%SCRIPT_DIR%HyperClip-Data"
set "HYPERCLIP_EDITION=long"

echo =========================================================
echo    Starting HyperClip (Video Dai) - Debug Mode
echo =========================================================

:: Khoi dong bo theo doi tu dong don dep khi thoat
start "" /B powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -File "%SCRIPT_DIR%watch-shutdown.ps1"

:: Khoi dong app
"%SCRIPT_DIR%HyperClip.exe" --debug

echo =========================================================
echo HyperClip process triggered.
