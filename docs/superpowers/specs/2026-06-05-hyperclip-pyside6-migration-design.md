# HyperClip Migration: Electron → PySide6 + Rust (Option B)

> **Design doc — v1.0 — 2026-06-05**
> Source of truth: `HYPERCLIP_RULES.md`

---

## Nguyên tắc cốt lõi

1. **Tối đa bắt video**: 100% detection, < 20s latency, 24/7
2. **Tối đa hiệu suất render**: FFmpeg + NVENC tối ưu cho RTX 5080 / 3060 / 4050 Laptop
3. **UI mượt**: Không cần đẹp, chỉ cần 60fps, zero lag — signal/slot in-process thay IPC

---

## 1. Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Python / PySide6                    │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────┐  │
│  │  QML UI     │  │ Rust Client  │  │ QMediaPlayer│  │
│  │  (3-pane)   │←→│ (subprocess) │  │ (video)     │  │
│  └──────┬──────┘  └──────┬───────┘  └─────────────┘  │
│         │                 │                           │
│    Qt Signal/Slot    stdin/stdout                     │
│    (in-process)        JSON-RPC                       │
└─────────┼─────────────────────────────────────────────┘
          │ subprocess spawn
          ↓
┌─────────────────────────────────────────────────────┐
│                   Rust Backend                        │
│  hyperclip-core  │  hyperclip-store  │  hyperclip-ipc │
│  ─────────────────────────────────────────────────  │
│  Innertube pool (30 sessions)                        │
│  yt-dlp spawn / FFmpeg spawn / cookie extraction     │
│  worker-pool (GPU-aware) / system stats              │
└─────────────────────────────────────────────────────┘
```

**Điểm khác biệt với Electron:**

| Electron | PySide6 + Rust |
|----------|---------------|
| 3 process (main/renderer/preload) | 1 Python + 1 Rust subprocess |
| V8 serialization qua IPC | Qt signal/slot in-process (zero overhead) |
| VDOM diff + React reconciliation | QML imperative rendering |
| Chromium WebView for video | QMediaPlayer native (no WebView) |

---

## 2. Backend — Rust (preserve 100% existing logic)

### 2.1 Crate layout (từ `migrate` branch)

```
src-tauri/
  Cargo.toml
  crates/
    hyperclip-core/      — workspace, channel, detection, download, render
    hyperclip-store/     — JSON persistence
    hyperclip-ipc/       — IPC types + stdout JSON-RPC protocol
  src/
    main.rs              — Tauri entry (giữ nguyên, gỡ Tauri commands)
    commands/            — Tauri IPC handlers → chuyển thành JSON-RPC
```

### 2.2 JSON-RPC Protocol (Rust → Python stdout)

Rust backend emit events trên stdout, Python đọc line-by-line:

```rust
// Rust: stdout JSON-RPC event
serde_json::to_string(&json!{
    "jsonrpc": "2.0",
    "method": "workspace:update",
    "params": { "id": "ws-123", "status": "rendering", "progress": 45 }
}).and_then(|s| io::stdout().write_all(format!("{}\n", s).as_bytes()));

// Python: event loop
for line in subprocess.stdout:
    event = json.loads(line)
    EventBus.emit(event['method'], event['params'])
