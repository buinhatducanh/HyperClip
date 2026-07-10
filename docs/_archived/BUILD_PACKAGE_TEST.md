# Build, Đóng gói & Test — HyperClip

> Cập nhật: 2026-05-22

---

## 1. Tổng quan

```
Source (electron/*.ts, src/*)
    │
    ├─ npx tsc -p electron/tsconfig.main.json  →  dist-electron/*.js (ESM)
    ├─ npx tsc -p electron/tsconfig.preload.json  →  dist-electron/preload.js
    ├─ npx next build  →  .next/ (React frontend)
    └─ npx electron-builder  →  release/win-unpacked/ + release/HyperClip-Setup-*.exe
```

**ESM-only:** Code Electron main process biên dịch ra ESM (`import/export`). Module type được set trong packaged `package.json` (`"type": "module"`).

---

## 2. Build Commands

### Development
```bash
npm run dev              # Next.js dev server (localhost:3000)
npm run electron:dev     # Compile TS + launch Electron dev mode
```

### Production
```bash
npm run electron:build   # Full build: Next.js + TypeScript + electron-builder
```

### TypeScript only (không build Next.js/electron-builder)
```bash
node node_modules/.pnpm/typescript@6.0.3/node_modules/typescript/lib/tsc.js -p electron/tsconfig.main.json
node node_modules/.pnpm/typescript@6.0.3/node_modules/typescript/lib/tsc.js -p electron/tsconfig.preload.json
```

### Kiểm tra TypeScript không biên dịch
```bash
node node_modules/.pnpm/typescript@6.0.3/node_modules/typescript/lib/tsc.js --noEmit -p electron/tsconfig.main.json
node node_modules/.pnpm/typescript@6.0.3/node_modules/typescript/lib/tsc.js --noEmit -p electron/tsconfig.preload.json
```

---

## 3. TypeScript Configuration

### electron/tsconfig.main.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",        // Quan trọng: hỗ trợ import.meta.url
    "moduleResolution": "NodeNext",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "outDir": "../dist-electron",
    "rootDir": "."
  },
  "include": ["main.ts", "global.d.ts", "ipc/**/*.ts", "services/**/*.ts"]
}
```

**Quy tắc quan trọng:**
- `module: "NodeNext"` — bắt buộc để dùng `import.meta.url`
- `moduleResolution: "NodeNext"` — phải khớp với module
- **KHÔNG dùng** `module: "CommonJS"` — TypeScript sẽ không hiểu `import.meta`

### electron/global.d.ts

```typescript
// Electron APIs được inject vào globalThis bởi Electron runtime.
// Đây là ambient declarations — KHÔNG import electron module.
declare const app: Electron.CrossProcessExports['app']
declare const BrowserWindow: Electron.CrossProcessExports['BrowserWindow']
declare const ipcMain: Electron.CrossProcessExports['ipcMain']
declare const Tray: Electron.CrossProcessExports['Tray']
// ...
```

**Tại sao không import từ 'electron'?**
- `require('electron')` trong packaged app trả về đường dẫn binary, không phải API object
- Electron inject API vào `globalThis` ở runtime
- `global.d.ts` cung cấp type safety mà không cần runtime import

### electron/main.ts imports

```typescript
// Type-only imports — bị xóa hoàn toàn khi biên dịch, không tạo require()
import type {
  BrowserWindow as BrowserWindowType,
  Tray as TrayType,
  Event,
  ProtocolRequest,
  ProtocolResponse,
} from 'electron'

