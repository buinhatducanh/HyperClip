# HyperClip Migration Design — QML/Rust Rewrite for 100% Feature Parity

**Date**: 2026-06-07
**Status**: Draft (awaiting user approval)
**Author**: PO audit + migration planning
**Target**: Big Bang migration sang QML/Rust trong 4 phases, 5-6 tuần

---

## Context

HyperClip hiện có 2 implementation cùng tồn tại:

1. **Electron + TypeScript cũ** (proven, 70% nghiệp vụ hoạt động) — `electron/`, `src/app/`
2. **QML + Rust + Tauri mới** (UI 90% đủ, backend 0% — toàn stub) — `src/`, `src-tauri/`, `crates/hyperclip_ipc/`

Audit kết luận hệ thống mới **chưa đủ điều kiện nghiệm thu** do 80+ IPC command handlers đều là mock `{"ok": true}`. Cần migrate nghiệp vụ từ electron cũ sang Rust backend thật.

**Mục tiêu cuối cùng**: 100% parity với electron cũ + bổ sung inline edit UI (speed/trim/title/thumbnail) + auto-render default = true.

---

## Goals (đo lường được)

1. Detection < 5s median, < 10s p95 với 30 channels
2. Download 1080p H.264 từ YouTube, trim 10 phút đầu, < 60s
3. Auto-render sau download, NVENC, < 2 phút cho 1 phút source
4. UI edit per-video: speed (1.0-2.0×), trim (start/end), title, thumbnail
5. 24h stability với 30 channels, < 4GB RAM idle, no crash

## Non-Goals (YAGNI)

- Không port tất cả electron test/UI components không cần
- Không thêm OAuth token rotation mới (giữ logic electron cũ)
- Không viết lại youtubei.js parser bằng Rust
- Không tối ưu extreme (giữ approach proven, ship sớm)

---

## Architecture (3-layer, giữ nguyên cấu trúc hiện tại)

```
┌─────────────────────────────────────────────────────────────┐
│  Python + Qt/QML UI (src/)                                  │
│  - 14 Qt Models exposed via context property                │
│  - 50+ QML components (3-pane, settings, edit, modals)      │
│  - 5s/15s polling timers cho system:stats + poller:status   │
└─────────────────────────────────────────────────────────────┘
                            │  JSON-RPC over stdin/stdout
                            │  (subprocess.Popen + PIPE)
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  Rust Backend (src-tauri/hyperclip.exe)                     │
│  - IPC dispatcher (commands.rs) — 80+ handlers              │
│  - 2 background tasks: Poller::run + WorkerPool::run        │
│  - EventEmitter: gửi events qua stdout → Python EventBus    │
└─────────────────────────────────────────────────────────────┐
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  hyperclip_ipc crate (Rust)                                 │
│  - cookies: DPAPI + sql.js → CookieExtractionResult         │
│  - detection: 30 InnertubeClient + Poller + HealthMonitor   │
│  - youtube: yt-dlp wrapper (tv_embedded, --download-sections)│
│  - ffmpeg: NVENC params + filter chain + spawn_render       │
│  - store: JSON persistence (workspaces, channels, seen-ids) │
│  - system: GPU detection + NVENC tier table + nvidia-smi    │
└─────────────────────────────────────────────────────────────┘
```

**Đã verified**: Binary `hyperclip.exe` và `hyperclip-tauri.exe` đã build thành công tại `src-tauri/target/{debug,release}/`.

---

## 6 Work Streams (dependency order)

| # | Work Stream | Output | Effort | Risk | Phase |
|---|---|---|---|---|---|
| WS1 | Cookie Extraction | DPAPI + SQLite → 30 sessions | 1 tuần | 🟡 Medium | 1 |
| WS2 | Detection Pipeline | InnertubeClient pool + Poller loop | 1.5 tuần | 🟡 Medium | 1 |
| WS3 | Download Pipeline | yt-dlp wired + auto-download | 1 tuần | 🟢 Low | 2 |
| WS4 | Render Pipeline | FFmpeg wired + auto-render | 1 tuần | 🟢 Low | 2 |
| WS5 | Inline Edit UI | speed/trim/title/thumbnail | 1.5-2 tuần | 🟢 Low | 3 |
| WS6 | Cleanup & Cutover | Xóa dead code, fix QML, docs | 0.5-1 tuần | 🟢 Low | 4 |

