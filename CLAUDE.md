# CLAUDE.md — HyperClip

> Source of truth: `HYPERCLIP_RULES.md` (root). File này là hướng dẫn cho Claude Code.

---

## Mục tiêu cốt lõi

**Bắt 100% video mới trong < 20 giây, chạy 24/7 cho ~100 kênh YouTube.**

## Auto-Ingestion Pipeline

> **Spec latency + invariants: `docs/DETECTION_LATENCY.md` — ĐỌC TRƯỚC KHI SỬA poller/download.**
> Mục tiêu: detect < 3s, e2e detect→rendered < 10s.

```
YouTubePoller (2 giây ± 10% jitter, floor 1s)
         ↓
poll_once() → ALL channels FULL PARALLEL (concurrency = min(daemonLimit=max_sessions, ready);
              render active → throttle tier-aware: High=8, Mid/Low=2. KHÔNG cap cứng, KHÔNG defer)
         ↓
1. Innertube API (30 Chrome sessions, SAPISIDHASH) — PRIMARY, NO QUOTA
   → getLatestVideo: check top-1..top-5, seen dedup (return null → continue)
   → publishedAt=0 → OAuth verify (real upload timestamp)
   → OAuth Data API v3 fallback khi Innertube die (pool=0)
         ↓
Filter: age ≤ 10 min, unseen, not deleted
         ↓
autoDownload (yt-dlp --download-sections, 16 fragments, web,android client; IP bind cached 5min)
  ∥ song song: thumbnail + composite background pre-warm
         ↓ workspace ready → auto-render (bg cache HIT) → notify
```

**Chi tiết quota system và Innertube failure modes:** xem HYPERCLIP_RULES.md section 3b.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop Shell | PySide6 (QML/QtQuick) |
| Frontend | QML (QtQuick) |
| State | Python models + Rust backend |
| Styling | QML inline (Theme singleton) |
| Backend | Rust binary (`hyperclip-tauri.exe`) — stdin/stdout JSON-RPC |
| Auth Primary | Innertube API via Chrome Session Cookies (30 profiles, NO quota) |
| Auth Fallback | OAuth 2.0 + Data API v3 (TokenManager, 10k units/project/day) |
| API Key Pool | KeyManager (dự phòng tương lai) |
| Downloader | yt-dlp + Direct IP Binding |
| Video Processing | FFmpeg + NVIDIA NVENC (RTX 5080) |
| Hardware | Intel Core Ultra 9 285K, RTX 5080 16GB, 64GB RAM |

---

## Thư mục chính

```
src/
  main.py                — Python launcher: QGuiApplication + spawn Rust binary
  backend/
    client.py             — RustClient (stdin/stdout JSON-RPC to Rust)
  models/                 — Python → QML context models
  ui/qml/                — QML views (PollerPanel, WorkspaceQueue, etc.)

crates/hyperclip_ipc/src/
  chrome_watcher.rs       — Chrome CDP watcher (127.0.0.1:9222/json, 500ms, instant ~0s detection)
  cookies.rs              — DPAPI decrypt + SQLite parser, SOCS=CAI injection
  cookies_sqlite.rs       — SQLite reader (%youtube.com + .youtube.com filter)
  detection.rs            — Detection pipeline + health monitor
  ffmpeg.rs               — FFmpeg filter chain + NVENC params
  innertube_pool.rs       — 30 sessions, atomic round-robin, 10s cooldown
  innertube_client.rs     — Node subprocess wrapper (youtubei.js via JSON-RPC)
  poller.rs               — Async polling loop (5s ± 20% jitter)
  store.rs                — Persistent JSON store (workspaces, channels, settings)
  system.rs               — GPU detection + system stats
  youtube.rs              — yt-dlp arg builder + download orchestration

src-tauri/src/
  main.rs                 — Rust binary entry point (stdin/stdout JSON-RPC loop)
  commands.rs             — ~80 IPC command handlers

docs/
  MIGRATION_NOTES.md      — Logic từ Electron cần verify trên Rust

HYPERCLIP_RULES.md        — Source of truth nghiệp vụ + kỹ thuật
```

---

## IPC Protocol

**Python ↔ Rust (stdin/stdout JSON-RPC):**

- **Request:** `{"id": 123, "cmd": "channel:list", "params": {}}` (stdin)
- **Response:** `{"id": 123, "ok": true, "result": {...}}` (stdout)
- **Push event:** `{"method": "workspace:update", "params": {...}}` (stdout, no `id`)

**Key Rust commands (80+ handlers in `commands.rs`):**

| Group | Commands |
|-------|---------|
| Workspace | `workspace:list/add/update/delete/retry/autoDownload/redownloadHd/split/setActive` |
| Channel | `channel:list/add/remove/update/pause/resume/bulk*/sync/autoAssign/getInfo` |
| Render | `render:start/cancel/chunked/split/splitPreview` |
| Video | `video:getFile/getBlob/getAvailableFormats/image:getFile/video:saveBlob` |
| Auth | `auth:status/extractCookies/logout/startOAuth/startChromeLogin/setCredentials/getCredentials` |
| Poller | `poller:start/stop/status/resume`, `detection:history` |
| System | `system:stats/openFolder/openUrl/pickFolder/runDiagnostics/hardware:profile` |

**Python → QML (context properties):**
- `backend` — RustClient instance
- `workspaceModel`, `channelModel`, `pollerStatusModel`, `settingsModel`, etc.
- `eventBus` — event distribution từ Rust push events

---

## Important Code Patterns

### Python models (src/models/)
- Mỗi model là QObject subclass, exposed làm QML context property
- `refresh_from_backend(backend)` — pulls data từ Rust qua JSON-RPC
- Dùng `pyqtSignal` để notify QML khi data change

### Rust IPC commands (src-tauri/src/commands.rs)
- Single `handle_command(req: IpcRequest) -> CommandResult` dispatch (~2500 lines)
- Every branch returns `CommandResult::Ok(Value)` or `CommandResult::Err(String)`
- `AppState` singleton (OnceLock) — manages poller, innertube pool, worker pool

### Module-level caching (Rust)
- `_cachedGPU` in `system.rs` — GPU detection runs ONCE at startup
- Channel list cached, invalidated on add/sync

---

## Commands

```bash
python src/main.py             # Run QML app (spawns Rust binary)
cargo build -p hyperclip-tauri  # Build Rust binary
cargo test -p hyperclip-ipc     # Run Rust tests
cargo clippy -p hyperclip-ipc   # Lint Rust code
```

---

## Rust Verify

Luôn chạy `cargo test -p hyperclip-ipc` và `cargo clippy -p hyperclip-ipc` sau khi sửa crate này.

Kiểm tra JSON-RPC protocol: response/event phải đúng format, push events không có `id`.

---

## Dead Code

Electron + Next.js đã archive (2026-06-09). Xem `docs/MIGRATION_NOTES.md` cho logic cần verify trên Rust.
Code gốc ở `../HyperClip-Electron-Archive/` — git history vẫn giữ đầy đủ.
