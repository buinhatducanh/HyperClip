@echo off
set "SCRIPT_DIR=%~dp0"
set "HYPERCLIP_DATA_DIR=%SCRIPT_DIR%HyperClip-Data"
set "HYPERCLIP_EDITION=long"
echo Starting HyperClip (Video Dai) in Debug/Verbose Mode...
echo Logs are being streamed below. Close this window to exit.
echo =========================================================
"%SCRIPT_DIR%HyperClip.exe" --debug
echo =========================================================
echo App exited.
pause