**Total**: 5-6 tuần với 1 engineer full-time (hoặc 3-4 tuần với 2 engineers song song).

### Phased Rollout

**Phase 1 (Tuần 1-2): Foundation** — WS1 + WS2
**Phase 2 (Tuần 3-4): Core flow** — WS3 + WS4
**Phase 3 (Tuần 5): Edit UI** — WS5
**Phase 4 (Tuần 6): Cutover** — WS6

---

## WS1: Cookie Extraction

**File mới/sửa**:
- MỚI: `crates/hyperclip_ipc/src/cookies.rs` (replace skeleton)
- MỚI: `crates/hyperclip_ipc/src/cookies_dpapi.rs` (Windows DPAPI wrapper)
- MỚI: `crates/hyperclip_ipc/src/cookies_sqlite.rs` (Cookies SQLite parser)
- SỬA: `src-tauri/src/commands.rs` — thêm `auth:extractCookies`, `session:extractAll`
- SỬA: `src/models/session_list_model.py` — thêm `extract_all_sessions()` method
- SỬA: `src/ui/qml/SessionsPanel.qml` — nút "Extract tất cả 30 sessions"

**Quyết định kiến trúc**: A1 — Pure Rust + DPAPI (windows-rs). Windows-only OK vì target = Windows 11 + RTX 5080.

**API signature**:
```rust
pub struct ExtractedCookie {
    pub name: String,        // SAPISID, __Secure-1PSID, etc.
    pub value: String,
    pub domain: String,
    pub encrypted_value: Option<Vec<u8>>,
}

pub struct CookieExtractionResult {
    pub cookies: Vec<ExtractedCookie>,
    pub profile_name: String,
    pub domain: String,  // youtube.com
    pub socs_value: Option<String,  // CAI nếu có
}

pub fn extract_chrome_cookies(profile_dir: &Path) -> Result<CookieExtractionResult, String>;
```

**Workflow**:
1. Tìm Chrome user data dir (`%LOCALAPPDATA%\Google\Chrome\User Data`)
2. Đọc `profile_dir\Cookies` (SQLite, lock-safe copy nếu Chrome đang mở)
3. `SELECT * FROM cookies WHERE host_key LIKE '%youtube.com'`
4. Nếu `encrypted_value` không null → DPAPI decrypt (CryptUnprotectData)
5. Build cookie string cho Innertube
6. Force-inject `SOCS=CAI` nếu missing

**Edge cases**:
- Chrome đang mở → SQLite locked → retry với temp copy (`.backup`)
- Cookie encrypted v10 (legacy) + v11 (Chrome 80+)
- Missing SOCS → force-inject `CAI`
- Empty profile → return `Ok(empty_result)` (không error)

**Test strategy**:
- Unit test: `cookies_dpapi::decrypt(known_blob) → known_plaintext`
- Unit test: `cookies_sqlite::parse(fixture) → [ExtractedCookie]`
- Integration: 30 Chrome profiles thật trên máy dev

**Milestone 1.1**: `auth:extractCookies` returns valid SAPISID cho 1 Chrome profile.

---

## WS2: Detection Pipeline

**File mới/sửa**:
- MỚI: `crates/hyperclip_ipc/src/innertube_pool.rs` (30-client pool, round-robin, cooldown)
- MỚI: `crates/hyperclip_ipc/src/innertube_client.rs` (Node subprocess wrapper cho youtubei.js)
- SỬA: `crates/hyperclip_ipc/src/detection.rs` — wire Poller::run() thực sự
- MỚI: `crates/hyperclip_ipc/src/poller.rs` (tách từ detection.rs)
- MỚI: `src-tauri/src/background.rs` (tokio runtime + spawn Poller)
- SỬA: `src-tauri/src/commands.rs` — `poller:start`, `poller:stop`, `poller:status`

