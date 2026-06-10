# HyperClip — Rust Migration Design

**Date:** 2026-06-03
**Branch:** `migrate`
**Status:** Draft for review

---

## 1. Mục tiêu

Chuyển nhánh `migrate` từ Electron + Node.js + TypeScript backend sang **Tauri + Rust backend**, **giữ nguyên frontend React/Next.js**, đảm bảo **đầy đủ logic nghiệp vụ và behavior cũ** (detection, download, render, auth, IPC).

### Non-goals

- KHÔNG rewrite UI sang Rust-native (egui/Slint/Dioxus). Frontend React/Next được tái sử dụng nguyên vẹn.
- KHÔNG đổi data model (Workspace, Channel, Project schema) — giữ tương thích với `.hyperclip/*.json` hiện có.
- KHÔNG giảm scope feature (auto-ingestion, render queue, settings, health alerts, OAuth flow).
- KHÔNG support multi-platform (vẫn Windows-only do phụ thuộc DPAPI và NVENC).

---

## 2. Bối cảnh hiện trạng

- `main` và `migrate` đang ở cùng commit `8cf0f91` — branch `migrate` thực tế chưa tách logic mới.
- Có dấu vết WPF migration (commits `feat(wpf): Phases 1-8`) nhưng **chỉ commit `bin/obj` artifacts**, không có file `.cs` source nào. Folder `hyperclip/` trên disk cũng rỗng source.
- Codebase hiện tại: ~22.000 LOC TypeScript backend (`electron/`), ~23.000 LOC TypeScript/TSX frontend (`src/`).
- 31 service file trong `electron/services/` + 17 IPC handler trong `electron/ipc/handlers/` + `electron/main.ts` (2.504 dòng).

### Hệ quả

