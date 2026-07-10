# Packaging Issues Log — HyperClip

> Updated: 2026-05-22

## Tổng kết: 10 lần build, 10 lần lỗi UI

---

## Issue #1: Window Title "Error" — Root Cause

### Triệu chứng
- Packaged app mở window với title "Error" (Chromium error page)
- Window không hiển thị HyperClip UI

### Root Cause
1. `createWindow()` gọi `loadURL()` ngay lập tức khi Next.js chưa start
2. Chromium hiển thị error page ("This page is not available")
3. Error page có nút × (close) → gọi `quitAll()` → close window
4. Window title trở thành "Error" vì Chromium error page không có proper title
5. Even if user doesn't click ×, title stays "Error" until page loads

### Fix đã áp dụng
1. **Loại bỏ HTTP polling block** — Window tạo ngay, không đợi Next.js start
2. **Window ẩn đến khi page load thành công** — `mainWindow.show()` chỉ gọi trong `did-finish-load`, không dùng `ready-to-show`
3. **Retries tăng lên 40 lần** với back-off 2s→8s (tổng ~120s)

### Code change in `electron/main.ts`
```typescript
// TRƯỚC:
mainWindow.once('ready-to-show', () => {
  mainWindow?.show()  // ← Hiển thị NGAY, kể cả khi Next.js chưa start
})

// SAU:
mainWindow.webContents.on('did-finish-load', () => {
  devLog(`[HyperClip] Window loaded successfully`)
  mainWindow?.show()  // ← Chỉ hiển thị KHI PAGE LOAD XONG
})
```

---

## Issue #2: Build Pipeline rất chậm (~30 phút/lần)

### Nguyên nhân
```
npm run electron:build
  ├─ tsc --noEmit (check)          ~5s
  ├─ next build                     ~2-3 phút
  ├─ tsc compile                    ~10s
  ├─ electron-builder:
  │   ├─ @electron/rebuild          ~5-10 phút
  │   ├─ packaging (node_modules)  ~5-10 phút
  │   ├─ signing                    ~5-10 phút
  │   └─ NSIS installer             ~5-10 phút
  └─ portable zip                    ~5-10 phút
```

### Giải pháp
Chỉ compile TypeScript và copy vào release, KHÔNG rebuild từ đầu:
```bash
# Script nhanh để test logic thay đổi:
node node_modules/.pnpm/typescript@6.0.3/node_modules/typescript/lib/tsc.js -p electron/tsconfig.main.json
node node_modules/.pnpm/typescript@6.0.3/node_modules/typescript/lib/tsc.js -p electron/tsconfig.preload.json
cp dist-electron/main.js release/win-unpacked/resources/app/dist-electron/
cp dist-electron/preload.js release/win-unpacked/resources/app/dist-electron/
```

---

## Issue #3: NSIS Signing chậm

- Mỗi file trong installer đều được sign với signtool.exe
- ~10 files cần sign × ~3 lần = rất lâu
- Không có cách bypass trong môi trường dev

---

## Issue #4: `import.meta` không supported

```
error TS1343: The 'import.meta' meta-property is only allowed when
the '--module' option is 'es2020', 'es2022', 'esnext', 'system', 'node16', 'node20', or 'nodenext'.
```
**Fix:** `tsconfig.main.json` → `"module": "NodeNext"`

---

## Issue #5: `__filename` not defined in ESM

**Fix:** Dùng `createRequire(fileURLToPath(import.meta.url))`

---

## Issue #6: `BrowserWindow refers to a value, but is used as type`

**Fix:** `import type { BrowserWindow as BrowserWindowType }` + dùng `BrowserWindowType`

---

## Issue #7: `require('electron')` returns undefined in packaged app

**Fix:** Electron injects APIs vào `globalThis`. Dùng `global.d.ts` để declare globals.

---

## Issue #8: `startNextServer()` Promise hangs on error

**Fix:** `nextServer.on('error')` gọi `startupResolve()` thay vì `process.exit(1)`

---

## Issue #9: `ready-to-show` fires before page loads

Chromium's `ready-to-show` fires when window is ready to display, NOT when the page finishes loading. In production, Next.js hasn't started yet when `ready-to-show` fires → window shows Chromium error page.

**Fix:** Use `did-finish-load` event to show window instead.

---

## Issue #10: `show: false` không ngăn window hiển thị trong một số trường hợp

Electron vẫn có thể show window trước khi JS event handlers được setup. `ready-to-show` trigger trước khi `did-finish-load` handlers được gọi.

**Fix:** Dùng `did-finish-load` (không phải `ready-to-show`) để gọi `mainWindow.show()`

---

## Faster Test Workflow