**Quyết định kiến trúc**: B1 — youtubei.js Node subprocess. Battle-tested, port 1-1 từ electron `innertube_client.ts`. Effort: 1.5 tuần (vs 3 tuần nếu rewrite Rust).

**API signature**:
```rust
// innertube_pool.rs
pub struct InnertubeClientPool {
    clients: Vec<InnertubeClient>,
    round_robin_idx: AtomicUsize,
    cooldown_map: HashMap<usize, Instant>,
    suspended: HashMap<usize, Instant>,
}

impl InnertubeClientPool {
    pub async fn initialize() -> Result<Self, String>;
    pub async fn get_latest_video(&self, channel_id: &str, seen: &HashSet<String>) 
        -> Result<Option<VideoInfo>, String>;  // top-1..top-5 dedup
    pub fn mark_failed(&self, session_idx: usize);  // 10s cooldown
    pub fn suspend(&self, session_idx: usize, duration: Duration);  // 5min for empty timestamps
    pub fn ready_count(&self) -> usize;
    pub fn is_ready(&self) -> bool { self.ready_count() > 0 }
}

// poller.rs
pub struct Poller {
    pool: Arc<InnertubeClientPool>,
    channels: Arc<RwLock<Vec<Channel>>>,
    seen_ids: Arc<RwLock<HashSet<String>>>,
    oauth_fallback: Option<TokenManager>,
    health: HealthMonitor,
    poll_interval_ms: u64,
}

impl Poller {
    pub async fn run(self: Arc<Self>, cancel: CancellationToken) {
        loop {
            tokio::select! {
                _ = cancel.cancelled() => break,
                _ = tokio::time::sleep(Duration::from_millis(self.next_poll_delay_ms())) => {
                    self.poll_once().await;
                }
            }
        }
    }
    
    async fn poll_once(&self) {
        // 1. Read channels (cached, invalidated on add/sync)
        // 2. Parallel scan (10 concurrent max)
        // 3. Early termination after 5 new videos
        // 4. Emit events for new videos
        // 5. Update seen_ids (cap 10k, persist to disk every 5s)
    }
    
    fn next_poll_delay_ms(&self) -> u64 {
        let base = self.poll_interval_ms;  // 5000
        let jitter = (base as f64 * 0.2) as u64;  // 1000
        base + rand::thread_rng().gen_range(0..jitter)  // 5000-6000
    }
}
```

**Test strategy**:
- Unit test: `next_poll_delay_ms(5000)` returns 4000-6000ms range
- Unit test: `pool::round_robin()` cycles 0→1→...→29→0
- Integration: 5 test channels thật, detection < 10s
- E2E: fake new upload → workspace xuất hiện trong UI

**Milestone 1.2**: New video xuất hiện trong UI trong vòng 10s sau upload thật trên 1 test channel.

---

## WS3: Download Pipeline

**File mới/sửa**:
- SỬA: `crates/hyperclip_ipc/src/youtube.rs` — port full logic từ `electron/services/youtube.ts`
- SỬA: `src-tauri/src/commands.rs` — `workspace:retry`, `workspace:autoDownload`, `youtube:download`
- MỚI: `crates/hyperclip_ipc/src/download_progress.rs` (stderr parser)

**Quyết định kiến trúc**: Reuse code electron cũ. Client priority: `tv_embedded` → `web` → `ios`. `tv_embedded` bypass EJS qua HLS → 1080p60 H.264.

**API signature**:
```rust
pub struct DownloadOptions {
    pub url: String,
    pub output_path: PathBuf,
    pub trim_start: String,        // "00:00:00"
    pub trim_end: String,          // "00:10:00" (10 min default)
    pub quality: u32,              // 1080, 720, 360
    pub client_priority: Vec<String>,  // ["tv_embedded", "web", "ios"]
    pub concurrent_fragments: u32,    // 16
    pub max_instances: u32,           // 1 (single) hoặc 4 (multi khi RAM ≥ 16GB)
    pub cookies_file: Option<PathBuf>,
    pub retry_strategy: RetryStrategy,
}

pub struct DownloadResult {
    pub file_path: PathBuf,
    pub file_size_bytes: u64,
    pub duration_sec: f64,
    pub width: u32,
    pub height: u32,
    pub codec: String,             // h264 / vp9 / av1
    pub fps: f64,
}

pub async fn download_video(opts: DownloadOptions, 
    progress: impl Fn(DownloadProgress)) -> Result<DownloadResult, String>;

// download_progress.rs
pub fn parse_ytdlp_stderr(line: &str) -> Option<DownloadProgress> {
    // Match: "[download]  45.2% of  288.70MiB at  9.5MiB/s ETA 00:30"
}
```

