@echo off
cd /d "%~dp0"
echo ========================================================
echo             APPLYING HYPERCLIP PATCH
echo ========================================================
powershell -ExecutionPolicy Bypass -File "%~dp0apply-patch.ps1"
echo.
pause
