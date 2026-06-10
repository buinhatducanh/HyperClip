@echo off
REM run_hyperclip.bat - clean start HyperClip (kills old processes first)

echo Cleaning up old processes...
taskkill /F /IM hyperclip-tauri.exe /T 2>nul
taskkill /F /IM python.exe /T 2>nul
timeout /t 2 /nobreak >nul

echo Starting HyperClip...
cd /d d:\LOOP_COMPANY\HyperClip
python src\main.py

echo.
echo HyperClip exited. Press any key to close.
pause >nul
