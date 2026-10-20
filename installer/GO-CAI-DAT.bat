@echo off
chcp 65001 >nul 2>&1
title HyperClip - Go cai dat
cd /d "%~dp0"
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo   Dang xin quyen Administrator...
    powershell -NoProfile -Command "Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-NoExit','-File','%~dp0Uninstall-HyperClip.ps1'"
    exit /b
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Uninstall-HyperClip.ps1" %*
echo.
pause
