@echo off
chcp 65001 >nul 2>&1
title HyperClip - Kiem tra may
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Check-System.ps1"
echo.
pause