- Có thể **xóa hoàn toàn** `hyperclip/` (C# artifacts) — không có gì để thừa kế.
- Phải port từ `electron/` (TypeScript) sang Rust trên một branch sạch.

---

## 3. Quyết định kiến trúc

### 3.1. Stack

| Layer | Cũ (Electron) | Mới (Tauri/Rust) |
|---|---|---|
| Desktop shell | Electron 30 | Tauri 2.x |
| Frontend | Next.js 14 + React 18 | **Giữ nguyên Next.js 14 + React 18** |
| State management | Zustand | **Giữ nguyên Zustand** |
| Styling | Tailwind v3 + shadcn/ui | **Giữ nguyên** |
| Backend runtime | Node.js (Electron main) | Rust + `tokio` async runtime |
| HTTP client | `node-fetch` | `reqwest` |
| JSON | `JSON` built-in | `serde` + `serde_json` |
| SQLite | `sql.js` | `rusqlite` |
| Crypto (DPAPI) | `win-dpapi` | `winapi` + `CryptUnprotectData` |
| Crypto (AES-GCM) | `node:crypto` | `aes-gcm` crate |
| Crypto (SHA1 / SAPISIDHASH) | `node:crypto` | `sha1` crate |
| Process spawn | `node:child_process` | `tokio::process::Command` |
| Logger | `electron-log` | `tracing` + `tracing-appender` |
| IPC bridge | `ipcMain.handle` / `webContents.send` | `#[tauri::command]` + `app.emit_all()` |
| Build | `electron-builder` | Tauri bundler (`.exe` + `.msi`) |

### 3.2. Tauri vs Electron — vì sao

- **RAM giảm ~80%** (Chromium tái sử dụng WebView2 hệ thống, không nhúng riêng).
- **Bundle size giảm 10x** (~5MB vs ~80MB Electron + Node modules).
- **Type-safe IPC** (Tauri command với serde) thay vì `any` payload.
- Tauri 2.x đã ổn định trên Windows, hỗ trợ system tray, single-instance, auto-updater.

### 3.3. UI giữ nguyên React vì

- 23K LOC frontend không bị mất.
- UX detail (focus-visible outline, keyboard shortcut Space/Arrow, drag-and-drop) đã được tinh chỉnh nhiều lần — rewrite UI Rust-native sẽ rủi ro mất parity.
- React component (DetailEditor canvas, RenderedVideos preview) phức tạp với `konva`, `react-konva`, `react-resizable-panels` — không có equivalent đủ trưởng thành trong Rust-native UI.

### 3.4. IPC contract 1:1

- Mỗi `ipcMain.handle('channel:x', handler)` cũ map sang `#[tauri::command] async fn channel_x(...)`.
- Channel name giữ nguyên (`workspace:list`, `channel:add`, `render:start`, v.v.).
- Payload shape (Workspace, Channel, RenderProgress…) định nghĩa lại bằng `serde` derive, JSON shape khớp với TS types cũ.
- **Streams** (system stats 5s, render progress, autodownload notify, channel:synced-event) chuyển sang **Tauri Event API** (`app.emit_all` + `listen` ở FE) thay vì `webContents.send`.
- Frontend `src/app/lib/ipc.ts` được rewrite thành shim:
  ```ts
  import { invoke } from '@tauri-apps/api/core'
  import { listen } from '@tauri-apps/api/event'

  export const ipc = {
    workspaceList: () => invoke('workspace_list'),
    workspaceAdd: (url: string) => invoke('workspace_add', { url }),
    // ...
    onSystemStats: (cb) => listen('system:stats-update', e => cb(e.payload)),
  }
  ```
- React component vẫn gọi `ipc.workspaceList()` như cũ — không sửa logic component.

---

## 4. Cấu trúc thư mục

```
HyperClip/
├── src/                           [GIỮ NGUYÊN]      React/Next.js frontend
│   └── app/
│       ├── components/            (React components)
│       ├── lib/
│       │   ├── ipc.ts             [REWRITE]         Tauri invoke + event shim
│       │   └── store.ts           (Zustand giữ nguyên)
│       └── ...
├── src-tauri/                     [MỚI]             Rust backend
│   ├── Cargo.toml                                   workspace root
│   ├── tauri.conf.json                              Tauri config
│   ├── build.rs
│   ├── icons/                                       app icons
│   ├── src/
│   │   ├── main.rs                                  bootstrap + DI wiring
│   │   └── lib.rs
│   └── crates/
│       ├── hyperclip-core/                          domain types, error enums
│       ├── hyperclip-store/                         JSON persistence (workspaces, channels, projects)
│       ├── hyperclip-system/                        GPU, RAM, CPU, network stats
│       ├── hyperclip-cookies/                       Chrome DPAPI + SQLite + SAPISIDHASH
│       ├── hyperclip-auth/                          OAuth + TokenManager + KeyManager
│       ├── hyperclip-innertube/                     Innertube client + 30-session pool
│       ├── hyperclip-yt/                            yt-dlp spawn wrapper
│       ├── hyperclip-ffmpeg/                        FFmpeg + NVENC + worker pool
│       ├── hyperclip-detect/                        subscription_feed + poller (5s±20% jitter)
│       ├── hyperclip-project/                       project_manager + repair + batch ops
│       ├── hyperclip-health/                        health_alerts + diagnostics
│       └── hyperclip-ipc/                           Tauri command handlers (1:1 IPC map)
├── docs/                          [GIỮ NGUYÊN]
├── scripts/                       [GIỮ một phần]   chỉ giữ setup-ytdlp, generate-icon, v.v.
├── resources/                     [GIỮ NGUYÊN]     yt-dlp.exe, fonts, icons
├── electron/                      [XÓA ở M9]       sau khi parity
├── hyperclip/                     [XÓA ở M0]       WPF artifacts cũ
├── package.json                   [SỬA]            chỉ giữ deps frontend
├── tsconfig.json                  [GIỮ NGUYÊN]
├── next.config.mjs                [SỬA]            export static cho Tauri
└── tauri.conf.json                                  ở src-tauri/
```

### Lý do tách crates thay vì 1 crate đơn

- Build incremental nhanh hơn (mỗi crate compile riêng).
- Test isolated dễ hơn — `cargo test -p hyperclip-cookies` không build phần FFmpeg.
- Phân tách boundary rõ — không cho `cookies` trực tiếp gọi `innertube`, phải qua `innertube` crate (DI ở `main.rs`).
- Khi cần extract reusable lib (ví dụ `hyperclip-innertube` thành crate publish), đã sẵn.

---

## 5. Module mapping — TS → Rust

| `electron/services/*.ts` | `src-tauri/crates/*` | Ghi chú |
|---|---|---|
| `store.ts` | `hyperclip-store` | `serde_json` + `tokio::fs` |
| `constants.ts` | `hyperclip-core::constants` | timing, limits |
| `paths.ts` | `hyperclip-core::paths` | workspace dir, log dir resolution |
| `logger.ts` + `unified_log.ts` + `operation_log.ts` + `dev_log.ts` | `hyperclip-core::log` | `tracing` + custom appenders |
| `system.ts` | `hyperclip-system` | `nvml-wrapper` + `sysinfo` crate |
| `ramdisk.ts` | `hyperclip-core::paths` | path utility |
| `crypto.ts` + `hwid.ts` | `hyperclip-core::crypto` | machine ID |
| `chrome_cookies.ts` + `cookie_manager.ts` + `cdp.ts` | `hyperclip-cookies` | DPAPI, Chrome SQLite, SAPISIDHASH, SessionManager |
| `youtube_auth.ts` + `token_manager.ts` + `key_manager.ts` | `hyperclip-auth` | OAuth flow, token rotation, key pool |
| `po_token.ts` | `hyperclip-cookies::po_token` | PO Token generator (nếu cần) |
| `innertube_client.ts` | `hyperclip-innertube` | 7-strategy extraction + pool |
| `subscription_feed.ts` | `hyperclip-detect::feed` | Innertube primary + OAuth fallback |
| `youtube_poller.ts` | `hyperclip-detect::poller` | 5s ± 20% jitter, dedup |
| `youtube.ts` | `hyperclip-yt` | yt-dlp wrapper, `tv_embedded` priority |
| `ffmpeg.ts` + `ffmpeg-paths.ts` + `worker-pool.ts` | `hyperclip-ffmpeg` | NVENC, filter chain, concurrent FFmpeg |
| `project_manager.ts` | `hyperclip-project` | project CRUD, repair, batch |
| `health_alerts.ts` + `diagnostics.ts` | `hyperclip-health` | 6 alert conditions, diagnostics |
| `encrypted_yaml.ts` | `hyperclip-auth::secrets` | encrypted credential storage |
| `updater.ts` + `github-updater.ts` | `hyperclip-core::updater` | Tauri updater plugin + GitHub releases |
| `electron/ipc/handlers/*.ts` | `hyperclip-ipc/*` | Tauri commands |
| `electron/main.ts` | `src-tauri/src/main.rs` | bootstrap + DI |
| `electron/preload.ts` | (xóa) | Tauri không cần preload — invoke trực tiếp từ FE |

---

## 6. Logic-critical bảo toàn (parity checklist)

### 6.1. Detection

- [ ] Poll interval **5000ms ± 20% jitter** (4000–6000ms) trong `hyperclip-detect::poller`
- [ ] **Innertube PRIMARY** với 30 session Chrome (15 nếu RAM < 32GB) — auto detect tier ở `hyperclip-system`
- [ ] SAPISIDHASH format: `SHA1(timestamp + ' ' + SAPISID + ' ' + origin)` + prefix `SAPISIDHASH timestamp_hash`
- [ ] **OAuth fallback** khi Innertube pool = 0 (`hyperclip-detect::feed` chọn provider)
- [ ] **SOCS=CAI** force-injected ở 4 chỗ (cookie file load, request header, session init, OAuth call)
- [ ] LockupView V1 + V2 parsing (tham chiếu `memory/lockupview_structure.md`)
- [ ] Age filter ≤ **10 phút**
- [ ] Duration filter < **60 giây** skip (Short)
- [ ] Aspect filter **9:16** skip (vertical)
- [ ] `publishedAt=0` → OAuth verify qua `/videos?id=...&part=snippet`
- [ ] Top-1..top-5 dedup, `seen` set, `return null → continue` bug fix giữ nguyên
- [ ] Channel:synced-event 15 phút interval

### 6.2. Download

- [ ] yt-dlp client priority: **`tv_embedded` → `web` → `ios`**
- [ ] `--download-sections` cho trim từ source
- [ ] Multi-instance + **16 fragment parallel**
- [ ] `maxConcurrent = 1` (theo doc)
- [ ] Format selector: ưu tiên resolution (không restrict H.264)
- [ ] Pre-scale step (`preScaleVideo`) trước render để bypass GPU scale_cuda
- [ ] `autoRender: true` trigger ngay sau download, `autoRenderAttempted` flag chống loop

### 6.3. Render

- [ ] Filter chain: `fps=30,setpts=PTS-STARTPTS,trim,scale,crop` (KHÔNG dùng `select`, KHÔNG `-r 30`)
- [ ] Z-order SHORT: bg → video → header → bottom_bar
- [ ] Bitrate caps: 360p→3M, 720p→6M, 1080p→12M
- [ ] CRF: single 18, chunked 20
- [ ] Bottom bar PNG: `canvasW × bottomH`, LockBits A=255, overlay at `y = canvasH - bottomH`
- [ ] Preset: `p1` + `ull` (auto-render fast path)
- [ ] Direct FFmpeg spawn (không qua PS1)
- [ ] Worker pool concurrent management
- [ ] Pre-scaled file cleanup sau render

### 6.4. Health alerts

- [ ] 6 condition + 5-min cooldown:
  1. Innertube dead (0/30 sessions) → Critical
  2. OAuth low (<10%) → Warning
  3. OAuth exhausted → Critical
  4. Disk low (<5GB free) → Critical
  5. Download failures (3+ consecutive) → Warning
  6. No new videos 24h → Warning

### 6.5. Misc

- [ ] FFmpeg path resolver có backslash fix (Scoop shim `shims\ffmpeg` → form-feed)
- [ ] DPAPI cookie extract chỉ chạy được khi Chrome đã đóng (KNOWN issue #8 — giữ nguyên hành vi)
- [ ] mqdefault.jpg 404 fallback → `maxresdefault.jpg`
- [ ] Customer cookie file `_hyperclip_cookies.json` portable (DPAPI giải mã 1 lần ở operator)
- [ ] Auto-update qua GitHub release

---

## 7. Milestones — incremental port

Mỗi milestone phải **build chạy được** (không break app).

| M | Mục tiêu | Output verify |
|---|---|---|
| **M0** | Tauri scaffold, xoá `hyperclip/`, `hyperclip-core`+`hyperclip-store` cơ bản, FE `ipc.ts` shim | App khởi động, load workspace list từ JSON |
| **M1** | `hyperclip-system` + system IPC commands + Tauri event stream `system:stats-update` | Sidebar hiển thị GPU/RAM/CPU realtime |
| **M2** | `hyperclip-yt` + `workspace:add`/`workspace:list`/`workspace:retry` commands | Dán URL → yt-dlp download, workspace status update |
| **M3** | `hyperclip-ffmpeg` + `render:*` commands + worker pool + bottom bar PNG | Render NVENC parity, output .mp4 đúng filter chain |
| **M4** | `hyperclip-cookies` (DPAPI + SQLite + SAPISIDHASH + session pool) | Extract cookie từ Chrome, build session pool 30 |
| **M5** | `hyperclip-auth` (OAuth flow + TokenManager + KeyManager + encrypted yaml) | OAuth credentials nhập, token refresh, key rotation |
| **M6** | `hyperclip-innertube` (7-strategy extraction, pool, LockupView V1+V2) | Innertube đăng nhập thành công 1 session từ cookie, parse được top-5 video latest từ subscription feed (so sánh kết quả với Node implementation cũ trên cùng channel) |
| **M7** | `hyperclip-detect` (subscription_feed + poller 5s±20% jitter + dedup + age filter) | Full auto-ingestion: poll → detect → download trigger |
| **M8** | `hyperclip-project` + `hyperclip-health` + `diagnostics` + remaining IPC | Settings page chạy đầy đủ, health alerts fire |
| **M9** | Xóa `electron/`, package `package.json`, build `.exe` Tauri, smoke test E2E | Customer-installable bundle |

### Verification gate giữa milestone

Trước khi sang milestone tiếp:
- `cargo build --release` không warning
- `cargo test -p <crate>` pass
- `cargo clippy -- -D warnings` clean
- App khởi động và **feature mới milestone đó** chạy đúng manual test (theo HYPERCLIP_RULES golden path)
- Không regression feature đã có (smoke test danh sách workspace, render queue)

---

## 8. Frontend changes

Phần frontend được giữ tối đa, sửa duy nhất:

| File | Sửa gì |
|---|---|
| `src/app/lib/ipc.ts` | Rewrite: dùng `@tauri-apps/api/core::invoke` + `event::listen`. Giữ nguyên function name, return shape |
| `src/types/electron.d.ts` | Đổi sang `tauri.d.ts` (chỉ shape, không có `window.electronAPI`) |
| `package.json` deps | Bỏ Electron + electron-log + electron-builder; thêm `@tauri-apps/api`, `@tauri-apps/plugin-*` |
| `package.json` scripts | Thay `electron:dev` → `tauri dev`, `electron:build` → `tauri build` |
| `next.config.mjs` | Thêm `output: 'export'` cho Tauri static |
| `src/app/components/*` | Không sửa (gọi qua `ipc.*` shim) |

---

## 9. Build & run

### Dev

```bash
# Install Rust toolchain (one-time)
rustup default stable
rustup target add x86_64-pc-windows-msvc

# Install Tauri CLI (one-time)
cargo install tauri-cli --version "^2.0"

# Install frontend deps
npm install

# Run dev (Next.js dev server + Tauri WebView, hot-reload cả 2 phía)
npm run dev          # alias cho `cargo tauri dev` qua scripts
```

`package.json` mới sẽ có scripts:

```json
{
  "scripts": {
    "dev": "cargo tauri dev",
    "build": "cargo tauri build",
    "tauri": "cargo tauri"
  }
}
```

### Production build

```bash
npm run build
# output: src-tauri/target/release/bundle/{msi,nsis}/HyperClip-x.y.z-setup.exe
```

---

## 10. Risks & mitigation

| Rủi ro | Mitigation |
|---|---|
| Tauri 2.x trên Windows + WebView2 có thể khác Chromium Electron (CSS, drag-drop) | Smoke test sớm ở M0; có fallback patch CSS nếu cần |
| Rust async vs Node event loop khác mô hình → race condition mới | Test isolated từng crate; dùng `tokio::sync::Mutex` cho shared state |
| DPAPI binding qua `winapi` complex | Dùng wrapper crate `windows` (Microsoft official); test extract cookie giống output Node |
| `nvml-wrapper` không support GPU mới (RTX 5080) | Có sẵn fallback `wmic`/`nvidia-smi` parser |
| yt-dlp subprocess streaming stdout khác cách Node parse | Strict line-buffer reader, match regex giống TS |
| Frontend `ipc.ts` shim API mismatch | Type test với TypeScript strict; smoke test mỗi IPC channel |
| Tauri command size limit (default 1MB) cho video blob | Dùng custom IPC scheme hoặc `tauri-plugin-fs` cho video file |
| Auto-update path đổi (Electron → Tauri updater) | Migration step ở M9 — manual override với release notes |

---

## 11. Cleanup ở M9

- Xóa thư mục: `electron/`, `hyperclip/`, `test-regex.js`, `test-regex2.js`, `tests/_test_electron*`
- Xóa scripts Electron-specific: `scripts/electron-dev.cjs`, `scripts/build.mjs` (replace bằng tauri build)
- Cập nhật `CLAUDE.md`, `HYPERCLIP_RULES.md`, `MEMORY.md` để phản ánh stack mới
- Cập nhật `README.md` với install instruction Tauri
- Tag release `v1.0.0-rust` trên branch `migrate`, tạo PR merge vào `main`

---

## 12. Open questions (chốt trước khi viết plan)

(Không còn open question. Tất cả đã chốt qua brainstorming.)

### Lưu ý về scope

Đây là spec **multi-milestone**, ~22K LOC port. Khi `writing-plans` skill chạy, plan có thể được tách thành **1 plan/milestone** (M0..M9 = 10 plan riêng), thay vì 1 plan khổng lồ. Plan đầu tiên (M0) sẽ là deliverable đầu tiên có thể merge.

---

## 13. Approval

Spec này cần user review trước khi sang `writing-plans` skill để tạo implementation plan chi tiết theo milestone.