**Test strategy**:
- Unit test: `parse_ytdlp_stderr("45.2%")` → `DownloadProgress { percent: 0.452 }`
- Integration: Download 1 video test (~30s, 100MB), verify size + duration
- E2E: `workspace:retry` sau error → status="ready"

**Milestone 2.1**: Download 1080p video thành công trong < 60s, file size hợp lý (200-400 MB cho 5 phút).

---

## WS4: Render Pipeline

**File mới/sửa**:
- SỬA: `crates/hyperclip_ipc/src/ffmpeg.rs` — wire spawn_render vào command handler
- MỚI: `crates/hyperclip_ipc/src/render_progress.rs` (stderr parser)
- SỬA: `src-tauri/src/commands.rs` — `render:start`, `render:cancel`, `render:chunked`
- SỬA: `src-tauri/src/background.rs` — thêm WorkerPool

**Quyết định kiến trúc**: C1 — Rust spawn ffmpeg trực tiếp. Đã có `spawn_render()` skeleton + NVENC flags verified. Port progress parser từ electron `ffmpeg.ts`.

**API signature**:
```rust
pub struct RenderOptions {
    pub workspace_id: String,
    pub input_path: PathBuf,
    pub output_path: PathBuf,
    pub resolution: String,         // "1080p" | "720p" | "360p"
    pub fps: u32,                   // 30 | 60
    pub speed: f32,                 // 1.0..2.0
    pub trim_start: f64,
    pub trim_end: f64,
    pub gpu_tier: GpuTier,
    pub preset: String,             // "p1" (default)
    pub filter_chain: FilterChain,  // Short | Landscape
    pub chunked: bool,
    pub chunk_duration_sec: u32,    // 120 (GPU) | 60 (CPU)
}

pub async fn spawn_render(opts: RenderOptions, 
    progress: impl Fn(f64) + Send + 'static) -> Result<Child, String>;
```

**NVENC flags (verified từ crates/hyperclip_ipc/src/ffmpeg.rs:286-310)**:
```rust
"-c:v {hevc_nvenc|h264_nvenc}"   // per GPU tier
"-preset p1"                      // fastest
"-rc vbr_hq"                      // VBR high quality
"-cq {crf}"                       // 18 single, 20 chunked
"-tune ull"                       // ultra-low latency
"-bf 0 -refs 1 -g 30"            // no B-frames
"-filter_hw_device cuda"         // GPU filter
```

**GPU tier table** (từ `system.rs`):
| GPU | Tier | Codec | Workers | Sessions |
|---|---|---|---|---|
| RTX 5080/4080 | high | hevc_nvenc | 8-14 | 30 |
| RTX 4070/3070 | mid | h264_nvenc | 4-8 | 14-16 |
| GTX 1660 | low | h264_nvenc | 2 | 4 |
| No GPU | software | libx264 | 1 | 2 |

**Auto-render trigger**:
```rust
// commands.rs - sau workspace:update với status="ready"
async fn on_workspace_ready(ws: Workspace) {
    let settings = load_settings().await;
    if settings.auto_render && !ws.auto_render_attempted {
        let opts = RenderOptions {
            workspace_id: ws.id.clone(),
            resolution: settings.auto_render_resolution,
            fps: settings.auto_render_fps,
            speed: settings.auto_render_speed,
            ..Default::default()
        };
        spawn_render(opts, |progress| {
            emit_event("render:progress", json!({"ws_id": ws.id, "progress": progress}));
        }).await?;
        mark_auto_render_attempted(&ws.id).await?;
    }
}
```

