@echo off
chcp 65001 >nul 2>&1
title HyperClip - Tat che do test hieu nang
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Set-TestMode.ps1" -Off
echo.
pause