```

**Commands (Python → Rust):**

```rust
// Rust: stdin command handler
match command {
    "workspace:list"   => workspaces::list(),
    "workspace:update" => workspaces::update(params),
    "render:start"     => render::start(params),
    "system:stats"     => system::stats(),
    "poller:status"    => poller::status(),
    "channel:add"      => channel::add(params),
    // ... all existing IPC channels preserved
}
```

### 2.3 Preserve existing services unchanged

| Service | Port sang Rust | Chú ý |
|---------|----------------|-------|
| `innertube_client.ts` → `innertube.rs` | 70% TypeScript → Rust | youtubei.js vẫn là JS, gọi qua `node youtubei.js` spawn |
| `subscription_feed.ts` → `subscription.rs` | 80% reuse | Keep same logic |
| `youtube.ts` (yt-dlp) → `youtube.rs` | 90% reuse | yt-dlp spawn, same flags |
| `ffmpeg.ts` → `ffmpeg.rs` | 80% reuse | Same filter chain, NVENC params |
| `chrome_cookies.ts` → `cookies.rs` | 60% reuse | DPAPI → platform adapter trait |
| `system.ts` → `system.rs` | 90% reuse | GPU detection, RAM, workers |
| `health_alerts.ts` → `health.rs` | 100% reuse | Same 6 conditions |
| `store.ts` → `hyperclip-store/` | 100% | Same JSON format |

### 2.4 youtubei.js integration

youtubei.js vẫn là JavaScript — gọi qua Node.js subprocess. Giữ nguyên TypeScript source từ `innertube_client.ts`, không rewrite.

```rust
// Rust: spawn TypeScript via ts-node
pub fn get_latest_video(channel_id: &str, cookies_path: &str) -> Result<Video, Error> {
    // Gọi TypeScript trực tiếp — giữ nguyên source
    let output = Command::new("npx")
        .args(["ts-node", "electron/services/innertube_client.ts", channel_id, cookies_path])
        .output()?;
    serde_json::from_str(&output.stdout)
}
```

PyInstaller bundle: `npx` + `node_modules/youtubei.js` + TypeScript source → đóng vào binary.

---

## 3. GPU Tier System — MAX PERFORMANCE per card

### 3.1 Hardware Tiers

Từ `system.ts` NVENC_ARCH table, viết lại trong Rust:

```rust
// GPU config per architecture — bắt buộc giữ nguyên logic
pub struct GPUConfig {
    pub max_sessions: u32,        // NVENC concurrent sessions
    pub surface_count: u32,         // surface pool size
    pub max_workers: u32,           // FFmpeg worker count
    pub decode_preset: DecodePreset,
    pub encode_preset: EncodePreset,
    pub tier: GPUTier,
}

pub enum GPUTier { High, Mid, Low, Software }

