@echo off
setlocal enabledelayedexpansion
echo ===================================================
echo CAP NHAT WEBSUB RELAY CHO HYPERCLIP (Pass 145/147)
echo ===================================================

set "SCRIPT_DIR=%~dp0"
if not exist "%SCRIPT_DIR%relay.mjs" (
    if exist "%SCRIPT_DIR%websub-relay\relay.mjs" (
        set "SCRIPT_DIR=%SCRIPT_DIR%websub-relay\"
    )
)

echo Dang sao chep relay.mjs moi vao cac thu muc relay HyperClip tren may...

rem 1. Thu muc hien tai
if exist "%~dp0websub-relay" (
    copy /y "!SCRIPT_DIR!relay.mjs" "%~dp0websub-relay\relay.mjs" >nul
    copy /y "!SCRIPT_DIR!relay-parse.mjs" "%~dp0websub-relay\relay-parse.mjs" >nul
    echo  [OK] Da chep vao thu muc goc websub-relay
)

rem 2. Desktop HyperClip
if exist "%USERPROFILE%\Desktop\HyperClip" (
    if not exist "%USERPROFILE%\Desktop\HyperClip\websub-relay" mkdir "%USERPROFILE%\Desktop\HyperClip\websub-relay"
    copy /y "!SCRIPT_DIR!relay.mjs" "%USERPROFILE%\Desktop\HyperClip\websub-relay\relay.mjs" >nul
    copy /y "!SCRIPT_DIR!relay-parse.mjs" "%USERPROFILE%\Desktop\HyperClip\websub-relay\relay-parse.mjs" >nul
    echo  [OK] Da chep vao %USERPROFILE%\Desktop\HyperClip\websub-relay
)

rem 3. D:\HyperClip
if exist "D:\HyperClip-TestCustomer-20260616-224538" (
    if not exist "D:\HyperClip-TestCustomer-20260616-224538\websub-relay" mkdir "D:\HyperClip-TestCustomer-20260616-224538\websub-relay"
    copy /y "!SCRIPT_DIR!relay.mjs" "D:\HyperClip-TestCustomer-20260616-224538\websub-relay\relay.mjs" >nul
    copy /y "!SCRIPT_DIR!relay-parse.mjs" "D:\HyperClip-TestCustomer-20260616-224538\websub-relay\relay-parse.mjs" >nul
    echo  [OK] Da chep vao D:\HyperClip-TestCustomer-20260616-224538\websub-relay
)

echo ===================================================
echo Restarting task WebSub Relay (neu co chay)...
schtasks /End /TN "HyperClip WebSub Relay" >nul 2>&1
schtasks /End /TN "WebSubRelay" >nul 2>&1
schtasks /Run /TN "HyperClip WebSub Relay" >nul 2>&1
schtasks /Run /TN "WebSubRelay" >nul 2>&1
echo HOAN TAT CAP NHAT WEBSUB RELAY CHO HYPERCLIP!
pause
