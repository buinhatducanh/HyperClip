@echo off
chcp 65001 >nul
title DONG BO HO SO ADSPOWER VAO HYPERCLIP
cd /d "%~dp0"
node tools\sync_adspower.js
echo.
pause
