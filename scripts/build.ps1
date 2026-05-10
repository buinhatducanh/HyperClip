@echo off
set "NODE_ENV=production"
npx next build
npx tsc -p electron/tsconfig.main.json && npx tsc -p electron/tsconfig.preload.json && electron-builder --win --config electron-builder.yml