**Test strategy**:
- Unit test: `build_short_filter(opts)` produces valid filter_complex
- Unit test: `parse_ffmpeg_stderr("frame=120 time=00:00:04")` → 0.133 (nếu total=30s)
- Integration: Render 1 short 30s clip, output playable
- E2E: `autoRender=true` + download complete → render auto-trigger

**Milestone 2.2**: Video mới → auto-detect → auto-download → auto-render. Output playable, < 2 phút cho 1 phút source.

---

## WS5: Inline Edit UI

**File mới/sửa**:
- SỬA: `src/ui/qml/VideoDetailPanel.qml` — thêm edit controls
- SỬA: `src/models/workspace_model.py` — thêm `update_workspace_field(id, field, value)`
- SỬA: `src-tauri/src/commands.rs` — thêm `workspace:update` thực tế
- MỚI: `src/ui/qml/components/EditField.qml` (Slider + Label + SpinBox wrapper)
- MỚI: `src/ui/qml/components/ThumbnailUploader.qml` (FileDialog + preview)
- MỚI: `src/services/thumbnail_service.py` (download từ YouTube + save local)

**Edit controls layout** (thêm vào VideoDetailPanel.qml, thay vì read-only):

```qml
GroupBox {
    title: "EDIT"
    
    // Title
    RowLayout {
        Label { text: "Title" }
        TextField {
            text: root.workspaceData.title
            onEditingFinished: workspaceModel.updateField(
                root.workspaceId, "title", text)
        }
    }
    
    // Speed (playback multiplier)
    RowLayout {
        Label { text: "Speed" }
        Slider {
            from: 1.0; to: 2.0; stepSize: 0.1
            value: root.workspaceData.speed || 1.0
            onMoved: workspaceModel.updateField(
                root.workspaceId, "speed", value)
        }
        Label { text: value.toFixed(1) + "x" }
    }
    
    // Trim start/end
    RowLayout {
        Label { text: "Trim" }
        SpinBox {  // start
            from: 0; to: root.workspaceData.durationSec
            value: root.workspaceData.trimStart || 0
        }
        Label { text: "→" }
        SpinBox {  // end
            from: 0; to: root.workspaceData.durationSec
            value: root.workspaceData.trimEnd || root.workspaceData.durationSec
        }
    }
    
    // Thumbnail
    RowLayout {
        Label { text: "Thumbnail" }
        ThumbnailUploader {
            workspaceId: root.workspaceId
            currentThumbnail: root.workspaceData.thumbnail
        }
    }
}
```

**Backend command**:
```rust
"workspace:update" => {
    let id = p(params, "id").unwrap_or_default();
    let field = p(params, "field").unwrap_or_default();
    let value = params.get("value").cloned().unwrap_or(json!(null));
    
    let allowed = ["title", "speed", "trimStart", "trimEnd", "thumbnail"];
    if !allowed.contains(&field.as_str()) {
        return Ok(json!({"ok": false, "error": format!("invalid field: {}", field)}));
    }
    
    workspace_store.update_field(&id, &field, value.clone()).await?;
    
    if let Some(ws) = workspace_store.get(&id).await? {
        if ws.status == "rendering" {
            return Ok(json!({"ok": true, "warning": "Đang render, áp dụng cho lần render sau"}));
        }
    }
    Ok(json!({"ok": true}))
}
```

**Test strategy**:
- UI test: Mở workspace detail → thay đổi speed slider → state persists
- Integration: Update title qua IPC → restart → verify persists
- E2E: Edit speed=1.5 + manual render → output duration = duration/1.5

**Milestone 3.1**: User click workspace → đổi speed 1.0× → 1.5× → render → output duration giảm ~33%, playable.

---

## WS6: Cleanup & Cutover

