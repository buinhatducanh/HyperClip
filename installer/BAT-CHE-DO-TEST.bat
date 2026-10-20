@echo off
chcp 65001 >nul 2>&1
title HyperClip - Bat che do test hieu nang
cd /d "%~dp0"
echo.
echo   Se bat TAT CA kenh de tao tai that cho may (42 kenh dang tat).
echo   Tat lai bang TAT-CHE-DO-TEST.bat - cau hinh cu duoc khoi phuc chinh xac.
echo.
pause
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Set-TestMode.ps1" -On
echo.
pause