// Runtime imports — các Node.js module
import { spawn, execSync } from 'child_process'
import path from 'path'
import fs from 'fs'
```

**Lưu ý:** `import type` chỉ import type information, bị strip khi biên dịch. Không tạo runtime dependency.

---

## 4. Các lỗi thường gặp khi build

### Lỗi 1: `import.meta` không được hỗ trợ

```
error TS1343: The 'import.meta' meta-property is only allowed when
the '--module' option is 'es2020', 'es2022', 'esnext', 'system', 'node16', 'node20', or 'nodenext'.
```

**Nguyên nhân:** `tsconfig.main.json` có `"module": "CommonJS"`
**Sửa:** Đổi thành `"module": "NodeNext"`

### Lỗi 2: `__filename` không tồn tại trong ESM

```
ReferenceError: __filename is not defined in ES module scope
```

**Nguyên nhân:** Dùng `createRequire(__filename)` trong ESM
**Sửa:**
```typescript
import { fileURLToPath } from 'url'
const _require = createRequire(fileURLToPath(import.meta.url))
```

### Lỗi 3: `require('electron')` trả về undefined trong packaged app

**Nguyên nhân:** electron package exports binary path, không phải API
**Sửa:** Dùng `globalThis.app` thay vì `require('electron').app`

### Lỗi 4: `require('child_process')` không tồn tại trong ESM

**Nguyên nhân:** ESM không có `require()`
**Sửa:** Thêm vào top-level import:
```typescript
import { spawn, execSync } from 'child_process'
```

### Lỗi 5: `BrowserWindow refers to a value, but is being used as a type`

**Nguyên nhân:** `BrowserWindow` là global constant (runtime), dùng làm type annotation
**Sửa:** Import type với alias:
```typescript
import type { BrowserWindow as BrowserWindowType } from 'electron'
let mainWindow: BrowserWindowType | null = null
```

---

## 5. electron-builder Configuration

### electron-builder.yml (quan trọng)

```yaml
appId: com.loopcompany.hyperclip
productName: HyperClip
files:
  - dist-electron/**/*   # Compiled TypeScript (ESM)
  - src/**/*             # React source
  - next.config.mjs
  - package.json          # Triggers "type": "module" cho ESM
  - .next/**/*           # Next.js build output
extraResources:
  - from: resources/ffmpeg/bin/  →  ffmpeg/bin/
  - from: resources/yt-dlp/       →  yt-dlp/
  - from: resources/node/         →  node/
asar: false                  # Quan trọng: unpacked mode
compression: maximum
```

**Điểm quan trọng nhất:**

| Setting | Giá trị | Tại sao |
|---------|---------|---------|
| `asar: false` | Bắt buộc | Electron API injection vào `globalThis` cần unpacked |
| `files` bao gồm `package.json` | Quan trọng | Packaged `package.json` có `"type": "module"` → ESM execution |
| `files` bao gồm `dist-electron` | Quan trọng | Source TypeScript đã biên dịch |
| `files` bao gồm `.next` | Quan trọng | Next.js build output |

### Cấu trúc packaged app

```
release/win-unpacked/
  HyperClip.exe              ← Electron entry point
  resources/
    app/
      package.json          ← "type": "module" + "main": "dist-electron/main.js"
      dist-electron/
        main.js             ← ESM format (import path from 'path')
        preload.js
        services/
        ipc/
      node_modules/
        electron-log/       ← CommonJS logger
        youtubei.js/
      .next/                ← Next.js production build
    ffmpeg/bin/ffmpeg.exe
    node/node.exe
    yt-dlp/
```

---

## 6. Test Ứng dụng

### Test 1: Nhanh (không cần chạy GUI)

```powershell
$env:ELECTRON_RUN_AS_NODE = $null
$proc = Start-Process 'D:\LOOP_COMPANY\HyperClip\release\win-unpacked\HyperClip.exe' -PassThru
Start-Sleep 10
if (-not $proc.HasExited) {
    $proc.Refresh()
    Write-Host "OK: PID=$($proc.Id), Handle=$($proc.MainWindowHandle), Title='$($proc.MainWindowTitle)'"
    $proc | Stop-Process -Force
} else {
    Write-Host "FAIL: App crashed with exit code $($proc.ExitCode)"
}
```

**Kết quả mong đợi:**
- `HasExited: False` (app không crash)
- `MainWindowHandle: != 0` (có cửa sổ)
- `Responding: True`

### Test 2: Kiểm tra Process tree

```powershell
Get-Process | Where-Object { $_.ProcessName -match 'HyperClip' } | Select ProcessName, Id
```

**Kết quả mong đợi:** 3 process HyperClip:
- Main process
- Renderer process
- GPU process

### Test 3: Kiểm tra Window handle

```powershell
Get-Process HyperClip | ForEach-Object {
    $_.Refresh()
    Write-Host "$($_.Id): $($_.MainWindowTitle) (handle=$($_.MainWindowHandle))"
}
```

**Kết quả mong đợi:**
- `MainWindowTitle: HyperClip` (không phải "Error" hoặc rỗng)
- `MainWindowHandle: != 0`

### Test 4: Kiểm tra Next.js server startup

```powershell
# Chạy app và đợi 30 giây
$env:ELECTRON_RUN_AS_NODE = $null
Start-Process 'D:\LOOP_COMPANY\HyperClip\release\win-unpacked\HyperClip.exe'