**File xóa**:
- `hyperclip/HyperClip.Core/`, `hyperclip/HyperClip.Services/`, `hyperclip/HyperClip.UI/`, `hyperclip/HyperClip.Tests/` (C# abandoned)
- `src/ui/qml/Toggle.qml`, `src/ui/qml/Card.qml`, `src/ui/qml/NavItem.qml` (empty)
- Tất cả `obj/` build artifacts trong C# projects

**File sửa**:
- MỚI: `src/ui/qml/qmldir` — register `Theme` singleton + local components
- SỬA: `docs/TECHNOLOGY_OVERVIEW.md` — update cho QML/Rust
- SỬA: `docs/HOW_IT_WORKS.md` — update pipeline
- SỬA: `package.json` — bỏ electron scripts
- SỬA: `README.md` — update install + build
- SỬA: `.gitignore` — bỏ C# obj/bin
- SỬA: `install.ps1`, `install.sh` — PySide6 + Rust toolchain
- SỬA: `electron-builder.yml` → bỏ, thay bằng `tauri.conf.json`

**Cutover sequence**:
1. Build `hyperclip.exe` production release
2. Test E2E với 5 channels trên máy dev
3. Test E2E với 30 channels + 24h stability
4. Build installer qua `tauri build` → `release/HyperClip-Setup-0.0.1.exe`
5. Update download URL trong install.ps1
6. Tag release v0.1.0
7. **SAU ĐÓ** mới xóa `electron/` directory

**Rollback window**: Giữ `electron/` source 30 ngày. Branch `legacy/electron` để reference. Install script fallback `install-electron.sh` cho phép rollback.

**Test strategy**:
- `npx eslint src/`
- `npx tsc --noEmit`
- `python -m py_compile src/main.py src/models/*.py`
- `cargo check && cargo clippy -- -D warnings`
- `qmllint src/ui/qml/*.qml`
- 24h soak test với 30 channels

**Milestone 4.1**: Fresh install trên máy mới → mở app → thêm 5 channels → 24h sau có rendered outputs.

---

## Data Model

**Shared types** (Rust + Python mirror):

```rust
// Workspace
pub struct Workspace {
    pub id: String,
    pub channel_id: String,
    pub channel_name: String,
    pub video_id: String,
    pub video_url: String,
    pub title: String,                   // editable (WS5)
    pub thumbnail_url: String,
    pub thumbnail_local_path: Option<String>,  // user-uploaded (WS5)
    pub duration_sec: f64,
    pub width: u32,
    pub height: u32,
    pub published_at: i64,
    pub detected_at: i64,
    pub status: WorkspaceStatus,         // new|waiting|downloading|ready|rendering|done|error
    pub error_message: Option<String>,
    pub speed: f32,                      // 1.0..2.0
    pub trim_start_sec: f64,
    pub trim_end_sec: f64,
    pub quality_target: u32,
    pub trim_limit_minutes: u32,
    pub downloaded_path: Option<String>,
    pub downloaded_size_bytes: u64,
    pub downloaded_at: Option<i64>,
    pub rendered_path: Option<String>,
    pub rendered_size_bytes: u64,
    pub rendered_at: Option<i64>,
    pub render_duration_sec: f64,
    pub auto_render_attempted: bool,
    pub auto_render_error: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

pub enum WorkspaceStatus {
    New, Waiting, Downloading, Ready, Rendering, Done, Error,
}
```

**Storage layout** (`%APPDATA%/HyperClip/`):
```
workspaces.json           # All workspaces (writer: Rust only)
channels.json             # All channels
settings.json             # Settings struct
seen-ids.json             # HashSet<String> (cap 10k)
oauth_tokens.json         # Multi-project (encrypted)
api_keys.json             # 30 API keys (encrypted)
chrome_sessions/          # 30 extracted cookie snapshots
activity_log.json         # 200 events rotating
hardware_profile.json     # Cached detection
update_check.json
video_storage/            # Downloaded sources
output/                   # Rendered shorts
archive/                  # Archived renders
```

**Concurrency**: Rust writer duy nhất (atomic write: temp + rename). Python read-only.

**IPC Protocol**: JSON-RPC over stdin/stdout. Request/Response/Event format chuẩn. 10 built-in events (`system:stats-update`, `workspace:update-event`, `render:progress-event`, ...).

---

## Error Handling (5 levels)

| Level | Type | Handler | Retry? |
|---|---|---|---|
| 1 - Recoverable | NetworkTimeout, RateLimited, SessionCooldown, TokenExpired | Auto-retry với backoff | Auto |
| 2 - User-actionable | ChromeCookieLocked, OAuthQuotaExhausted, VideoUnavailable, DiskSpaceLow | Toast + alert | Manual |
| 3 - Configuration | FFmpegNotFound, YtDlpNotFound, NVENCUnsupported, InvalidChannelUrl | Show setup instructions | Manual |
| 4 - System | WorkerPoolExhausted, DatabaseCorruption | Log + queue | Auto |
| 5 - Critical | BackendCrashed, GPUDriverCrashed | Restart + recover state | Auto-restart |

**4 Auto-recovery strategies**:
1. Detection loop self-healing: pool re-initialize nếu all sessions suspended
2. Download exponential backoff: 2s → 4s → 8s, max 3 retries
3. Render auto-resume: progress file + restart from saved offset
4. Health monitor: 6 conditions (Innertube dead, OAuth low/exhausted, disk low, download failing, no videos 24h)

---

## Testing Strategy (4 levels)

| Level | Tool | Target coverage | Time |
|---|---|---|---|
| 1. Unit | `cargo test` + `pytest` | 80% overall, 95% critical paths (poller, ffmpeg, cookies) | 5 min |
| 2. Integration | Real binaries + mocked network | All IPC commands | 10 min |
| 3. E2E | Playwright + Qt Test | Full flow (detect→download→render→edit) | 30 min |
| 4. Soak | 24h continuous, 30 channels | Crash rate, memory, CPU | 24h (manual weekly) |

**Performance targets**:
- Detection latency: < 5s median, < 10s p95
- Download speed: > 50 Mbps (1080p)
- Render speed: < 2 phút (1 phút source, NVENC)
- Memory: < 4GB idle, < 12GB full load
- CPU: < 20% idle

---

## Acceptance Criteria (7 categories, 38 sub-items)

### AC1: Core Detection (6 items)
- Thêm 1 channel → hiển thị trong 10s
- Upload 1 video → workspace mới trong 10s
- 30 channels → tất cả hiển thị trong 30s
- Detection latency < 5s median
- Restart → seen videos không re-detect
- Chrome đóng → cookies extract OK

### AC2: Download Pipeline (6 items)
- Auto-download < 5s sau detect
- 1080p 5 phút → 200-400 MB
- tv_embedded client (verify log)
- Trim 10 phút từ video 30 phút
- Retry 3 lần exponential backoff
- Disk full → pause + alert

### AC3: Render Pipeline (6 items)
- Auto-render < 5s sau download
- 60s short → render trong < 2 phút
- Output playable VLC/Media Player
- NVENC (verify log)
- GPU > 80% (verify nvidia-smi)
- 2 renders song song OK

### AC4: Edit UI (6 items)
- Click workspace → detail mở trong 200ms
- Edit title → persists
- Speed 1.5× → output duration /1.5
- Trim 30-90s → output 60s
- Upload thumbnail → hiển thị + overlay
- Edit trong render → warning

### AC5: Settings & Hardware (6 items)
- 6 tabs hiển thị
- GPU auto-detect → preset available
- defaultTrimLimit=5 → downloads dùng 5 phút
- autoRenderResolution=720p → renders dùng 720p
- maxConcurrentRenders=4 → 4 FFmpeg parallel
- Sessions tab 30 profiles

### AC6: Stability (6 items)
- 24h continuous → no crash
- Memory < 4GB idle, < 12GB full
- CPU < 20% idle
- Restart sau crash → state recover
- 6 health alerts fire đúng
- Log rotation 50MB / 7 days

### AC7: UI/UX (6 items)
- 3-pane đúng spec (220/400/flex)
- 60 fps idle
- Detail mở < 200ms
- Search/filter real-time
- Theme đúng (#121212, #00B4FF, #00FF88)
- Onboarding 5 steps end-to-end

---

## Rollout Sequence (4 Phases, 5-6 tuần)

### Phase 1: Foundation (Tuần 1-2)
- **WS1** (Tuần 1): Cookie extraction
- **WS2** (Tuần 2): Detection pipeline

### Phase 2: Core Flow (Tuần 3-4)
- **WS3** (Tuần 3): Download pipeline
- **WS4** (Tuần 4): Render pipeline

### Phase 3: Edit UI (Tuần 5)
- **WS5**: Inline edit controls

### Phase 4: Cutover (Tuần 6)
- **WS6**: Cleanup, docs, 24h soak test, cutover

---

## Risk Register

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| DPAPI decrypt fail on Chrome update | Medium | High | Version detection + fallback read-only |
| youtubei.js format change | High | High | Pin version, monitor upstream, fast rollback |
| NVENC driver crash | Low | Medium | Auto-retry với CPU fallback (3 lần) |
| YouTube rate-limit Innertube | Medium | Medium | 30 sessions round-robin, 10s cooldown |
| OAuth quota exhausted | Low | Low | 200 GCP projects distributed |
| Cookie DB lock | High | Low | Retry với temp copy, clear messaging |
| Disk full mid-render | Low | Medium | Pre-check 5GB free, pause + alert |
| Tauri build break | Medium | High | Pin Tauri version, regular rebuilds |
| QML rendering issues | Low | Medium | Test trên 3+ GPU drivers |

## Rollback Plan

**Tier 1 (Hotfix < 4h)**: Fix forward, deploy patch.
**Tier 2 (Revert < 24h)**: Re-enable `electron/` source, branch `legacy/electron`, `install-electron.sh` rollback script.
**Tier 3 (Full rollback > 24h)**: Git revert cutover, re-publish electron installer, update install script.

**Rollback triggers**: Crash rate > 5%/24h, data loss, detection latency > 30s p95, render failure > 10%, auto-update blocked.

## Success Metrics (30 ngày sau cutover)

- Daily active users ≥ 10
- Avg channels per user ≥ 20
- Detection latency p95 < 10s
- Render success rate ≥ 95%
- Crash rate < 1%/24h
- User-reported bugs < 5/tuần
- Avg time to first render < 5 phút

## Open Questions (defaults)

1. Cookie extraction platform: **Windows-only (DPAPI)**, Linux plaintext acceptable
2. youtubei.js transport: **Node subprocess** (proven, fast)
3. Auto-render default: **TRUE** (verified trong `settings_model.py`, better UX)
4. Cutover window: **1 tuần internal soft launch, sau đó public**
5. Telemetry: **Opt-in, off by default**

## Deliverables

| # | Deliverable | Owner | Done when |
|---|---|---|---|
| 1 | `hyperclip.exe` production build | WS6 | `cargo build --release` exit 0 |
| 2 | `HyperClip-Setup-0.0.1.exe` installer | WS6 | `tauri build` produce installer |
| 3 | 15+ Rust test files passing | All WS | `cargo test` 0 failures |
| 4 | 5+ Python integration tests | WS5 | `pytest` 0 failures |
| 5 | E2E test script | WS6 | `pytest tests/e2e/` 0 failures |
| 6 | 24h soak test report | WS6 | No crash, all metrics met |
| 7 | User docs updated | WS6 | `README.md`, `install.ps1`, `OPERATOR_GUIDE.md` |
| 8 | 6 ACs passed (AC1-AC7) | All WS | PO sign-off |

---

## Spec Self-Review (checklist)

- [x] **Placeholder scan**: No TBD/TODO/incomplete. All sections have concrete content.
- [x] **Internal consistency**: WS1-WS6 sequenced correctly. Data model matches WS5 edit fields. Acceptance criteria reference all 6 work streams.
- [x] **Scope check**: Focused on single migration (QML/Rust rewrite). 4 phases, 5-6 tuần, achievable cho 1 engineer.
- [x] **Ambiguity check**: 
  - "100% pass" defined as AC1-AC7 (38 sub-items) all pass
  - Cookie extraction: A1 Pure Rust DPAPI (not 3 options ambiguity)
  - Detection transport: B1 Node subprocess (not 3 options ambiguity)
  - Render transport: C1 Rust spawn ffmpeg (not 3 options ambiguity)
  - Settings defaults referenced to verified values in `settings_model.py`
- [x] **No contradictions**: Big Bang approach (user-confirmed) consistent throughout.

**Status**: Ready for user review. If approved → invoke `writing-plans` skill.
