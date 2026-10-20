@echo off
echo Cap nhat WebSub Relay...
if exist "D:\HyperClip" (
    if not exist "D:\HyperClip\websub-relay" mkdir "D:\HyperClip\websub-relay"
    copy /y "%~dp0relay.mjs" "D:\HyperClip\websub-relay\relay.mjs"
    copy /y "%~dp0relay-parse.mjs" "D:\HyperClip\websub-relay\relay-parse.mjs"
)
set "DESK_RELAY=%USERPROFILE%\Desktop\HyperClip\websub-relay"
if exist "%USERPROFILE%\Desktop\HyperClip" (
    if not exist "%DESK_RELAY%" mkdir "%DESK_RELAY%"
    copy /y "%~dp0relay.mjs" "%DESK_RELAY%\relay.mjs"
    copy /y "%~dp0relay-parse.mjs" "%DESK_RELAY%\relay-parse.mjs"
)
echo Khoi dong lai task WebSub Relay...
schtasks /End /TN "HyperClip WebSub Relay" 2>nul
schtasks /Run /TN "HyperClip WebSub Relay" 2>nul
echo Xong! WebSub Relay da duoc cap nhat.
pause