impl GPUConfig {
    pub fn from_name(name: &str) -> Self { /* same lookup table as system.ts */ }
}
```

### 3.2 GPU Config Table

| GPU | Sessions | Surface | Workers | Preset | Tier |
|-----|---------|---------|---------|--------|------|
| **RTX 5080** | 14 | 64 | 16 | `p1` | HIGH |
| **RTX 3060** | 14 | 16 | 4 | `p2` | MID |
| **RTX 4050 Laptop** | 6 | 16 | 4 | `p2` | MID |
| Software fallback | 2 | 8 | 2 | `medium` | LOW |

### 3.3 RAM-Aware Worker Scaling

Từ `HYPERCLIP_RULES.md`:

| RAM | yt-dlp instances | FFmpeg workers | Chunk duration |
|-----|-----------------|---------------|---------------|
| < 8 GB | 1 | 1 | 60s |
| 8-16 GB | 2 | 2 | 90s |
| 16-32 GB | 3 | 4 | 120s |
| 32-64 GB | 4 | 8 | 120s |
| > 64 GB | 4 | 16 | 120s |

RTX 5080 + 64GB RAM: workers=16, sessions=14 → dùng 14 sessions (giới hạn bởi NVENC, không phải workers)

### 3.4 Render Pipeline — same FFmpeg flags

Filter chain giữ nguyên từ `ffmpeg.ts`:

```
fps=30 → setpts=PTS-STARTPTS → trim → scale → crop
```

**NVENC params per tier:**

| Tier | Codec | Preset | CRF | Lookahead | Refs | B-frames |
|------|-------|--------|-----|-----------|------|---------|
| HIGH (5080) | `hevc_nvenc` | `p1` | 18 | 0 | 1 | 0 |
| MID (3060/4050) | `hevc_nvenc` | `p2` | 20 | 0 | 1 | 0 |
| LOW | `h264_nvenc` | `p3` | 22 | 0 | 1 | 0 |
| Software | `libx264` | `medium` | 23 | — | 1 | 0 |

**Decode:** `hevc_cuvid`/`h264_cuvid` cho NVDEC — không dùng `-hwaccel cuda`

**CRF by quality:**
- 360p → 22 (H.264) / 26 (HEVC)
- 720p → 20 (H.264) / 24 (HEVC)
- 1080p → 18 (H.264) / 20 (HEVC)

---

## 4. Frontend — PySide6 / QML

### 4.1 Không dùng WebView

- Electron dùng Chromium (Next.js render) → PySide6 dùng **QML native controls**
- Video preview: **QMediaPlayer** (Qt Multimedia) — bắt tay ffmpeg/libav của hệ thống
- Không cần Qt WebEngine → PyInstaller đơn giản hơn, binary nhỏ hơn

### 4.2 QML Layout (3-pane, giữ nguyên từ Electron)

```qml
// main.qml — 3-pane layout
Rectangle {
    width: 1920; height: 1080; color: "#121212"

    RowLayout {
        spacing: 0
        anchors.fill: parent

        // Sidebar (220px)
        Sidebar { Layout.preferredWidth: 220; Layout.fillHeight: true }

        // Center (flex-1) — Queue
        WorkspaceQueue { Layout.fillWidth: true; Layout.fillHeight: true }

        // Right (400px) — Editor
        DetailEditor { Layout.preferredWidth: 400; Layout.fillHeight: true }
    }

    // System Monitor — bottom-left overlay
    SystemMonitor { anchors.left: parent.left; anchors.bottom: parent.bottom }
}
```

### 4.3 Flat design — NO decorations

```qml
// Theme — giữ nguyên màu từ HYPERCLIP_RULES.md
QtObject {
    readonly property color bg: "#121212"
    readonly property color accent: "#00B4FF"
    readonly property color success: "#00FF88"
    readonly property color text: "#FFFFFF"
    readonly property color textMuted: "#888888"
}
```

- **KHÔNG shadows, KHÔNG gradients, KHÔNG decorative UI**
- `flat: true` trên mọi control
- Font: system default (Inter fallback trên Windows)

### 4.4 Models — QAbstractListModel

```python
# models/workspace_model.py
from PySide6.QtCore import QAbstractListModel, Signal, QModelIndex, Qt

class WorkspaceModel(QAbstractListModel):
    # Signal/slot thay Zustand
    progressUpdated = Signal(str, int)  # (workspace_id, progress)
    statusChanged = Signal(str, str)    # (workspace_id, status)

    def data(self, index, role=Qt.DisplayRole):
        # Chỉ update row thay đổi — không re-render toàn bộ list
        pass

    def updateWorkspace(self, ws_id: str, data: dict):
        # emit dataChanged.emit(index, index, [role])
        pass
```

**So với Zustand (Electron):**

| Zustand (Electron) | QAbstractListModel (PySide6) |
|--------------------|------------------------------|
| `useAppStore.set()` → React re-render | `dataChanged.emit()` → QML row update |
| Flat state, no context cascade | One model per list, min DOM updates |
| 60+ components re-render on state change | Only affected QML Row re-renders |

### 4.5 Video Player — QMediaPlayer

```python
# services/video_player.py
from PySide6.QtMultimedia import QMediaPlayer, QAudioOutput
from PySide6.QtCore import QUrl

class VideoPlayer:
    def __init__(self, video_widget: QVideoWidget):
        self.player = QMediaPlayer()
        self.player.setVideoOutput(video_widget)
        # Seek ±5s = arrow keys
        # Space = play/pause
        # Timeline click-to-seek

    def load(self, path: str):
        # Path: relative filename → prepend storage path
        abs_path = get_video_storage_path(path)
        self.player.setSource(QUrl.fromLocalFile(abs_path))
