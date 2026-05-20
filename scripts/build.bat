@echo off
set "NODE_ENV=production"
call npx next build
if errorlevel 1 exit /b 1
call npx tsc -p electron/tsconfig.main.json
if errorlevel 1 exit /b 1
call npx tsc -p electron/tsconfig.preload.json
if errorlevel 1 exit /b 1
call electron-builder --win --config electron-builder.yml
