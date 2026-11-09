@echo off
set "SCRIPT_DIR=%~dp0"
set "HYPERCLIP_DATA_DIR=%SCRIPT_DIR%HyperClip-Data"
echo Starting HyperClip in Debug/Verbose Mode...
echo Logs are being streamed below. Close this window to exit.
echo =========================================================

echo [1/2] Khoi dong bo theo doi tu dong don dep AdsPower khi dong app...
start "" powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "%SCRIPT_DIR%watch-shutdown.ps1"

echo [2/2] Kiem tra va Tu dong mo AdsPower theo kenh da gan...
powershell -ExecutionPolicy Bypass -NoProfile -Command "$st = try { (Get-Content '%HYPERCLIP_DATA_DIR%\.hyperclip\settings.json' -Raw | ConvertFrom-Json).settings.tiktokUploadEnabled } catch { $false }; if ($st -eq $true) { if (Test-Path '%SCRIPT_DIR%tools\start_assigned_adspower.js') { Start-Process -FilePath '%SCRIPT_DIR%app\_internal\resources\node\node.exe' -ArgumentList '\"%SCRIPT_DIR%tools\start_assigned_adspower.js\"' } }"

cd /d "%SCRIPT_DIR%app"
HyperClip.exe --debug
cd /d "%SCRIPT_DIR%"
echo =========================================================
echo App exited. Dang don dep AdsPower...
powershell -ExecutionPolicy Bypass -NoProfile -File "%SCRIPT_DIR%cleanup-all.ps1"
echo Da don dep sach se AdsPower.
pause