Thay vì build lại từ đầu mỗi lần:

```bash
# Bước 1: Compile TypeScript
node node_modules/.pnpm/typescript@6.0.3/node_modules/typescript/lib/tsc.js -p electron/tsconfig.main.json
node node_modules/.pnpm/typescript@6.0.3/node_modules/typescript/lib/tsc.js -p electron/tsconfig.preload.json

# Bước 2: Copy vào release (nhanh, ~1 giây)
cp dist-electron/main.js release/win-unpacked/resources/app/dist-electron/
cp dist-electron/preload.js release/win-unpacked/resources/app/dist-electron/

# Bước 3: Test
Start-Process 'D:\LOOP_COMPANY\HyperClip\release\win-unpacked\HyperClip.exe'

# Chỉ rebuild đầy đủ KHI cần thay đổi:
# - electron-builder.yml
# - Next.js source code (src/)
# - package.json dependencies
# - Resources (ffmpeg, yt-dlp, node)
npm run electron:build
```

---

## Issue #2: App Exit Immediate (Code 0) — Root Cause

### Triệu chứng
- Packaged app exit ngay lập tức với exit code 0
- Không có window hiển thị
- Không có log file được tạo
- Tất cả debug attempts thất bại (fs.writeFileSync, console.error, etc.)

### Root Cause: `ELECTRON_RUN_AS_NODE=1`

**Phát hiện**: `ELECTRON_RUN_AS_NODE=1` được set trong bash environment của Claude Code.

Electron kiểm tra env var này khi khởi động. Nếu set → chạy như Node.js script thay vì desktop app:
- Electron binary chạy `node main.js` thay vì tạo BrowserWindow
- Node.js module resolution tìm `./ipc/channels.js` → không tìm thấy (`ipc/` nằm trong `dist-electron/`)
- Node.js exit với error

### Chứng minh
```bash
# Với ELECTRON_RUN_AS_NODE=1 → exit ngay (exit code 0)
$ HyperClip.exe
(node:xxx) Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'app/ipc/channels.js'
# Exit code 0 (Node.js exit, not Electron)

# Không có ELECTRON_RUN_AS_NODE → app chạy bình thường
$ env -u ELECTRON_RUN_AS_NODE powershell -Command "Start-Process HyperClip.exe"
HasExited: False, Title: 'HyperClip — Auto-Render'  # App chạy thành công!
```

### Tác động
- **Chỉ ảnh hưởng môi trường test** (Claude Code shell) — end users không bị vì họ không có env var này
- **ĐÃ FIX 2026-05-22**: Khi chạy `env -u ELECTRON_RUN_AS_NODE` hoặc từ PowerShell trực tiếp, app hoạt động bình thường

### Fast test (PowerShell)
```powershell
# Đảm bảo không có ELECTRON_RUN_AS_NODE
Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
Start-Process "D:\LOOP_COMPANY\HyperClip\release\win-unpacked\HyperClip.exe"
# App sẽ hiển thị sau ~25 giây (Next.js boot time)
```

---

## Issue #3: "Error" Page — Next.js Boot Time

### Triệu chứng
- App chạy nhưng window title trống trong 20-25 giây đầu
- Sau đó hiển thị "Error" page hoặc HyperClip UI (tùy Next.js startup)

### Root Cause
- Next.js production boot time: ~20-40s (lần đầu, cold start)
- Chromium hiển thị error page trong khi Next.js chưa ready
- **ĐÃ TỰ FIX**: `startNextServer()` spawn bundled Node.js + Next.js CLI → Next.js boot → Chromium load thành công sau ~25s

### Boot timeline
| Thời điểm | Trạng thái |
|---|---|
| 0s | App khởi động, diagnostics chạy |
| 2-3s | Next.js spawn, bắt đầu compile |
| 5s | Window hiển thị (trống) |
| 20-25s | Next.js ready → UI hiển thị |
| 25-30s | "HyperClip — Auto-Render" title xuất hiện |

### Đã xác nhận hoạt động (2026-05-22)
```
=== After 25s ===
HyperClip HasExited: False
HyperClip Title: HyperClip — Auto-Render  ✅
Node processes: 6
```

---

## Issue #4: globalThis.app Pattern — ESM Packaged App Crash

### Triệu chứng
- App exit với `Unhandled promise rejection: TypeError: Cannot read properties of undefined (reading 'isPackaged')`
- Startup dừng ở `runDiagnostics()` → `app.isPackaged` được gọi nhưng `app` = undefined

### Root Cause
Nhiều file dùng pattern `const app = (globalThis as any).app` để lấy Electron `app` object. Pattern này **không hoạt động** trong ESM packaged app vì Electron không expose globals vào `globalThis` khi chạy ESM modules.

