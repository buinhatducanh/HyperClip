@echo off
REM HyperClip Launcher — Customer Side
REM ==================================
REM Place this .bat file next to HyperClip.exe or in the HyperClip root folder.
REM It sets HYPERCLIP_DATA_DIR automatically.

setlocal enabledelayedexpansion

REM Find the script's own directory
set "SCRIPT_DIR=%~dp0"
set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"

REM Default: look for HyperClip-Data in the same folder as this script
set "DATA_DIR=%SCRIPT_DIR%\HyperClip-Data"

REM Allow override via command line: HyperClip-Launcher.bat "D:\MyHyperClipData"
if not "%~1"=="" set "DATA_DIR=%~1"

if not exist "%DATA_DIR%" (
    echo [ERR] HyperClip-Data not found at: %DATA_DIR%
    echo.
    echo Usage:
    echo   HyperClip-Launcher.bat                      ^(uses default: %SCRIPT_DIR%\HyperClip-Data^)
    echo   HyperClip-Launcher.bat "D:\MyData\HyperClip-Data"  ^(custom path^)
    echo.
    echo If HyperClip-Data is elsewhere, edit this file and set DATA_DIR above.
    pause
    exit /b 1
)

REM Find HyperClip.exe
set "EXE_PATH=%SCRIPT_DIR%\HyperClip.exe"
if not exist "%EXE_PATH%" (
    REM Try common locations
    set "EXE_PATH=%LOCALAPPDATA%\HyperClip\HyperClip.exe"
)
if not exist "%EXE_PATH%" (
    set "EXE_PATH=%APPDATA%\HyperClip\HyperClip.exe"
)
if not exist "%EXE_PATH%" (
    echo [ERR] HyperClip.exe not found.
    echo.
    echo Please place this .bat file in the same folder as HyperClip.exe,
    echo or install HyperClip first.
    pause
    exit /b 1
)

echo Starting HyperClip...
echo   Data dir : %DATA_DIR%
echo   Exe      : %EXE_PATH%
echo.

REM Set environment variable for this session
set HYPERCLIP_DATA_DIR=%DATA_DIR%

REM Launch
start "" "%EXE_PATH%"
