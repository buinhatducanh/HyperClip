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
echo [1/3] Kiem tra va Tu dong bat AdsPower Local API (port 50325)...
powershell -ExecutionPolicy Bypass -NoProfile -Command "$r = try { (Invoke-RestMethod -Uri 'http://127.0.0.1:50325/status' -TimeoutSec 2).code } catch { -1 }; if ($r -ne 0) { $adsPaths = @('C:\Program Files\AdsPower Global\AdsPower Global.exe', 'C:\Program Files (x86)\AdsPower Global\AdsPower Global.exe', \"$env:LOCALAPPDATA\Programs\AdsPower Global\AdsPower Global.exe\"); foreach ($p in $adsPaths) { if (Test-Path $p) { Write-Host '       -> Dang tu dong khoi dong AdsPower Global...' -ForegroundColor Cyan; Start-Process $p; for ($i=0; $i -lt 10; $i++) { Start-Sleep -Seconds 1; $check = try { (Invoke-RestMethod -Uri 'http://127.0.0.1:50325/status' -TimeoutSec 1).code } catch { -1 }; if ($check -eq 0) { break } } break } } }; $r2 = try { (Invoke-RestMethod -Uri 'http://127.0.0.1:50325/status' -TimeoutSec 2).code } catch { -1 }; if ($r2 -eq 0) { Write-Host '       -> AdsPower API OK (Port 50325 dang san sang)' -ForegroundColor Green } else { Write-Host '       -> CANH BAO: AdsPower chua bat hoac API port 50325 chua mo!' -ForegroundColor Yellow }"

echo [2/3] Khoi dong watcher tu dong don dep sach se AdsPower khi thoat...
start "" powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "%SCRIPT_DIR%watch-shutdown.ps1"

echo [2.5/3] Kiem tra va Tu dong mo cac man hinh AdsPower da gan kenh (Neu bat Auto Upload TikTok)...
powershell -ExecutionPolicy Bypass -NoProfile -Command "$st = try { (Get-Content '%HYPERCLIP_DATA_DIR%\.hyperclip\settings.json' -Raw | ConvertFrom-Json).settings.tiktokUploadEnabled } catch { $false }; if ($st -eq $true) { Write-Host '       -> TikTok Auto Upload dang BAT: Tu dong mo cac man hinh AdsPower da gan kenh...' -ForegroundColor Cyan; if (Test-Path '%SCRIPT_DIR%tools\start_assigned_adspower.js') { Start-Process -FilePath '%SCRIPT_DIR%app\_internal\resources\node\node.exe' -ArgumentList '\"%SCRIPT_DIR%tools\start_assigned_adspower.js\"' } }"

echo [3/3] Khoi dong HyperClip (Video Dai)...
echo       Data Dir: %HYPERCLIP_DATA_DIR%
echo =======================================================================
echo.

cd /d "%SCRIPT_DIR%app"
HyperClip.exe --debug
cd /d "%SCRIPT_DIR%"

echo.
echo =======================================================================
echo [THONG BAO] HyperClip da dong. Dang don dep sach se AdsPower...
powershell -ExecutionPolicy Bypass -NoProfile -File "%SCRIPT_DIR%cleanup-all.ps1"
echo Da don dep xong AdsPower va tat ca tien trinh lien quan!
echo Dang khoi dong lai sau 5 giay de duy tri on dinh...
echo (Nhan phim Ctrl+C hoac dong cua so CMD de thoat han)
echo =======================================================================
timeout /t 5
goto LOOP