Start-Sleep 30

# Kiểm tra port 3000
Test-NetConnection localhost -Port 3000 -InformationLevel Quiet
# Mong đợi: True
```

### Test 5: Kiểm tra log files

```powershell
# electron-log output
Get-ChildItem "$env:APPDATA\HyperClip\logs" -Filter "hyperclip*.log" | Select FullName, Length, LastWriteTime
```

### Test 6: Kiểm tra không bị ELECTRON_RUN_AS_NODE

```powershell
# Bug phổ biến: ELECTRON_RUN_AS_NODE=1 ở system/process level
# Khiến Electron chạy như Node.js → crash
[System.Environment]::GetEnvironmentVariable('ELECTRON_RUN_AS_NODE', 'Process')
# Mong đợi: rỗng hoặc không tồn tại
```

---

## 7. Troubleshooting

### App crash ngay lập tức

1. Kiểm tra `ELECTRON_RUN_AS_NODE` có bị set không
   ```powershell
   [System.Environment]::GetEnvironmentVariable('ELECTRON_RUN_AS_NODE', 'Process')
   ```

2. Kiểm tra packaged `package.json` có `"type": "module"`
   ```bash
   grep '"type"' release/win-unpacked/resources/app/package.json
   ```

3. Kiểm tra compiled output là ESM
   ```bash
   head -1 release/win-unpacked/resources/app/dist-electron/main.js
   # Mong đợi: import path from 'path';
   ```

### Cửa sổ hiển thị "Error"

1. Chromium không load được Next.js server
2. Kiểm tra Next.js process có đang chạy
   ```powershell
   Test-NetConnection localhost -Port 3000 -InformationLevel Quiet
   ```
3. Kiểm tra `devLog` output (trong log files hoặc dev console)
4. Thử restart app hoặc chạy lại build

### electron-builder fail: "Access is denied"

1. File bị lock bởi process đang chạy
   ```powershell
   Get-Process | Where-Object { $_.ProcessName -match 'HyperClip' } | Stop-Process -Force
   ```
2. Xóa `release/win-unpacked` trước khi build
   ```powershell
   Remove-Item -Recurse -Force 'D:\LOOP_COMPANY\HyperClip\release\win-unpacked'
   ```

### TypeScript compilation fail

1. Chạy `--noEmit` để xem lỗi
   ```bash
   node node_modules/.pnpm/typescript@6.0.3/node_modules/typescript/lib/tsc.js --noEmit -p electron/tsconfig.main.json
   ```
2. Kiểm tra `tsconfig.main.json` có `"module": "NodeNext"`
3. Kiểm tra không có `require()` trong TypeScript source
   ```bash
   grep -rn "require(" electron/main.ts
   ```

---

## 8. Dev vs Production Flow

### Development
```
npm run electron:dev
  └─ tsc main.ts + preload.ts (CJS output)
  └─ cross-env DEV_LOG=1 ELECTRON_RUN_AS_NODE= npx electron .
      └─ Electron loads dist-electron/main.js
          └─ app = globalThis.app (injected by Electron)
          └─ require('electron') → works (dev mode)
```

### Production (packaged)
```
npm run electron:build
  └─ tsc main.ts + preload.ts (ESM output, import.meta.url)
  └─ next build
  └─ electron-builder
      └─ release/win-unpacked/
          └─ HyperClip.exe
          └─ resources/app/
              ├─ package.json ("type": "module")
              └─ dist-electron/main.js (ESM)
                  └─ import { app } from 'electron' → STRIP (type-only)
                  └─ app = globalThis.app (injected by Electron)
```

**Key insight:** `import type { app } from 'electron'` chỉ import type information, bị xóa hoàn toàn khi biên dịch. Runtime `app` đến từ `globalThis` được Electron inject. Không có `require('electron')` nào được gọi ở runtime.