### Files bị ảnh hưởng
- `electron/services/diagnostics.ts` — `globalThis.app`
- `electron/services/ffmpeg-paths.ts` — `globalThis.app`
- `electron/services/license.ts` — `globalThis.app`
- `electron/services/paths.ts` — `globalThis.app`
- `electron/services/logger.ts` — `globalThis.app`
- `electron/services/chrome_cookies.ts` — `globalThis.app`
- `electron/services/ramdisk.ts` — `globalThis.app`, `globalThis.shell`
- `electron/services/updater.ts` — `globalThis.app`
- `electron/services/youtube.ts` — `globalThis.app`
- `electron/ipc/handlers/storage.ts` — `globalThis.BrowserWindow`, `globalThis.dialog`
- `electron/ipc/handlers/system.ts` — `globalThis.shell`
- `electron/ipc/handlers/session.ts` — `globalThis.shell`, `globalThis.dialog`

### Fix (2026-05-22)
Thay `const app = (globalThis as any).app` bằng import trực tiếp:
```typescript
import { app } from 'electron'
import { shell } from 'electron'
import { dialog } from 'electron'
import { BrowserWindow } from 'electron'
```

### Lưu ý
- Dev mode hoạt động vì `npx electron .` chạy dev entry point khác
- Chỉ packaged app (ESM) bị ảnh hưởng

---

## Fast Test Workflow (2026-05-22) — ✅ ĐÃ FIX

```powershell
# 1. Unset ELECTRON_RUN_AS_NODE (QUAN TRỌNG - Claude Code shell co env var nay)
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue

# 2. Chay app
Start-Process "D:LOOP_COMPANYHyperClipeleasewin-unpackedHyperClip.exe"

# 3. Doi ~25s cho Next.js boot (lan dau)
# 4. Kiem tra
Get-Process | Where-Object { $_.MainWindowTitle -like '*HyperClip*' }
```