```

### 4.6 Timeline scrubbing (DetailEditor)

```python
# Timeline widget — QML Canvas hoặc QSlider + overlay
class TimelineEditor(QQuickPaintedItem):
    # MouseArea click → seek
    # Space → play/pause
    # Left/Right arrow → ±5s
    # Wheel → ±1s
    # Visual: blur thumbnail + bottom bar overlay + video region
```

---

## 5. Detection Pipeline — giữ nguyên 100%

### 5.1 Detection chain (không thay đổi)

```
YouTubePoller (5s ± 20% jitter)
         ↓
fetchSubscriptionFeed() → ALL channels (parallel, max 10 concurrent)
         ↓
1. Innertube (youtubei.js) — PRIMARY, NO QUOTA
   → getLatestVideo: top-1..top-5, seen dedup, publishedAt=0 → skip
   → 30 Chrome sessions round-robin
         ↓ (all sessions fail)
2. OAuth Data API v3 — FALLBACK (TokenManager)
         ↓
Filter: age ≤ 10 min, unseen, not deleted
         ↓
autoDownload() → yt-dlp --download-sections (N phút, tv_embedded client)
         ↓
autoRender() (opt-in) → FFmpeg + NVENC
```

### 5.2 Chrome Cookie Extraction — Platform Adapter

```rust
// cookies.rs — platform adapter trait
pub trait CookieExtractor {
    fn extract(&self, profile_path: &Path) -> Result<CookieJar, Error>;
}

struct WindowsCookieExtractor { }  // DPAPI + sql.js (giữ nguyên)
struct MacOSCookieExtractor { }    // Keychain via security CLI
struct LinuxCookieExtractor { }   // libsecret / pass

impl CookieExtractor for WindowsCookieExtractor {
    fn extract(&self, path: &Path) -> Result<CookieJar> {
        // Same code as chrome_cookies.ts (TypeScript → Rust port)
        // DPAPIUnprotectData + sql.js query
    }
}
```

### 5.3 SOCS=CAI — auto-injected ở 4 places (giữ nguyên)

Cookie string build: `SOCS=CAI` force-inject khi extract từ Chrome.

---

## 6. Settings — Hardware Presets

### 6.1 Render Preset Detection

```python
# backend/client.py — query GPU on startup
stats = backend.command("system:stats")
gpu_tier = stats['gpuTier']  # 'high' | 'mid' | 'low' | 'software'
workers = stats['maxChunkWorkers']
ram_total = stats['ramTotal']

# Auto-select render preset
if gpu_tier == 'high':
    preset = 'p1'      # RTX 5080
elif gpu_tier == 'mid':
    preset = 'p2'      # RTX 3060, 4050 Laptop
else:
    preset = 'p3'      # Software fallback
```

### 6.2 RAM Disk — auto-config

```python
# Same as ramdisk.ts logic
def get_ramdisk_size() -> int:
    total = psutil.virtual_memory().total
    if total < 8 * GB:  return 0     # No RAM disk
    if total < 16 * GB: return 2 * GB
    if total < 32 * GB: return 4 * GB
    if total < 64 * GB: return 8 * GB
    return 16 * GB
```

### 6.3 Worker Pool — GPU-aware

```python
# worker_pool.py — Rust backend quản lý
# Python chỉ gọi render:start / render:cancel
# Rust tự调度 workers dựa trên GPU tier + RAM
```

---

## 7. UI Fluency — Signal/Slot thay IPC

### 7.1 Event Bus (Python)

```python
# backend/events.py
from PySide6.QtCore import QObject, Signal

class EventBus(QObject):
    # Backend → UI
    workspaceUpdated = Signal(dict)      # workspace data dict
    renderProgress = Signal(str, float)  # workspace_id, progress 0-100
    systemStatsUpdated = Signal(dict)     # periodic 5s
    notification = Signal(str, str)       # title, message
    newVideoDetected = Signal(dict)      # channel_id, video info
    pollerStatusChanged = Signal(dict)   # active, channel_count, errors

    # UI → Backend
    def sendCommand(self, channel: str, params: dict = None):
        # write to Rust stdin, read response from stdout
        pass
