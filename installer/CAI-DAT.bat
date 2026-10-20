@echo off
chcp 65001 >nul 2>&1
title HyperClip - Cai dat
cd /d "%~dp0"

rem Buoc tinh chinh Windows (power plan, HAGS, Game DVR) can quyen Administrator.
rem Chua co quyen thi tu mo lai mot cua so PowerShell co quyen, chay thang file .ps1.
rem (-NoExit de cua so khong dong mat, khach con doc duoc ket qua.)
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo   Dang xin quyen Administrator, bam "Yes" o hop thoai Windows...
    powershell -NoProfile -Command "Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-NoExit','-File','%~dp0Install-HyperClip.ps1'"
    exit /b
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-HyperClip.ps1" %*
echo.
echo   ============================================================
pause
