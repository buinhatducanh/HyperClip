@echo off
chcp 65001 >nul
title MO TOAN BO HO SO ADSPOWER (HOT UPLOAD)
cls
echo =======================================================================
echo    HYPERCLIP - MO TOAN BO CUA SO ADSPOWER (HOT UPLOAD SAN SANG)
echo =======================================================================
echo.
cd /d "%~dp0"
node tools/start_all_browsers.js
echo.
echo =======================================================================
echo Nhan phim bat ky de thoat...
pause >nul
