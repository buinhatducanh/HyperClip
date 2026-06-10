@echo off
REM kill_hyperclip.bat - force-kill stuck HyperClip processes
REM Double-click to run, hoặc chạy từ cmd

echo Killing HyperClip processes...

taskkill /F /IM hyperclip-tauri.exe /T 2>nul
if %errorlevel%==0 (
    echo [OK] hyperclip-tauri.exe terminated
) else (
    echo [skip] hyperclip-tauri.exe not running
)

taskkill /F /IM python.exe /T 2>nul
if %errorlevel%==0 (
    echo [OK] python.exe terminated
) else (
    echo [skip] python.exe not running
)

REM Also kill any orphan qmlscene/qml processes
taskkill /F /IM qml.exe /T 2>nul
taskkill /F /IM qmlscene.exe /T 2>nul
taskkill /F /IM HyperClip.exe /T 2>nul

echo.
echo Done. You can close this window or press any key to exit.
pause >nul
