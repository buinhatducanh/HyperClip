@echo off
chcp 65001 >nul
title MO SONG SONG TOAN BO CHROME VA ADSPOWER CHO TAT CA TAI KHOAN
cls
echo =======================================================================
echo    HYPERCLIP - MO SONG SONG TOAN BO CHROME + ADSPOWER (HOT UPLOAD)
echo =======================================================================
echo.
cd /d "%~dp0"
node tools/start_all_browsers.js
echo.
echo =======================================================================
echo Nhan phim bat ky de thoat...
pause >nul