### Quick Compile (khong can full rebuild)
```bash
# Compile TypeScript + copy to release (~5 giay)
npx tsc -p electron/tsconfig.main.json && npx tsc -p electron/tsconfig.preload.json && cp -rf dist-electron/* release/win-unpacked/resources/app/dist-electron/
```
**Phai copy TAT CA files trong dist-electron/** (khong chi main.js va preload.js) vi cac service files cung duoc compile.

### Full Rebuild (30 phut)
```bash
npm run electron:build
```

## Next.js Boot Time in Production

| Environment | Thời gian boot |
|---|---|
| Dev (npm run dev) | ~2-5s |
| Production (.next/ pre-built) | ~20-40s lần đầu, ~5-10s các lần sau |
| Cold start (sau khi kill) | ~20-40s |

Điều này có nghĩa: window sẽ ẩn ~20-40s trước khi hiển thị HyperClip UI. User không thấy gì trong thời gian này.

### Tối ưu tiềm năng
1. **Pre-warm Next.js**: Spawn Next.js trước khi create window, nhưng vẫn giữ window ẩn
2. **Splash screen**: Hiển thị splash/loading screen trong window trước khi Next.js ready
3. **Background boot + IPC notify**: Boot Next.js background, gửi event cho renderer khi ready

---

## Issue #2: App Exit Immediate (Code 0) — Root Cause

### Triệu chứng
- Packaged app exit ngay lập tức với exit code 0
- Không có window hiển thị
- Không có log file được tạo
- Tất cả debug attempts thất bại (fs.writeFileSync, console.error, etc.)

### Root Cause: `ELECTRON_RUN_AS_NODE=1`

**Phát hiện**: `ELECTRON_RUN_AS_NODE=1` được set trong bash environment của Claude Code.

Electron kiểm tra env var này khi khởi động. Nếu set → chạy như Node.js script thay vì desktop app:
- Electron binary chạy `node main.js` thay vì tạo BrowserWindow
- Node.js module resolution tìm `./ipc/channels.js` → không tìm thấy (`ipc/` nằm trong `dist-electron/`)
- Node.js exit với error

### Chứng minh
```bash
# Với ELECTRON_RUN_AS_NODE=1 → exit ngay (exit code 0)
$ HyperClip.exe
(node:xxx) Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'app/ipc/channels.js'
# Exit code 0 (Node.js exit, not Electron)

# Không có ELECTRON_RUN_AS_NODE → app chạy bình thường
$ env -u ELECTRON_RUN_AS_NODE powershell -Command "Start-Process HyperClip.exe"
HasExited: False, Title: 'HyperClip — Auto-Render'  # App chạy thành công!
```

### Tác động
- **Chỉ ảnh hưởng môi trường test** (Claude Code shell) — end users không bị vì họ không có env var này
- **ĐÃ FIX 2026-05-22**: Khi chạy `env -u ELECTRON_RUN_AS_NODE` hoặc từ PowerShell trực tiếp, app hoạt động bình thường

### Fast test (PowerShell)
```powershell
# Đảm bảo không có ELECTRON_RUN_AS_NODE
Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
Start-Process "D:\LOOP_COMPANY\HyperClip\release\win-unpacked\HyperClip.exe"
# App sẽ hiển thị sau ~25 giây (Next.js boot time)
```

---

## Issue #3: "Error" Page — Next.js Boot Time

### Triệu chứng
- App chạy nhưng window title trống trong 20-25 giây đầu
- Sau đó hiển thị "Error" page hoặc HyperClip UI (tùy Next.js startup)

### Root Cause
- Next.js production boot time: ~20-40s (lần đầu, cold start)
- Chromium hiển thị error page trong khi Next.js chưa ready
- **ĐÃ TỰ FIX**: `startNextServer()` spawn bundled Node.js + Next.js CLI → Next.js boot → Chromium load thành công sau ~25s

### Boot timeline
| Thời điểm | Trạng thái |
|---|---|
| 0s | App khởi động, diagnostics chạy |
| 2-3s | Next.js spawn, bắt đầu compile |
| 5s | Window hiển thị (trống) |
| 20-25s | Next.js ready → UI hiển thị |
| 25-30s | "HyperClip — Auto-Render" title xuất hiện |

### Đã xác nhận hoạt động (2026-05-22)
```
=== After 25s ===
HyperClip HasExited: False
HyperClip Title: HyperClip — Auto-Render  ✅
Node processes: 6
```

---

## Issue #4: globalThis.app Pattern — ESM Packaged App Crash

### Triệu chứng
- App exit với `Unhandled promise rejection: TypeError: Cannot read properties of undefined (reading 'isPackaged')`
- Startup dừng ở `runDiagnostics()` → `app.isPackaged` được gọi nhưng `app` = undefined

### Root Cause
Nhiều file dùng pattern `const app = (globalThis as any).app` để lấy Electron `app` object. Pattern này **không hoạt động** trong ESM packaged app vì Electron không expose globals vào `globalThis` khi chạy ESM modules.

### Files bị ảnh hưởng
- `electron/services/diagnostics.ts` — `globalThis.app`
- `electron/services/ffmpeg-paths.ts` — `globalThis.app`
- `electron/services/license.ts` — `globalThis.app`
- `electron/services/paths.ts` — `globalThis.app`
- `electron/services/logger.ts` — `globalThis.app`
- `electron/services/chrome_cookies.ts` — `globalThis.app`
- `electron/services/ramdisk.ts` — `globalThis.app`, `globalThis.shell`
- `electron/services/updater.ts` — `globalThis.app`
- `electron/services/youtube.ts` — `globalThis.app`
- `electron/ipc/handlers/storage.ts` — `globalThis.BrowserWindow`, `globalThis.dialog`
- `electron/ipc/handlers/system.ts` — `globalThis.shell`
- `electron/ipc/handlers/session.ts` — `globalThis.shell`, `globalThis.dialog`

### Fix (2026-05-22)
Thay `const app = (globalThis as any).app` bằng import trực tiếp:
```typescript
import { app } from 'electron'
import { shell } from 'electron'
import { dialog } from 'electron'
import { BrowserWindow } from 'electron'
```

### Lưu ý
- Dev mode hoạt động vì `npx electron .` chạy dev entry point khác
- Chỉ packaged app (ESM) bị ảnh hưởng

---

## Fast Test Workflow (2026-05-22)

```powershell
# 1. Unset ELECTRON_RUN_AS_NODE (QUAN TRỌNG!)
$env:ELECTRON_RUN_AS_NODE = $null

# 2. Chạy app
Start-Process "D:\LOOP_COMPANY\HyperClip\release\win-unpacked\HyperClip.exe"

# 3. Kiểm tra
Start-Sleep 5
Get-Process | Where-Object { $_.Name -like '*HyperClip*' }
```

### Quick Compile (không cần full rebuild)
```bash
# Compile TypeScript + copy to release (5 giây)
npx tsc -p electron/tsconfig.main.json && \
npx tsc -p electron/tsconfig.preload.json && \
cp dist-electron/main.js release/win-unpacked/resources/app/dist-electron/main.js && \
cp dist-electron/preload.js release/win-unpacked/resources/app/dist-electron/preload.js
```

### Full Rebuild (30 phút)
```bash
npm run electron:build
```