```

### 7.2 Performance target

| Action | Electron (Next.js) | PySide6 + Rust |
|--------|-------------------|---------------|
| Workspace status update | 50-200ms (IPC + VDOM) | < 1ms (signal/slot) |
| Render progress update | 50-100ms (IPC) | < 1ms (signal/slot) |
| System stats refresh | 50ms (IPC) | < 1ms (signal/slot) |
| New video notification | 50-200ms (IPC + React) | < 1ms (signal/slot) |
| Video seek (QMediaPlayer) | N/A (no native player) | < 5ms (native) |
| Queue list update (1 row) | 50-100ms (React diff) | < 1ms (dataChanged) |

### 7.3 5-second polling không block UI

```python
# Backend subprocess chạy poller trong thread riêng
# Python QML UI chạy main thread — NEVER block
# Event bus đẩy data qua signal → UI tự update

# QML:
Connections {
    target: eventBus
    function onRenderProgress(wsId, progress) {
        progressBars[wsId] = progress  // Direct QML property update
    }
}
```

---

## 8. Cross-Platform Strategy

### 8.1 Platform-specific code paths

| Feature | Windows | macOS | Linux |
|---------|---------|-------|-------|
| Chrome cookie | DPAPI + sql.js | Keychain (`security` CLI) | libsecret |
| GPU detection | `nvidia-smi` | `nvidia-smi` | `nvidia-smi` / VAAPI |
| FFmpeg | `ffmpeg.exe` (scoop/path) | `ffmpeg` (brew/path) | `ffmpeg` (apt/path) |
| RAM disk | `imdisk` / PS script | `diskutil` | `tmpfs` mount |
| NVENC | `h264_nvenc`/`hevc_nvenc` | same | same |
| NVDEC | `hevc_cuvid`/`h264_cuvid` | same | same |

### 8.2 Platform adapter pattern

```rust
// backend/platform.rs
pub fn get_platform() -> Platform {
    #[cfg(target_os = "windows")] return Platform::Windows;
    #[cfg(target_os = "macos")]   return Platform::MacOS;
    #[cfg(target_os = "linux")]   return Platform::Linux;
}

// Chrome cookies — platform-specific extraction
pub trait ChromeCookieExtractor {
    fn extract(&self, profile_dir: &Path) -> Result<CookieJar>;
}

// Settings — per-platform paths
pub fn app_data_dir() -> PathBuf {
    match get_platform() {
        Platform::Windows => dirs::data_dir().join("HyperClip"),
        Platform::MacOS   => dirs::home_dir().join("Library/Application Support/HyperClip"),
        Platform::Linux   => dirs::config_dir().join("hyperclip"),
    }
}
```

---

## 9. Packaging

### 9.1 Build tools

| OS | Bundler | Output |
|----|---------|--------|
| Windows | PyInstaller + Cargo | `.exe` (NSIS/InnoSetup) |
| macOS | PyInstaller + Cargo + `macdeployqt` | `.dmg` / `.app` |
| Linux | PyInstaller + Cargo + `linuxdeployqt` | `.AppImage` |

### 9.2 Binary size estimate

| Component | Size |
|-----------|------|
| Python 3.12 embeddable + PySide6 | 80-120 MB |
| hyperclip-core (Rust) | 5-15 MB |
| FFmpeg static | 100-120 MB |
| yt-dlp | 10 MB |
| youtubei.js + Node.js bundled | 30-50 MB |
| **Total** | **~225-315 MB** |

So Electron: Electron ~150-200MB (Chromium ~100MB). PyInstaller overhead ~30-50MB nhưng bỏ Chromium → cùng range.

### 9.3 PyInstaller spec

```python
# build/hyperclip.spec
a = Analysis(
    ['src/main.py'],
    hiddenimports=[
        'PySide6.QtCore', 'PySide6.QtGui', 'PySide6.QtQml',
        'PySide6.QtMultimedia', 'PySide6.QtNetwork',
        'js2py', 'youtubei',  # JS runtime
    ],
    datas=[
        ('src/ui/qml/**/*.qml', 'qml/'),
        ('src-tauri/target/release/hyperclip-backend.exe', '.'),
        ('ffmpeg.exe', '.'),
        ('yt-dlp.exe', '.'),
    ],
)
```

---

## 10. Migration Phases

### Phase 1: Scaffold (1-2 ngày)
- [ ] Create `src/main.py` — PySide6 + QML engine bootstrap
- [ ] Create `src/backend/client.py` — Rust subprocess spawn + JSON-RPC
- [ ] Create `src/backend/events.py` — Qt EventBus signal/slot
- [ ] Copy Rust scaffolding từ `migrate` branch
- [ ] Minimal QML layout (3-pane, flat, #121212 bg)

### Phase 2: Backend Port (3-4 ngày)
- [ ] Port `system.rs` — GPU detection, RAM, tier (giữ nguyên lookup table)
- [ ] Port `ffmpeg.rs` — filter chain, NVENC params (giữ nguyên logic)
- [ ] Port `youtube.rs` — yt-dlp spawn (giữ nguyên flags)
- [ ] Port `cookies.rs` — DPAPI extraction (giữ nguyên)
- [ ] Port `innertube.rs` — youtubei.js spawn
- [ ] Port `subscription.rs` — detection loop
- [ ] Port `store.rs` → `hyperclip-store/`
- [ ] JSON-RPC protocol: stdout events + stdin commands

### Phase 3: UI Binding (2-3 ngày)
- [ ] WorkspaceModel (QAbstractListModel) — list + update
- [ ] ChannelModel (QAbstractListModel)
- [ ] Sidebar.qml — nav + system monitor
- [ ] WorkspaceQueue.qml — list view
- [ ] WorkspaceCard.qml — individual card
- [ ] DetailEditor.qml — trim, speed, background, overlay
- [ ] QMediaPlayer video preview
- [ ] Timeline scrubbing widget

### Phase 4: Polish + Settings (1-2 ngày)
- [ ] Settings page — OAuth, keys, channels, Chrome sessions
- [ ] System monitor — GPU temp, RAM, worker status
- [ ] Render queue — floating bar
- [ ] Notification toasts

### Phase 5: Packaging (1-2 ngày)
- [ ] PyInstaller spec + build script
- [ ] Windows .exe installer test
- [ ] macOS .dmg test
- [ ] Linux .AppImage test

---

## 11. Non-Goals (KHÔNG làm)

- Beautiful UI — flat, functional only
- WebView / Qt WebEngine — QMediaPlayer native
- Rewrite youtubei.js — vẫn là JavaScript
- Rewrite FFmpeg filter chain — giữ nguyên logic từ ffmpeg.ts
- Rewrite detection pipeline — giữ nguyên 100% từ HYPERCLIP_RULES.md
- Rewrite GPU tier lookup table — giữ nguyên từ system.ts

---

## 12. Success Criteria

| Metric | Target |
|--------|--------|
| Video detection latency | < 20s (từ upload → notification) |
| UI response (workspace update) | < 1ms (signal/slot) |
| Video seek | < 5ms (native) |
| Render queue update | < 1ms |
| Detection accuracy | 100% (giữ nguyên Electron) |
| GPU utilization (RTX 5080) | 14 concurrent sessions |
| GPU utilization (RTX 3060) | 14 sessions, 4 workers |
| GPU utilization (RTX 4050 Laptop) | 6 sessions, 4 workers |
| Binary size | ~250MB (Windows .exe) |
| Cross-platform | Windows + macOS + Linux |
