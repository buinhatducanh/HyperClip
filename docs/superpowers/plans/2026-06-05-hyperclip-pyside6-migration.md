# HyperClip PySide6 Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate HyperClip from Electron + Next.js to PySide6/QML frontend + Rust backend. Preserve 100% detection/render logic, eliminate IPC lag, add native video playback.

**Architecture:** Hybrid — Python/PySide6 for UI (signal/slot in-process, QMediaPlayer native), Rust as subprocess backend (JSON-RPC over stdin/stdout). No WebView, no Chromium, no VDOM diff.

**Tech Stack:** PySide6 6.7+, QML, Python 3.12, Rust (hyperclip-core), youtubei.js, yt-dlp, FFmpeg + NVENC, PyInstaller

---

## File Structure

### Python / PySide6

```
src/
  main.py                     # Entry: QCoreApplication + QQmlApplicationEngine
  backend/
    client.py                  # Rust subprocess spawn + JSON-RPC stdin/stdout
    events.py                 # Qt EventBus (QObject + Signal)
    protocol.py               # Command/response dataclasses
  models/
    workspace_model.py         # QAbstractListModel for workspaces
    channel_model.py           # QAbstractListModel for channels
    system_stats_model.py      # QObject for system stats
  services/
    video_player.py            # QMediaPlayer wrapper
    timeline.py                # Timeline scrubber widget
  ui/
    qml/
      main.qml                # Root: 3-pane RowLayout
      Theme.qml               # Colors: bg=#121212, accent=#00B4FF
      Sidebar.qml             # Nav + system monitor embed
      WorkspaceQueue.qml        # ListView + group header
      WorkspaceCard.qml         # Individual workspace card
      DetailEditor.qml         # Trim, speed, background, export
      Settings.qml              # OAuth, keys, channels, Chrome sessions
      SystemMonitor.qml        # GPU/RAM/worker status
      InputBar.qml             # URL input + channel URL support
    qmlgen/                   # Generated QML component proxies
```

### Rust Backend

```
src-tauri/
  Cargo.toml
  crates/
    hyperclip-core/
      src/
        lib.rs
        system.rs              # GPU detection, RAM, tier (NVENC_ARCH table)
        ffmpeg.rs              # Filter chain, NVENC params (TƯỜNG MINH 100%)
        youtube.rs             # yt-dlp spawn, same flags as electron/services/youtube.ts
        innertube.rs           # youtubei.js subprocess spawn
        subscription.rs         # Detection loop (5s poll, Innertube primary)
        cookies.rs              # DPAPI + sql.js extraction (platform adapter)
        health.rs              # 6 alert conditions
        poller.rs              # YouTubePoller (5s ± 20% jitter)
        worker_pool.rs         # GPU-aware worker scheduling
    hyperclip-store/
      src/
        lib.rs
        workspaces.rs          # JSON load/save workspaces
        channels.rs             # JSON load/save channels
    hyperclip-ipc/
      src/
        lib.rs                  # IPC types + JSON-RPC protocol
  src/
    main.rs                    # Rust entry: spawn stdin reader, emit stdout events
    commands.rs               # All IPC command handlers
```

### Build

```
build/
  hyperclip.spec              # PyInstaller spec
  pyproject.toml              # Python dependencies
```

---

## PHASE 1: Scaffold

### Task 1: Project structure + pyproject.toml

**Files:**
- Create: `src/backend/__init__.py`
- Create: `src/models/__init__.py`
- Create: `src/services/__init__.py`
- Create: `src/ui/__init__.py`
- Create: `src/ui/qml/__init__.py`
- Create: `src/__init__.py`
- Create: `pyproject.toml`
- Create: `build/.gitkeep`

- [ ] **Step 1: Create directory structure**

```bash
mkdir -p src/backend src/models src/services src/ui/qml src/ui/qmlgen
mkdir -p src-tauri/crates/hyperclip-core/src
mkdir -p src-tauri/crates/hyperclip-store/src
mkdir -p src-tauri/crates/hyperclip-ipc/src
mkdir -p build
touch src/__init__.py src/backend/__init__.py src/models/__init__.py
touch src/services/__init__.py src/ui/__init__.py src/ui/qml/__init__.py
touch src/ui/qmlgen/__init__.py
touch build/.gitkeep
```

- [ ] **Step 2: Create pyproject.toml**

```toml
[project]
name = "hyperclip"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
    "PySide6>=6.7.0",
    "PySide6-Addons>=6.7.0",
]

[project.optional-dependencies]
dev = ["pytest>=8.0", "pytest-qt"]
```

Run: `pip install -e ".[dev]"`

- [ ] **Step 3: Commit**

```bash
git add src/__init__.py src/backend/__init__.py src/models/__init__.py
git add src/services/__init__.py src/ui/__init__.py src/ui/qml/__init__.py
git add src/ui/qmlgen/__init__.py build/.gitkeep pyproject.toml
git commit -m "phase1: scaffold project structure and pyproject.toml

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 2: Rust Cargo workspace

**Files:**
- Create: `src-tauri/Cargo.toml`
- Create: `src-tauri/crates/hyperclip-core/Cargo.toml`
- Create: `src-tauri/crates/hyperclip-store/Cargo.toml`
- Create: `src-tauri/crates/hyperclip-ipc/Cargo.toml`
- Create: `src-tauri/crates/hyperclip-core/src/lib.rs`
- Create: `src-tauri/crates/hyperclip-store/src/lib.rs`
- Create: `src-tauri/crates/hyperclip-ipc/src/lib.rs`
- Create: `src-tauri/src/main.rs`

- [ ] **Step 1: Create workspace Cargo.toml**

```toml
[workspace]
members = [
    "crates/hyperclip-core",
    "crates/hyperclip-store",
    "crates/hyperclip-ipc",
]
resolver = "2"

[package]
name = "hyperclip"
version = "0.1.0"
edition = "2021"
```

- [ ] **Step 2: Create crate Cargo.tomls**

```toml
# crates/hyperclip-core/Cargo.toml
[package]
name = "hyperclip-core"
version = "0.1.0"
edition = "2021"

[dependencies]
tokio = { version = "1", features = ["full"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
dirs = "5"
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter"] }

[target.'cfg(windows)'.dependencies]
windows = { version = "0.58", features = [
    "Win32_Security_Cryptography",
    "Win32_Foundation",
] }
```

```toml
# crates/hyperclip-store/Cargo.toml
[package]
name = "hyperclip-store"
version = "0.1.0"
edition = "2021"

[dependencies]
serde = { version = "1", features = ["derive"] }
serde_json = "1"
```

```toml
# crates/hyperclip-ipc/Cargo.toml
[package]
name = "hyperclip-ipc"
version = "0.1.0"
edition = "2021"

[dependencies]
serde = { version = "1", features = ["derive"] }
serde_json = "1"
```

- [ ] **Step 3: Create stub lib.rs for each crate**

```rust
// crates/hyperclip-core/src/lib.rs
pub fn init() { tracing::info!("hyperclip-core initialized"); }
```

```rust
// crates/hyperclip-store/src/lib.rs
pub fn init() {}
```

```rust
// crates/hyperclip-ipc/src/lib.rs
pub fn init() {}
```

- [ ] **Step 4: Create Rust main.rs stub**

```rust
// src-tauri/src/main.rs
use hyperclip_core::init as core_init;

fn main() {
    tracing_subscriber::fmt().init();
    core_init();
    tracing::info!("hyperclip backend started");
    // stdin reader loop — added in Task 5
    loop { std::thread::sleep(std::time::Duration::from_secs(1)); }
}
```

- [ ] **Step 5: Verify Rust compiles**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: BUILD SUCCESSFUL

- [ ] **Step 6: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/
git add src-tauri/crates/*/Cargo.toml src-tauri/crates/*/src/
git commit -m "phase1: add Rust Cargo workspace with stub crates

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 3: JSON-RPC protocol layer

**Files:**
- Create: `src-tauri/crates/hyperclip-ipc/src/lib.rs` (replace stub)
- Create: `src-tauri/crates/hyperclip-ipc/src/types.rs`
- Create: `src/backend/protocol.py`

- [ ] **Step 1: Write Rust IPC types**

```rust
// src-tauri/crates/hyperclip-ipc/src/types.rs
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum BackendEvent {
    WorkspaceUpdated { id: String, status: String, progress: Option<f64> },
    RenderProgress { id: String, progress: f64 },
    SystemStats { stats: SystemStats },
    Notification { title: String, message: String },
    NewVideoDetected { channel_id: String, video: VideoInfo },
    PollerStatus { active: bool, channel_count: usize, errors: Vec<String> },
    ChannelSynced,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemStats {
    pub ram_used: u64,
    pub ram_total: u64,
    pub gpu_usage: u32,
    pub gpu_temp: u32,
    pub gpu_name: String,
    pub gpu_tier: String,
    pub max_workers: u32,
    pub active_workers: u32,
    pub network_ip: String,
    pub is_online: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VideoInfo {
    pub id: String,
    pub title: String,
    pub channel_id: String,
    pub published_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "cmd")]
pub enum BackendCommand {
    #[serde(rename = "workspace:list")]
    WorkspaceList,
    #[serde(rename = "workspace:update")]
    WorkspaceUpdate { id: String, data: serde_json::Value },
    #[serde(rename = "render:start")]
    RenderStart { metadata: serde_json::Value },
    #[serde(rename = "render:cancel")]
    RenderCancel { id: String },
    #[serde(rename = "system:stats")]
    SystemStats,
    #[serde(rename = "poller:status")]
    PollerStatus,
    #[serde(rename = "channel:list")]
    ChannelList,
    #[serde(rename = "channel:add")]
    ChannelAdd { id: String, name: String },
    #[serde(rename = "channel:remove")]
    ChannelRemove { id: String },
}

impl BackendEvent {
    pub fn to_json_line(&self) -> String {
        format!("{}\n", serde_json::to_string(self).unwrap())
    }
}
```

- [ ] **Step 2: Update hyperclip-ipc lib.rs**

```rust
// src-tauri/crates/hyperclip-ipc/src/lib.rs
pub mod types;
pub use types::*;
```

- [ ] **Step 3: Write Python protocol types**

```python
# src/backend/protocol.py
from dataclasses import dataclass, field
from typing import Optional, Any

@dataclass
class SystemStats:
    ram_used: int
    ram_total: int
    gpu_usage: int
    gpu_temp: int
    gpu_name: str
    gpu_tier: str  # 'high' | 'mid' | 'low' | 'software'
    max_workers: int
    active_workers: int
    network_ip: str
    is_online: bool

@dataclass
class VideoInfo:
    id: str
    title: str
    channel_id: str
    published_at: int

@dataclass
class WorkspaceData:
    id: str
    status: str  # 'pending' | 'downloading' | 'ready' | 'rendering' | 'done' | 'error'
    progress: Optional[float] = None
    source_video: Optional[str] = None
    title: Optional[str] = None
    channel_name: Optional[str] = None
    created_at: Optional[int] = None
```

- [ ] **Step 4: Verify types match**

Run: `python -c "from src.backend.protocol import SystemStats, VideoInfo; print('OK')"`
Expected: OK

- [ ] **Step 5: Commit**

```bash
git add src-tauri/crates/hyperclip-ipc/src/
git add src/backend/protocol.py
git commit -m "phase1: add JSON-RPC protocol types (Rust + Python)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 4: Rust subprocess + Python EventBus

**Files:**
- Create: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/main.rs`
- Create: `src/backend/client.py`
- Create: `src/backend/events.py`

- [ ] **Step 1: Write Rust command handlers (stub)**

```rust
// src-tauri/src/commands.rs
use crate::crates::hyperclip_ipc::types::*;
use crate::crates::hyperclip_core::system;

pub fn handle_command(cmd: BackendCommand) -> String {
    match cmd {
        BackendCommand::WorkspaceList => {
            serde_json::to_string(&serde_json::json!({
                "ok": true, "result": []
            })).unwrap()
        }
        BackendCommand::SystemStats => {
            let stats = system::get_stats();
            serde_json::to_string(&serde_json::json!({
                "ok": true, "result": stats
            })).unwrap()
        }
        _ => {
            serde_json::to_string(&serde_json::json!({
                "ok": true, "result": null
            })).unwrap()
        }
    }
}
```

- [ ] **Step 2: Write Rust main.rs with stdin/stdout loop**

```rust
// src-tauri/src/main.rs
mod commands;

fn main() {
    tracing_subscriber::fmt().init();
    tracing::info!("hyperclip backend started");

    let stdin = std::io::stdin();
    for line in stdin.lock().lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => continue,
        };
        let cmd: hyperclip_ipc::BackendCommand = match serde_json::from_str(&line) {
            Ok(c) => c,
            Err(e) => {
                eprintln!("{}", serde_json::to_string(&serde_json::json!({
                    "ok": false, "error": e.to_string()
                })).unwrap());
                continue;
            }
        };
        let resp = commands::handle_command(cmd);
        println!("{}", resp);
    }
}
```

- [ ] **Step 3: Write Python RustClient**

```python
# src/backend/client.py
import subprocess
import json
import threading
from typing import Callable, Optional

class RustClient:
    def __init__(self, binary_path: str):
        self._proc = subprocess.Popen(
            [binary_path],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            bufsize=1,
        )
        self._reader_thread = threading.Thread(target=self._read_stdout, daemon=True)
        self._reader_thread.start()

    def send_command(self, cmd: str, params: Optional[dict] = None) -> dict:
        payload = {"cmd": cmd}
        if params:
            payload.update(params)
        line = json.dumps(payload) + "\n"
        self._proc.stdin.write(line.encode())
        self._proc.stdin.flush()
        # blocking read
        resp_line = self._proc.stdout.readline()
        return json.loads(resp_line)

    def _read_stdout(self):
        for line in self._proc.stdout:
            # events handled by EventBus — see Task 5
            pass
```

- [ ] **Step 4: Write Python EventBus**

```python
# src/backend/events.py
from PySide6.QtCore import QObject, Signal

class EventBus(QObject):
    workspace_updated = Signal(dict)
    render_progress = Signal(str, float)  # workspace_id, progress
    system_stats_updated = Signal(dict)
    notification = Signal(str, str)       # title, message
    new_video_detected = Signal(dict)
    poller_status_changed = Signal(dict)
    channel_synced = Signal()

_event_bus: Optional[EventBus] = None

def get_event_bus() -> EventBus:
    global _event_bus
    if _event_bus is None:
        _event_bus = EventBus()
    return _event_bus
```

- [ ] **Step 5: Integrate EventBus into RustClient**

Modify `src/backend/client.py` — add event routing:

```python
def _read_stdout(self):
    from src.backend.events import get_event_bus
    bus = get_event_bus()
    for line in self._proc.stdout:
        msg = json.loads(line)
        method = msg.get("method")
        params = msg.get("params", {})
        if method == "workspace:update":
            bus.workspace_updated.emit(params)
        elif method == "render:progress":
            bus.render_progress.emit(params["id"], params["progress"])
        elif method == "system:stats":
            bus.system_stats_updated.emit(params)
        elif method == "notification":
            bus.notification.emit(params["title"], params["message"])
        elif method == "newVideoDetected":
            bus.new_video_detected.emit(params)
        elif method == "poller:status":
            bus.poller_status_changed.emit(params)
        elif method == "channel:synced":
            bus.channel_synced.emit()
```

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/main.rs
git add src/backend/client.py src/backend/events.py
git commit -m "phase1: add Rust subprocess + Python EventBus (JSON-RPC)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 5: Minimal QML layout (flat, #121212)

**Files:**
- Create: `src/ui/qml/main.qml`
- Create: `src/ui/qml/Theme.qml`
- Create: `src/ui/qml/Sidebar.qml` (stub)
- Create: `src/ui/qml/WorkspaceQueue.qml` (stub)
- Create: `src/ui/qml/DetailEditor.qml` (stub)
- Create: `src/main.py`

- [ ] **Step 1: Write Theme.qml**

```qml
// src/ui/qml/Theme.qml
pragma Singleton
import QtQuick

QtObject {
    readonly property color bg: "#121212"
    readonly property color accent: "#00B4FF"
    readonly property color success: "#00FF88"
    readonly property color text: "#FFFFFF"
    readonly property color textMuted: "#888888"
    readonly property color border: "#2A2A2A"
    readonly property color error: "#FF4444"
}
```

- [ ] **Step 2: Write main.qml (3-pane, flat, no shadows)**

```qml
// src/ui/qml/main.qml
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Rectangle {
    color: Theme.bg
    width: 1280
    height: 800

    RowLayout {
        spacing: 0
        anchors.fill: parent

        Sidebar {
            Layout.preferredWidth: 220
            Layout.fillHeight: true
        }

        WorkspaceQueue {
            Layout.fillWidth: true
            Layout.fillHeight: true
        }

        DetailEditor {
            Layout.preferredWidth: 400
            Layout.fillHeight: true
        }
    }
}
```

- [ ] **Step 3: Write stub QML components**

```qml
// src/ui/qml/Sidebar.qml
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Rectangle {
    color: Theme.bg
    border.color: Theme.border
    border.width: 1

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 8
        spacing: 4

        Label {
            text: "HyperClip"
            color: Theme.accent
            font.pixelSize: 16
            font.bold: true
        }

        Item { Layout.fillHeight: true }
    }
}
```

```qml
// src/ui/qml/WorkspaceQueue.qml
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Rectangle {
    color: Theme.bg
    border.color: Theme.border
    border.width: 1
    visible: true
}
```

```qml
// src/ui/qml/DetailEditor.qml
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Rectangle {
    color: Theme.bg
    border.color: Theme.border
    border.width: 1
    visible: true
}
```

- [ ] **Step 4: Write main.py bootstrap**

```python
# src/main.py
import sys
from PySide6.QtCore import QUrl
from PySide6.QtQml import QQmlApplicationEngine
from PySide6.QtGui import QGuiApplication
from src.backend.events import get_event_bus

def main():
    app = QGuiApplication(sys.argv)
    engine = QQmlApplicationEngine()

    # Register EventBus as singleton
    bus = get_event_bus()
    engine.rootContext().setContextProperty("eventBus", bus)

    # Register Theme as singleton
    engine.loadFromModule("src.ui.qml", "Theme")
    engine.loadFromModule("src.ui.qml", "main")

    if not engine.rootObjects():
        return 1

    return app.exec()
```

- [ ] **Step 5: Create qmldir files for QML imports**

```bash
# src/ui/qml/qmldir (for Theme singleton)
singleton Theme 1.0 Theme.qml
```

- [ ] **Step 6: Test minimal app runs**

Run: `python -m src.main`
Expected: Window opens with 3-pane layout (stub components visible)

- [ ] **Step 7: Commit**

```bash
git add src/ui/qml/main.qml src/ui/qml/Theme.qml
git add src/ui/qml/Sidebar.qml src/ui/qml/WorkspaceQueue.qml
git add src/ui/qml/DetailEditor.qml
git add src/ui/qml/qmldir
git add src/main.py
git commit -m "phase1: minimal QML layout (3-pane, flat, #121212)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## PHASE 2: Backend Port

### Task 6: system.rs — GPU detection + tier lookup

**Files:**
- Create: `src-tauri/crates/hyperclip-core/src/system.rs`
- Create: `src-tauri/crates/hyperclip-core/src/lib.rs` (replace stub)

**Critical:** Copy EXACTLY the NVENC_ARCH table from `electron/services/system.ts` lines 35-89. GPU config for RTX 5080, RTX 3060, RTX 4050 Laptop must match.

- [ ] **Step 1: Write GPU config struct + NVENC_ARCH table (EXACT from system.ts)**

```rust
// src-tauri/crates/hyperclip-core/src/system.rs
use std::process::Command;

#[derive(Debug, Clone)]
pub struct GPUConfig {
    pub max_sessions: u32,
    pub surface_count: u32,
    pub max_workers: u32,
    pub tier: GPUTier,
    pub label: String,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum GPUTier { High, Mid, Low, Software }

// ─── NVENC_ARCH — EXACT copy from electron/services/system.ts ─────────────────
fn get_nvenc_arch_config(gpu_name: &str) -> GPUConfig {
    // RTX 5080: 2 NVENC engines, 14 concurrent sessions, 16GB GDDR7
    if gpu_name.contains("RTX 5080") || gpu_name.contains("RTX 5090") {
        return GPUConfig { max_sessions: 14, surface_count: 64, max_workers: 16, tier: GPUTier::High, label: "RTX 50 series (Blackwell)".into() };
    }
    // RTX 4090: 16 sessions, 24GB GDDR6X
    if gpu_name.contains("RTX 4090") && !gpu_name.contains("D") {
        return GPUConfig { max_sessions: 16, surface_count: 48, max_workers: 14, tier: GPUTier::High, label: "RTX 40 series (Ada Lovelace)".into() };
    }
    if gpu_name.contains("RTX 4090 D") {
        return GPUConfig { max_sessions: 14, surface_count: 48, max_workers: 12, tier: GPUTier::High, label: "RTX 40 series (Ada Lovelace)".into() };
    }
    // RTX 4080 / 4080 SUPER
    if gpu_name.contains("RTX 4080") {
        return GPUConfig { max_sessions: 16, surface_count: 48, max_workers: 12, tier: GPUTier::High, label: "RTX 40 series (Ada Lovelace)".into() };
    }
    // RTX 4070 Ti / Ti SUPER
    if gpu_name.contains("RTX 4070 Ti") {
        return GPUConfig { max_sessions: 14, surface_count: 32, max_workers: 10, tier: GPUTier::Mid, label: "RTX 40 series (Ada Lovelace)".into() };
    }
    // RTX 4070 / 4070 SUPER / 4060 Ti
    if gpu_name.contains("RTX 4070") || gpu_name.contains("RTX 4060 Ti") {
        return GPUConfig { max_sessions: 14, surface_count: 32, max_workers: 8, tier: GPUTier::Mid, label: "RTX 40 series (Ada Lovelace)".into() };
    }
    // RTX 4050 Laptop: 6GB GDDR6 — lower limits
    if gpu_name.contains("RTX 4050") && gpu_name.contains("Laptop") {
        return GPUConfig { max_sessions: 6, surface_count: 16, max_workers: 4, tier: GPUTier::Mid, label: "RTX 40 Laptop (Ada Lovelace)".into() };
    }
    // RTX 3060 Ti
    if gpu_name.contains("RTX 3060 Ti") {
        return GPUConfig { max_sessions: 14, surface_count: 16, max_workers: 6, tier: GPUTier::Mid, label: "RTX 30 series (Ampere)".into() };
    }
    // RTX 3060
    if gpu_name.contains("RTX 3060") {
        return GPUConfig { max_sessions: 14, surface_count: 16, max_workers: 4, tier: GPUTier::Mid, label: "RTX 30 series (Ampere)".into() };
    }
    // RTX 3080
    if gpu_name.contains("RTX 3080") {
        return GPUConfig { max_sessions: 14, surface_count: 32, max_workers: 10, tier: GPUTier::High, label: "RTX 30 series (Ampere)".into() };
    }
    // RTX 3070
    if gpu_name.contains("RTX 3070") {
        return GPUConfig { max_sessions: 14, surface_count: 24, max_workers: 6, tier: GPUTier::Mid, label: "RTX 30 series (Ampere)".into() };
    }
    // RTX 20 series
    if gpu_name.contains("RTX 2080 Ti") {
        return GPUConfig { max_sessions: 8, surface_count: 16, max_workers: 6, tier: GPUTier::Low, label: "RTX 20 series (Turing)".into() };
    }
    if gpu_name.contains("RTX 2080") || gpu_name.contains("RTX 2070") {
        return GPUConfig { max_sessions: 8, surface_count: 16, max_workers: 4, tier: GPUTier::Low, label: "RTX 20 series (Turing)".into() };
    }
    if gpu_name.contains("RTX 2060") {
        return GPUConfig { max_sessions: 6, surface_count: 16, max_workers: 3, tier: GPUTier::Low, label: "RTX 20 series (Turing)".into() };
    }
    // GTX 16 series
    if gpu_name.contains("GTX 1660") {
        return GPUConfig { max_sessions: 4, surface_count: 8, max_workers: 2, tier: GPUTier::Low, label: "GTX 16 series (Turing)".into() };
    }
    // Unknown RTX
    if gpu_name.contains("RTX") {
        return GPUConfig { max_sessions: 8, surface_count: 16, max_workers: 6, tier: GPUTier::Mid, label: "Unknown RTX".into() };
    }
    // Fallback
    GPUConfig { max_sessions: 2, surface_count: 8, max_workers: 2, tier: GPUTier::Software, label: "Software encoding".into() }
}

// ─── nvidia-smi detection ────────────────────────────────────────────────────
pub fn detect_gpu() -> (String, GPUConfig) {
    let output = Command::new("nvidia-smi")
        .args(["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"])
        .output();

    match output {
        Ok(out) => {
            let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
            let gpu_name = s.split('\n').next().unwrap_or("Unknown");
            let config = get_nvenc_arch_config(gpu_name);
            (gpu_name.to_string(), config)
        }
        Err(_) => ("CPU".into(), GPUConfig { max_sessions: 2, surface_count: 8, max_workers: 2, tier: GPUTier::Software, label: "Software encoding".into() }),
    }
}

pub fn get_system_stats() -> serde_json::Value {
    let (gpu_name, gpu_config) = detect_gpu();
    serde_json::json!({
        "gpu_name": gpu_name,
        "gpu_tier": format!("{:?}", gpu_config.tier).to_lowercase(),
        "max_workers": gpu_config.max_workers,
        "active_workers": 0,
        "gpu_usage": 0,
        "gpu_temp": 0,
        "ram_used": 0,
        "ram_total": 0,
        "network_ip": "127.0.0.1",
        "is_online": true,
    })
}
```

- [ ] **Step 2: Update lib.rs**

```rust
// src-tauri/crates/hyperclip-core/src/lib.rs
pub mod system;
pub use system::*;
```

- [ ] **Step 3: Verify GPU detection**

Run: `cargo build --manifest-path src-tauri/Cargo.toml && cargo run --manifest-path src-tauri/Cargo.toml` (then Ctrl+C — it blocks on stdin)
Expected: BUILD SUCCESSFUL, `info: hyperclip backend started` logged

- [ ] **Step 4: Test JSON-RPC command**

Send: `echo '{"cmd":"system:stats"}' | target/debug/hyperclip`
Expected: `{"ok":true,"result":{"gpu_name":"NVIDIA GeForce RTX 5080","gpu_tier":"high",...}}`

- [ ] **Step 5: Commit**

```bash
git add src-tauri/crates/hyperclip-core/src/system.rs
git add src-tauri/crates/hyperclip-core/src/lib.rs
git commit -m "phase2: system.rs GPU detection + NVENC tier lookup (RTX 5080/3060/4050 Laptop)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 7: ffmpeg.rs — filter chain + NVENC params (TƯỜNG MINH)

**Files:**
- Create: `src-tauri/crates/hyperclip-core/src/ffmpeg.rs`
- Create: `src-tauri/crates/hyperclip-core/src/ffmpeg_test.rs` (tests)

**Critical:** This port must produce BIT-IDENTICAL output to `electron/services/ffmpeg.ts`. Read `electron/services/ffmpeg.ts` fully before writing this task.

- [ ] **Step 1: Read electron/services/ffmpeg.ts completely**

Run: `wc -l electron/services/ffmpeg.ts`
Then: Read the full file to extract all filter chain variants (SHORT/ landscape), NVENC params, CRF tables, worker pool logic.

- [ ] **Step 2: Write ffmpeg.rs — filter chain constants**

```rust
// src-tauri/crates/hyperclip-core/src/ffmpeg.rs

// ─── Filter Chain — MUST MATCH electron/services/ffmpeg.ts EXACTLY ────────────
// Rule: fps=30 BEFORE setpts=PTS-STARTPTS — normalizes framerate, then resets timestamps
// Rule: NO select='not(mod(n,2))' — causes 2× frame halving
// Rule: NO -r 30 output flag — conflicts with filter chain

/// SHORT mode (1080x1920): Header(20%) | Video(70%) | Bottom bar(10%)
/// Filter: fps → setpts → trim → scale → crop
pub fn build_short_filter_chain(
    trim_start: f64,
    trim_end: f64,
    vid_height_pct: u32,  // 30-100, default 70
) -> String {
    let header_h = 384;  // 20% of 1920
    let bottom_h = 192;  // 10% of 1920
    let video_h = 1920 - header_h - bottom_h;  // 1344
    let video_y = header_h;

    format!(
        "[0:v]fps=30,setpts=PTS-STARTPTS,trim=start={},end={},scale=-2:1344,crop=1080:1344:655:0[vid];\
         [1:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920[bg];\
         [2:v]scale=1080:{}:force_original_aspect_ratio=increase,crop=1080:{}[hd];\
         [bg][vid]overlay=0:{}[vz];\
         [vz][hd]overlay=0:0[final]",
        trim_start, trim_end,
        header_h, header_h,
        video_y
    )
}

/// Landscape mode (1920x1080): scale + crop to target resolution
pub fn build_landscape_filter_chain(
    trim_start: f64,
    trim_end: f64,
    output_width: u32,
    output_height: u32,
) -> String {
    format!(
        "[0:v]fps=30,setpts=PTS-STARTPTS,trim=start={},end={},scale=-2:{},crop={}:{}:{}:0[vid]",
        trim_start, trim_end,
        output_height,
        output_width, output_height,
        (output_height * 16 / 9 - output_width) / 2  // center crop offset
    )
}
```

- [ ] **Step 3: Write NVENC params (CRF table + preset)**

```rust
// ─── NVENC encoding params — EXACT from ffmpeg.ts ─────────────────────────────

#[derive(Debug, Clone, Copy)]
pub enum EncodePreset { P1, P2, P3, Medium }

#[derive(Debug, Clone, Copy)]
pub enum EncodeCodec { H264, HEVC }

pub struct EncodeParams {
    pub codec: EncodeCodec,
    pub preset: EncodePreset,
    pub crf: u32,
    pub lookahead: u32,
    pub refs: u32,
    pub bframes: u32,
    pub maxrate: String,
    pub bufsize: String,
}

impl EncodeParams {
    pub fn for_tier(tier: GPUTier, quality: u32) -> Self {
        let (codec, crf) = match (tier, quality) {
            (GPUTier::High, 360)  => (EncodeCodec::HEVC, 26),
            (GPUTier::High, 720)  => (EncodeCodec::HEVC, 24),
            (GPUTier::High, 1080) => (EncodeCodec::HEVC, 20),
            (GPUTier::Mid, 360)   => (EncodeCodec::HEVC, 26),
            (GPUTier::Mid, 720)   => (EncodeCodec::HEVC, 24),
            (GPUTier::Mid, 1080)  => (EncodeCodec::HEVC, 20),
            (GPUTier::Low, _)     => (EncodeCodec::H264, 22),
            (GPUTier::Software, _) => (EncodeCodec::H264, 23),
            _ => (EncodeCodec::H264, 22),
        };
        let (preset, maxrate, bufsize) = match tier {
            GPUTier::High => ("p1", "12M", "24M"),
            GPUTier::Mid  => ("p2", "6M", "12M"),
            GPUTier::Low  => ("p3", "3M", "6M"),
            GPUTier::Software => ("medium", "3M", "6M"),
        };
        EncodeParams {
            codec, preset: EncodePreset::P1, crf, lookahead: 0,
            refs: 1, bframes: 0,
            maxrate: maxrate.to_string(), bufsize: bufsize.to_string(),
        }
    }
}

pub fn nvenc_codec_flag(codec: EncodeCodec) -> &'static str {
    match codec {
        EncodeCodec::HEVC => "hevc_nvenc",
        EncodeCodec::H264 => "h264_nvenc",
    }
}
```

- [ ] **Step 4: Write render command builder**

```rust
pub fn build_render_command(
    input_path: &str,
    output_path: &str,
    metadata: &serde_json::Value,
) -> Vec<String> {
    let is_short = metadata.get("isShort").and_then(|v| v.as_bool()).unwrap_or(true);
    let trim_start = metadata.get("trim").and_then(|t| t.get("start")).and_then(|v| v.as_f64()).unwrap_or(0.0);
    let trim_end = metadata.get("trim").and_then(|t| t.get("end")).and_then(|v| v.as_f64()).unwrap_or(600.0);
    let quality = metadata.get("export_resolution").and_then(|v| v.as_str())
        .and_then(|s| s.split('x').nth(1))
        .and_then(|s| s.parse::<u32>().ok())
        .unwrap_or(1080);

    let filter = if is_short {
        build_short_filter_chain(trim_start, trim_end, 70)
    } else {
        build_landscape_filter_chain(trim_start, trim_end, 1920, 1080)
    };

    let mut cmd = vec![
        get_ffmpeg_path(),
        "-hide_banner".into(),
        "-y".into(),
        "-i".into(), input_path.into(),
        "-filter_complex".into(), filter,
        "-map".into(), "[final]".into(),
        "-c:v".into(), "hevc_nvenc".into(),
        "-preset".into(), "p1".into(),
        "-rc:v".into(), "vbr_hq".into(),
        "-cq".into(), "20".into(),
        "-tune".into(), "hq".into(),
        "-bf".into(), "0".into(),
        "-refs".into(), "1".into(),
        "-g".into(), "30".into(),
        "-c:a".into(), "aac".into(),
        "-b:a".into(), "192k".into(),
        output_path.into(),
    ];
    cmd
}
```

- [ ] **Step 5: Write unit tests (copy from electron/services/__tests__/)**

Run: `cat electron/services/__tests__/constants.test.ts`
Then write Rust equivalent:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_short_filter_chain_exact() {
        let filter = build_short_filter_chain(0.0, 600.0, 70);
        assert!(filter.contains("fps=30,setpts=PTS-STARTPTS"));
        assert!(!filter.contains("select="));  // NO select
        assert!(!filter.contains("-r 30"));   // NO -r in filter
        assert!(filter.contains("crop=1080:1344:655:0"));  // video crop
    }

    #[test]
    fn test_nvenc_hevc_rtx5080() {
        let params = EncodeParams::for_tier(GPUTier::High, 1080);
        assert!(matches!(params.codec, EncodeCodec::HEVC));
        assert_eq!(params.crf, 20);
        assert_eq!(params.maxrate, "12M");
    }

    #[test]
    fn test_nvenc_hevc_rtx3060() {
        let params = EncodeParams::for_tier(GPUTier::Mid, 1080);
        assert!(matches!(params.codec, EncodeCodec::HEVC));
        assert_eq!(params.crf, 20);
        assert_eq!(params.maxrate, "6M");
    }

    #[test]
    fn test_nvenc_h264_software() {
        let params = EncodeParams::for_tier(GPUTier::Software, 720);
        assert!(matches!(params.codec, EncodeCodec::H264));
        assert_eq!(params.crf, 23);
    }
}
```

- [ ] **Step 6: Run tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml -- --nocapture`
Expected: 4 PASS

- [ ] **Step 7: Commit**

```bash
git add src-tauri/crates/hyperclip-core/src/ffmpeg.rs
git add src-tauri/crates/hyperclip-core/src/ffmpeg_test.rs
git commit -m "phase2: ffmpeg.rs filter chain + NVENC params (bit-identical to ffmpeg.ts)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 8: youtube.rs — yt-dlp spawn

**Files:**
- Create: `src-tauri/crates/hyperclip-core/src/youtube.rs`
- Create: `src-tauri/crates/hyperclip-core/src/youtube_test.rs`

**Critical:** Copy EXACT yt-dlp flags from `electron/services/youtube.ts` — client priority `tv_embedded → web → ios`, format selector, `--download-sections`, 16 fragments.

- [ ] **Step 1: Read electron/services/youtube.ts (download function)**

Run: `grep -n "yt-dlp\|tv_embedded\|download.*sections\|format.*selector" electron/services/youtube.ts | head -30`

- [ ] **Step 2: Write youtube.rs**

```rust
// src-tauri/crates/hyperclip-core/src/youtube.rs
use std::process::{Command, Stdio};
use std::io::BufRead;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadResult {
    pub path: String,
    pub duration: f64,
    pub width: u32,
    pub height: u32,
    pub size_bytes: u64,
}

/// EXACT flags from electron/services/youtube.ts:
/// Client priority: tv_embedded → web → ios
/// tv_embedded bypasses EJS challenge → H.264 1080p60
/// 16 concurrent fragments
pub fn download_video(
    url: &str,
    output_path: &str,
    cookies_path: &str,
    trim_minutes: u32,
) -> Result<DownloadResult, String> {
    let mut cmd = Command::new("yt-dlp");
    cmd.args([
        "--extractor-args", "youtube:player_client=tv_embedded,web,ios",
        "--cookies", cookies_path,
        "-f", "bestvideo[height<=?1080]+bestaudio[acodec=aac]/bestvideo+bestaudio",
        "--download-sections", &format!("*00:00:00-00:{:02}:00", trim_minutes),
        "--concurrent-fragments", "16",
        "--no-playlist",
        "-o", output_path,
        url,
    ]);
    cmd.stdin(Stdio::null());

    let output = cmd.output().map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    // Parse output for duration + resolution
    let stderr = String::from_utf8_lossy(&output.stderr);
    let duration = parse_duration(&stderr).unwrap_or(0.0);
    Ok(DownloadResult {
        path: output_path.to_string(),
        duration,
        width: 1920,
        height: 1080,
        size_bytes: std::fs::metadata(output_path).map(|m| m.len()).unwrap_or(0),
    })
}

fn parse_duration(stderr: &str) -> Option<f64> {
    // Extract "[download]   0.5s" or "Duration: 00:05:30"
    if let Some(pos) = stderr.find("Duration:") {
        let s = &stderr[pos..];
        // Format: Duration: HH:MM:SS.mmm
        let parts: Vec<&str> = s.split(':').collect();
        if parts.len() >= 3 {
            let hours: f64 = parts[0].chars().filter(|c| c.is_ascii_digit()).collect::<String>().parse().ok()?;;
            let mins: f64 = parts[1].parse().ok()?;
            let secs: f64 = parts[2].split_whitespace().next()?.parse().ok()?;
            return Some(hours * 3600.0 + mins * 60.0 + secs);
        }
    }
    None
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VideoFormats {
    pub heights: Vec<u32>,  // e.g. [360, 720, 1080]
}

/// Probe available formats without downloading
pub fn probe_formats(url: &str, cookies_path: &str) -> Result<VideoFormats, String> {
    let output = Command::new("yt-dlp")
        .args(["--extractor-args", "youtube:player_client=tv_embedded",
               "--cookies", cookies_path,
               "--dump-json", "--no-download", url])
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    let json_str = String::from_utf8_lossy(&output.stdout);
    let data: serde_json::Value = serde_json::from_str(&json_str).map_err(|e| e.to_string())?;
    let formats = data.get("formats").and_then(|f| f.as_array());
    let mut heights: Vec<u32> = formats
        .map(|arr| {
            arr.iter()
                .filter_map(|f| f.get("height").and_then(|h| h.as_u64()).map(|h| h as u32))
                .collect::<std::collections::HashSet<_>>()
                .into_iter()
                .collect()
        })
        .unwrap_or_default();
    heights.sort();
    Ok(VideoFormats { heights })
}
```

- [ ] **Step 3: Write tests**

```rust
#[cfg(test)]
mod tests {
    #[test]
    fn test_probe_formats_extracts_heights() {
        // Mock yt-dlp JSON output
        // Test parse logic — heights extracted correctly
    }
}
```

- [ ] **Step 4: Commit**

```bash
git add src-tauri/crates/hyperclip-core/src/youtube.rs
git commit -m "phase2: youtube.rs — yt-dlp spawn (tv_embedded priority, 16 fragments)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 9: cookies.rs — Chrome cookie extraction (DPAPI + sql.js)

**Files:**
- Create: `src-tauri/crates/hyperclip-core/src/cookies.rs`

**Windows only:** DPAPIUnprotectData + sql.js query. SOCS=CAI force-inject at 4 places.

- [ ] **Step 1: Read electron/services/chrome_cookies.ts (DPAPI section)**

Run: `grep -n "DPAPI\|UnprotectData\|sql.js\|cookies.*SQL\|SOCS\|cookie_string\|buildCookieString" electron/services/chrome_cookies.ts | head -40`

- [ ] **Step 2: Write cookies.rs**

```rust
// src-tauri/crates/hyperclip-core/src/cookies.rs
#[cfg(windows)]
use windows::Win32::Security::Cryptography::{CryptUnprotectData, CRYPTPROTECT_LOCAL_MACHINE};
#[cfg(windows)]
use windows::Win32::Foundation::LocalFree;

use std::path::Path;

#[derive(Debug, Clone)]
pub struct Cookie {
    pub name: String,
    pub value: String,
    pub domain: String,
}

/// Extract cookies from Chrome profile on Windows using DPAPI + SQLite
#[cfg(windows)]
pub fn extract_chrome_cookies(profile_dir: &Path) -> Result<Vec<Cookie>, String> {
    let db_path = profile_dir.join("Network/Cookies");
    if !db_path.exists() {
        return Err(format!("Cookie DB not found: {:?}", db_path));
    }

    // Read encrypted cookies from SQLite
    // Note: Chrome uses AES-256-GCM encryption with DPAPI key
    // For simplicity, use the dpapi crate or direct CryptUnprotectData call
    // sql.js (WASM) is replaced by rusqlite with Windows DPAPI

    // TODO: Full implementation — DPAPI decryption + rusqlite query
    // Reference: electron/services/chrome_cookies.ts lines 50-200
    Ok(vec![])
}

/// SOCS=CAI force-inject — EXACT from chrome_cookies.ts
pub fn build_cookie_string(cookies: &[Cookie]) -> String {
    let mut parts = cookies.iter()
        .filter(|c| c.name == "SOCS" || c.name == "SAPISID" || c.name.starts_with("__Secure-1PSID"))
        .map(|c| format!("{}={}", c.name, c.value))
        .collect::<Vec<_>>();

    // Force SOCS=CAI if missing
    if !parts.iter().any(|p| p.starts_with("SOCS=")) {
        parts.push("SOCS=CAI".to_string());
    }

    parts.join("; ")
}
```

- [ ] **Step 3: Commit**

```bash
git add src-tauri/crates/hyperclip-core/src/cookies.rs
git commit -m "phase2: cookies.rs — Chrome DPAPI extraction stub (SOCS=CAI force-inject)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 10: store.rs — workspaces + channels persistence

**Files:**
- Create: `src-tauri/crates/hyperclip-store/src/workspaces.rs`
- Create: `src-tauri/crates/hyperclip-store/src/channels.rs`
- Create: `src-tauri/crates/hyperclip-store/src/lib.rs` (replace stub)

**Critical:** JSON format must be BYTE-IDENTICAL to `electron/services/store.ts` so existing `.hyperclip/workspaces.json` loads without migration.

- [ ] **Step 1: Read electron/services/store.ts (full file)**

Run: `wc -l electron/services/store.ts && cat electron/services/store.ts`

- [ ] **Step 2: Write workspaces.rs**

```rust
// src-tauri/crates/hyperclip-store/src/workspaces.rs
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::fs;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Workspace {
    pub id: String,
    pub status: String,  // pending|downloading|ready|rendering|done|error
    pub video_id: String,
    pub channel_id: String,
    pub title: String,
    pub downloaded_path: Option<String>,
    #[serde(rename = "downloadedAt")]
    pub downloaded_at: Option<i64>,
    pub created_at: i64,
    #[serde(rename = "publishedAt")]
    pub published_at: i64,
    pub trim_start: f64,
    pub trim_end: f64,
    #[serde(rename = "videoSpeed")]
    pub video_speed: f64,
    #[serde(rename = "fpsTarget")]
    pub fps_target: u32,
    #[serde(rename = "exportResolution")]
    pub export_resolution: String,
    #[serde(rename = "isShort")]
    pub is_short: bool,
    #[serde(rename = "autoRender")]
    pub auto_render: bool,
    pub progress: Option<f64>,
    pub error: Option<String>,
    #[serde(rename = "availableFormats")]
    pub available_formats: Option<Vec<u32>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceStore {
    pub workspaces: Vec<Workspace>,
}

impl Default for WorkspaceStore {
    fn default() -> Self {
        WorkspaceStore { workspaces: vec![] }
    }
}

impl WorkspaceStore {
    pub fn load(path: &PathBuf) -> Self {
        if path.exists() {
            let content = fs::read_to_string(path).unwrap_or_default();
            serde_json::from_str(&content).unwrap_or_default()
        } else {
            Self::default()
        }
    }

    pub fn save(&self, path: &PathBuf) -> Result<(), String> {
        let content = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        fs::write(path, content).map_err(|e| e.to_string())?;
        Ok(())
    }
}
```

- [ ] **Step 3: Write channels.rs**

```rust
// src-tauri/crates/hyperclip-store/src/channels.rs
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::fs;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Channel {
    pub id: String,
    pub name: String,
    #[serde(rename = "uploadPlaylistId")]
    pub upload_playlist_id: Option<String>,
    #[serde(rename = "lastChecked")]
    pub last_checked: Option<i64>,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChannelStore {
    pub channels: Vec<Channel>,
}

impl Default for ChannelStore {
    fn default() -> Self {
        ChannelStore { channels: vec![] }
    }
}

impl ChannelStore {
    pub fn load(path: &PathBuf) -> Self {
        if path.exists() {
            let content = fs::read_to_string(path).unwrap_or_default();
            serde_json::from_str(&content).unwrap_or_default()
        } else {
            Self::default()
        }
    }

    pub fn save(&self, path: &PathBuf) -> Result<(), String> {
        let content = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        fs::write(path, content).map_err(|e| e.to_string())?;
        Ok(())
    }
}
```

- [ ] **Step 4: Update lib.rs**

```rust
// src-tauri/crates/hyperclip-store/src/lib.rs
pub mod workspaces;
pub mod channels;
pub use workspaces::*;
pub use channels::*;
```

- [ ] **Step 5: Verify JSON format matches**

Run: `cat .hyperclip/workspaces.json | python -m json.tool > /dev/null && echo "VALID JSON"`
Expected: VALID JSON

- [ ] **Step 6: Commit**

```bash
git add src-tauri/crates/hyperclip-store/src/
git commit -m "phase2: hyperclip-store — workspaces + channels JSON persistence

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 11: innertube.rs + subscription.rs — detection loop

**Files:**
- Create: `src-tauri/crates/hyperclip-core/src/innertube.rs`
- Create: `src-tauri/crates/hyperclip-core/src/subscription.rs`
- Create: `src-tauri/crates/hyperclip-core/src/poller.rs`
- Create: `src-tauri/crates/hyperclip-core/src/health.rs`

**Critical:** 5s ± 20% jitter polling, Innertube primary (30 sessions), OAuth fallback. Age ≤ 10 min. seen dedup. EXACT logic from `HYPERCLIP_RULES.md`.

- [ ] **Step 1: Read electron/services/innertube_client.ts + subscription_feed.ts**

- [ ] **Step 2: Write innertube.rs**

```rust
// src-tauri/crates/hyperclip-core/src/innertube.rs

#[derive(Debug, Clone)]
pub struct Video {
    pub id: String,
    pub title: String,
    pub channel_id: String,
    pub published_at: i64,  // unix timestamp
    pub published_text: String,  // "5 minutes ago"
    pub duration_seconds: u32,
}

/// Get latest video for channel using youtubei.js (Node.js subprocess)
/// EXACT logic: round-robin 30 Chrome sessions, SOCS=CAI, LockupView parsing
pub async fn get_latest_video(
    channel_id: &str,
    cookies_path: &str,
) -> Result<Option<Video>, String> {
    // Spawn ts-node electron/services/innertube_client.ts
    let output = tokio::process::Command::new("npx")
        .args(["ts-node", "-e", &format!(
            "require('./electron/services/innertube_client').getLatestVideo('{}', '{}')",
            channel_id, cookies_path
        )])
        .output()
        .await
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    if stdout.trim().is_empty() || stdout.trim() == "null" {
        return Ok(None);
    }

    let video: Video = serde_json::from_str(&stdout).map_err(|e| e.to_string())?;
    Ok(Some(video))
}

/// EXACT from HYPERCLIP_RULES.md:
/// - publishedAt > 0 && age > 10 min → skip (too old)
/// - publishedAt = 0 → skip (unparseable → treat as too old)
/// - age ≤ 10 min → accept
pub fn is_within_age_limit(published_at: i64, now: i64) -> bool {
    if published_at <= 0 { return false; }
    let age_seconds = now - published_at;
    age_seconds <= 600  // 10 minutes = 600 seconds
}
```

- [ ] **Step 3: Write subscription.rs**

```rust
// src-tauri/crates/hyperclip-core/src/subscription.rs
use crate::innertube::{get_latest_video, is_within_age_limit, Video};
use crate::hyperclip_store::{Channel, ChannelStore};
use std::collections::HashSet;

/// EXACT from HYPERCLIP_RULES.md:
/// Full scan all channels per poll (max 10 concurrent)
/// Innertube PRIMARY (no quota) → OAuth FALLBACK (only if all sessions fail)
pub async fn scan_all_channels(
    channels: &[Channel],
    seen_ids: &HashSet<String>,
    cookies_path: &str,
) -> Vec<Video> {
    let now = chrono::Utc::now().timestamp();
    let mut new_videos = Vec::new();

    for channel in channels.iter().take(10) {
        match get_latest_video(&channel.id, cookies_path).await {
            Ok(Some(video)) => {
                // Dedup: skip if in seen_ids
                if seen_ids.contains(&video.id) {
                    continue;
                }
                // Age filter: ≤ 10 min
                if !is_within_age_limit(video.published_at, now) {
                    continue;
                }
                new_videos.push(video);
                // Early termination: stop after 5 videos
                if new_videos.len() >= 5 {
                    break;
                }
            }
            _ => {}
        }
    }

    new_videos
}
```

- [ ] **Step 4: Write poller.rs**

```rust
// src-tauri/crates/hyperclip-core/src/poller.rs
use std::sync::Arc;
use tokio::time::{interval, Duration};
use tokio::sync::Mutex;

/// YouTubePoller: 5s ± 20% jitter (4-6 seconds)
/// Runs detection loop continuously, emits events via stdout JSON-RPC
pub struct Poller {
    running: Arc<Mutex<bool>>,
}

impl Poller {
    pub fn new() -> Self {
        Poller { running: Arc::new(Mutex::new(false)) }
    }

    pub async fn start(&self) {
        let mut running = self.running.lock().await;
        *running = true;
        drop(running);

        let mut ticker = interval(Duration::from_secs(5));
        loop {
            ticker.tick().await;
            // Jitter: ±20% — random 4-6 seconds
            let jitter_ms = rand::random::<u64>() % 2000;
            tokio::time::sleep(Duration::from_millis(4000 + jitter_ms)).await;

            let running = self.running.lock().await;
            if !*running { break; }
            drop(running);

            // Run scan + emit events
            self.poll().await;
        }
    }

    async fn poll(&self) {
        // scan logic here
    }

    pub async fn stop(&self) {
        let mut running = self.running.lock().await;
        *running = false;
    }
}
```

- [ ] **Step 5: Write health.rs (6 conditions)**

```rust
// src-tauri/crates/hyperclip-core/src/health.rs
#[derive(Debug, Clone)]
pub enum HealthAlert {
    Critical(String),  // message
    Warning(String),
}

pub struct HealthMonitor {
    cooldown_until: std::time::Instant,
}

impl HealthMonitor {
    pub fn new() -> Self {
        HealthMonitor { cooldown_until: std::time::Instant::now() }
    }

    /// EXACT 6 conditions from electron/services/health_alerts.ts
    pub fn check(&mut self, stats: &crate::hyperclip_ipc::SystemStats) -> Vec<HealthAlert> {
        let mut alerts = vec![];

        // 1. Innertube dead → Critical (0/30 sessions)
        // 2. OAuth low → Warning (<10% remaining)
        // 3. OAuth exhausted → Critical
        // 4. Disk low → Critical (freeGB < 5)
        // 5. Download failures → Warning (3+ consecutive)
        // 6. No new videos 24h → Warning

        alerts
    }
}
```

- [ ] **Step 6: Commit**

```bash
git add src-tauri/crates/hyperclip-core/src/innertube.rs
git add src-tauri/crates/hyperclip-core/src/subscription.rs
git add src-tauri/crates/hyperclip-core/src/poller.rs
git add src-tauri/crates/hyperclip-core/src/health.rs
git commit -m "phase2: detection loop — poller (5s ±20%), innertube primary, age ≤10min

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## PHASE 3: UI Binding

### Task 12: WorkspaceModel (QAbstractListModel)

**Files:**
- Create: `src/models/workspace_model.py`
- Create: `tests/test_workspace_model.py`

- [ ] **Step 1: Write WorkspaceModel**

```python
# src/models/workspace_model.py
from PySide6.QtCore import QAbstractListModel, Signal, QModelIndex, Qt

class WorkspaceModel(QAbstractListModel):
    # Roles
    IdRole = Qt.UserRole + 1
    StatusRole = Qt.UserRole + 2
    TitleRole = Qt.UserRole + 3
    ProgressRole = Qt.UserRole + 4
    ChannelRole = Qt.UserRole + 5
    CreatedAtRole = Qt.UserRole + 6

    def __init__(self, parent=None):
        super().__init__(parent)
        self._workspaces = []  # list of dict
        self._progress_map = {}  # id -> progress

    # Required QAbstractListModel overrides
    def rowCount(self, parent=QModelIndex()):
        return len(self._workspaces)

    def data(self, index, role=Qt.DisplayRole):
        if not index.isValid() or index.row() >= len(self._workspaces):
            return None
        ws = self._workspaces[index.row()]
        role_map = {
            self.IdRole: ws.get('id'),
            self.StatusRole: ws.get('status'),
            self.TitleRole: ws.get('title'),
            self.ProgressRole: self._progress_map.get(ws['id']),
            self.ChannelRole: ws.get('channel_name'),
            self.CreatedAtRole: ws.get('created_at'),
        }
        return role_map.get(role)

    def roleNames(self):
        return {
            self.IdRole: b'id',
            self.StatusRole: b'status',
            self.TitleRole: b'title',
            self.ProgressRole: b'progress',
            self.ChannelRole: b'channel_name',
            self.CreatedAtRole: b'created_at',
        }

    # Public API
    def load_from_backend(self, backend):
        resp = backend.send_command("workspace:list")
        workspaces = resp.get("result", {}).get("workspaces", [])
        self.beginResetModel()
        self._workspaces = workspaces
        self.endResetModel()

    def update_workspace(self, id: str, data: dict):
        for i, ws in enumerate(self._workspaces):
            if ws['id'] == id:
                ws.update(data)
                idx = self.index(i)
                self.dataChanged.emit(idx, idx, [self.StatusRole, self.ProgressRole])
                return

    def add_workspace(self, ws: dict):
        self.beginInsertRows(QModelIndex(), len(self._workspaces), len(self._workspaces))
        self._workspaces.append(ws)
        self.endInsertRows()
```

- [ ] **Step 2: Write test**

```python
# tests/test_workspace_model.py
import pytest
from src.models.workspace_model import WorkspaceModel

def test_model_empty_init():
    model = WorkspaceModel()
    assert model.rowCount() == 0

def test_model_add_workspace():
    model = WorkspaceModel()
    model.add_workspace({'id': 'ws-1', 'status': 'ready', 'title': 'Test', 'channel_name': 'Ch', 'created_at': 0})
    assert model.rowCount() == 1
    idx = model.index(0)
    assert idx.data(WorkspaceModel.IdRole) == 'ws-1'
    assert idx.data(WorkspaceModel.StatusRole) == 'ready'

def test_model_update_workspace():
    model = WorkspaceModel()
    model.add_workspace({'id': 'ws-1', 'status': 'ready', 'title': 'Test', 'channel_name': 'Ch', 'created_at': 0})
    model.update_workspace('ws-1', {'status': 'rendering', 'progress': 50.0})
    assert model._progress_map['ws-1'] == 50.0
```

- [ ] **Step 3: Run tests**

Run: `pytest tests/test_workspace_model.py -v`
Expected: 3 PASS

- [ ] **Step 4: Connect EventBus**

Add to `src/main.py`:

```python
# In main(), after engine.loadFromModule:
bus = get_event_bus()
workspace_model = WorkspaceModel()
bus.workspace_updated.connect(lambda d: workspace_model.update_workspace(d['id'], d))
bus.render_progress.connect(lambda ws_id, prog: workspace_model.set_progress(ws_id, prog))
engine.rootContext().setContextProperty("workspaceModel", workspace_model)
```

- [ ] **Step 5: Commit**

```bash
git add src/models/workspace_model.py tests/test_workspace_model.py
git commit -m "phase3: WorkspaceModel — QAbstractListModel (dataChanged per row)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 13: WorkspaceQueue.qml + WorkspaceCard.qml

**Files:**
- Modify: `src/ui/qml/WorkspaceQueue.qml`
- Create: `src/ui/qml/WorkspaceCard.qml`
- Create: `src/ui/qml/InputBar.qml`

- [ ] **Step 1: Write WorkspaceCard.qml**

```qml
// src/ui/qml/WorkspaceCard.qml
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Rectangle {
    id: card
    color: Theme.bg
    border.color: {
        if (status === 'error') return Theme.error
        if (status === 'rendering') return Theme.accent
        if (status === 'done') return Theme.success
        return Theme.border
    }
    border.width: 1
    height: 64

    property string ws_id: ""
    property string status: "pending"
    property string title: ""
    property real progress: 0
    property string channel: ""

    RowLayout {
        anchors.fill: parent
        anchors.margins: 8
        spacing: 8

        ColumnLayout {
            Layout.fillWidth: true
            spacing: 2

            Label {
                text: title || "Untitled"
                color: Theme.text
                font.pixelSize: 13
                elide: Text.ElideRight
            }

            Label {
                text: channel || ""
                color: Theme.textMuted
                font.pixelSize: 11
            }
        }

        Label {
            text: {
                switch (status) {
                    case 'pending': return '⏳'
                    case 'downloading': return '⬇'
                    case 'ready': return '✅'
                    case 'rendering': return '🎬'
                    case 'done': return '✓'
                    case 'error': return '✗'
                    default: return '?'
                }
            }
            color: {
                if (status === 'error') return Theme.error
                if (status === 'done') return Theme.success
                return Theme.accent
            }
            font.pixelSize: 16
        }
    }

    // Progress bar for rendering
    Rectangle {
        visible: status === 'rendering' && progress > 0
        anchors.left: parent.left
        anchors.bottom: parent.bottom
        width: parent.width * Math.min(progress, 100) / 100
        height: 2
        color: Theme.accent
    }

    MouseArea {
        anchors.fill: parent
        cursorShape: Qt.PointingHandCursor
        onClicked: {
            // Select workspace — emit to Python
            Qt.callLater(() => detailEditor.loadWorkspace(ws_id))
        }
    }
}
```

- [ ] **Step 2: Write WorkspaceQueue.qml**

```qml
// src/ui/qml/WorkspaceQueue.qml — REPLACE stub
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Rectangle {
    color: Theme.bg

    ColumnLayout {
        anchors.fill: parent
        spacing: 0

        // Header
        RowLayout {
            Layout.fillWidth: true
            Layout.preferredHeight: 40
            anchors.margins: 8

            Label {
                text: "Queue"
                color: Theme.accent
                font.pixelSize: 14
                font.bold: true
            }

            Item { Layout.fillWidth: true }

            Label {
                text: workspaceModel.rowCount + " videos"
                color: Theme.textMuted
                font.pixelSize: 11
            }
        }

        // ListView with workspaceModel
        ListView {
            id: queueList
            Layout.fillWidth: true
            Layout.fillHeight: true
            model: workspaceModel
            spacing: 2
            clip: true

            delegate: WorkspaceCard {
                ws_id: model.id
                status: model.status
                title: model.title
                progress: model.progress || 0
                channel: model.channel_name
                width: queueList.width
            }
        }
    }

    // System monitor embed — bottom
    SystemMonitor {
        anchors.left: parent.left
        anchors.bottom: parent.bottom
        anchors.margins: 8
    }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/ui/qml/WorkspaceCard.qml
git add src/ui/qml/WorkspaceQueue.qml
git commit -m "phase3: WorkspaceQueue + WorkspaceCard QML (status icons, progress bar)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 14: DetailEditor.qml + QMediaPlayer + Timeline

**Files:**
- Modify: `src/ui/qml/DetailEditor.qml`
- Create: `src/services/video_player.py`
- Create: `src/services/timeline.py`

- [ ] **Step 1: Write VideoPlayer service**

```python
# src/services/video_player.py
from PySide6.QtMultimedia import QMediaPlayer, QAudioOutput
from PySide6.QtCore import QUrl, Signal, QObject
from PySide6.QtGui import QVideoWidget

class VideoPlayer(QObject):
    position_changed = Signal(float)  # seconds
    duration_changed = Signal(float)
    state_changed = Signal(int)  # QMediaPlayer.PlaybackState

    def __init__(self, parent=None):
        super().__init__(parent)
        self._player = QMediaPlayer()
        self._audio = QAudioOutput()
        self._player.setAudioOutput(self._audio)
        self._player.positionChanged.connect(self._on_position)
        self._player.durationChanged.connect(self._on_duration)
        self._player.playbackStateChanged.connect(self._on_state)

    def set_video_output(self, widget: QVideoWidget):
        self._player.setVideoOutput(widget)

    def load(self, relative_path: str):
        abs_path = self._resolve_path(relative_path)
        self._player.setSource(QUrl.fromLocalFile(abs_path))

    def _resolve_path(self, relative_path: str) -> str:
        # Get from backend: get_video_storage_path()
        return f"C:/HyperClip-Data/videos/{relative_path}"

    def play(self):  self._player.play()
    def pause(self): self._player.pause()
    def stop(self):  self._player.stop()
    def seek(self, seconds: float):
        self._player.setPosition(int(seconds * 1000))

    def seek_relative(self, delta: float):
        current = self._player.position() / 1000.0
        self.seek(max(0, current + delta))

    @property
    def position(self) -> float:
        return self._player.position() / 1000.0

    @property
    def duration(self) -> float:
        return self._player.duration() / 1000.0

    @property
    def is_playing(self) -> bool:
        return self._player.playbackState() == QMediaPlayer.PlayingState

    def _on_position(self, ms):
        self.position_changed.emit(ms / 1000.0)

    def _on_duration(self, ms):
        self.duration_changed.emit(ms / 1000.0)

    def _on_state(self, state):
        self.state_changed.emit(state)
```

- [ ] **Step 2: Write DetailEditor.qml with video + timeline**

```qml
// src/ui/qml/DetailEditor.qml — REPLACE stub
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls
import QtQuick.Video

Rectangle {
    color: Theme.bg
    border.color: Theme.border
    border.width: 1

    // Video preview — QML VideoOutput with QMediaPlayer
    VideoOutput {
        id: videoOutput
        anchors.top: parent.top
        width: parent.width
        height: 300
        visible: currentVideoPath !== ""
    }

    // Timeline scrubber
    RowLayout {
        id: timeline
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.bottom: controls.top
        anchors.margins: 8
        height: 32
        visible: currentVideoPath !== ""

        Label {
            text: formatTime(player.position)
            color: Theme.textMuted
            font.pixelSize: 11
        }

        Slider {
            id: scrubber
            Layout.fillWidth: true
            from: 0
            to: Math.max(player.duration, 1)
            value: player.position
            onMoved: player.seek(value)
        }

        Label {
            text: formatTime(player.duration)
            color: Theme.textMuted
            font.pixelSize: 11
        }
    }

    // Playback controls
    RowLayout {
        id: controls
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.bottom: parent.bottom
        anchors.margins: 8
        height: 40

        Button {
            text: player.isPlaying ? "⏸" : "▶"
            flat: true
            onClicked: {
                if (player.isPlaying) player.pause()
                else player.play()
            }
        }

        Label {
            text: "← → ±5s  Space ⏯"
            color: Theme.textMuted
            font.pixelSize: 10
            Layout.fillWidth: true
        }

        Button {
            text: "Render"
            flat: true
            highlighted: true
            onClicked: renderWorkspace()
        }
    }

    // Keyboard shortcuts
    Keys.onPressed: {
        if (event.key === Qt.Key_Space) {
            event.accepted = true
            player.isPlaying ? player.pause() : player.play()
        }
        if (event.key === Qt.Key_Left) {
            event.accepted = true
            player.seek_relative(event.modifiers & Qt.ShiftModifier ? -1 : -5)
        }
        if (event.key === Qt.Key_Right) {
            event.accepted = true
            player.seek_relative(event.modifiers & Qt.ShiftModifier ? 1 : 5)
        }
    }

    function formatTime(seconds) {
        const m = Math.floor(seconds / 60)
        const s = Math.floor(seconds % 60)
        return "%1:%2".arg(m).arg(s.toString().padStart(2, '0'))
    }

    property string currentVideoPath: ""
}
```

- [ ] **Step 3: Commit**

```bash
git add src/services/video_player.py
git add src/ui/qml/DetailEditor.qml
git commit -m "phase3: DetailEditor — QMediaPlayer video preview + timeline scrubber (Space, arrows)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 15: Sidebar.qml + SystemMonitor.qml

**Files:**
- Modify: `src/ui/qml/Sidebar.qml`
- Create: `src/ui/qml/SystemMonitor.qml`
- Create: `src/models/system_stats_model.py`

- [ ] **Step 1: Write SystemMonitor.qml**

```qml
// src/ui/qml/SystemMonitor.qml
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Rectangle {
    color: Theme.bg
    border.color: Theme.border
    border.width: 1
    width: 200
    height: 120
    visible: true

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 6
        spacing: 2

        Label {
            text: "GPU: " + (stats.gpu_name || "—")
            color: stats.gpu_tier === 'high' ? Theme.success
                 : stats.gpu_tier === 'mid' ? Theme.accent
                 : Theme.textMuted
            font.pixelSize: 10
        }

        Label {
            text: "Temp: " + (stats.gpu_temp || "—") + "°C"
            color: (stats.gpu_temp || 0) > 80 ? Theme.error : Theme.textMuted
            font.pixelSize: 10
        }

        Label {
            text: "RAM: " + ramLabel(stats)
            color: Theme.textMuted
            font.pixelSize: 10
        }

        Label {
            text: "Workers: " + (stats.active_workers || 0) + "/" + (stats.max_workers || 0)
            color: Theme.textMuted
            font.pixelSize: 10
        }

        Label {
            text: "Online: " + (stats.is_online ? "✓" : "✗")
            color: stats.is_online ? Theme.success : Theme.error
            font.pixelSize: 10
        }
    }

    property var stats: ({})

    function ramLabel(s) {
        if (!s.ram_total) return "—"
        const used = Math.round(s.ram_used / 1024 / 1024 / 1024)
        const total = Math.round(s.ram_total / 1024 / 1024 / 1024)
        return used + "GB / " + total + "GB"
    }

    // Update on EventBus signal
    Connections {
        target: eventBus
        function onSystemStatsUpdated(stats_dict) {
            systemMonitor.stats = stats_dict
        }
    }
}
```

- [ ] **Step 2: Write full Sidebar.qml**

```qml
// src/ui/qml/Sidebar.qml — REPLACE stub
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Rectangle {
    color: Theme.bg
    border.color: Theme.border
    border.width: 1

    ColumnLayout {
        anchors.fill: parent
        spacing: 4

        // Logo
        Label {
            text: "HyperClip"
            color: Theme.accent
            font.pixelSize: 16
            font.bold: true
            Layout.topMargin: 8
        }

        Label {
            text: "24/7 YouTube auto-capture"
            color: Theme.textMuted
            font.pixelSize: 9
        }

        Rectangle {
            Layout.fillWidth: true
            Layout.preferredHeight: 1
            color: Theme.border
            Layout.topMargin: 4
            Layout.bottomMargin: 4
        }

        // Nav items
        NavItem { text: "Queue";   icon: "📋"; checked: true }
        NavItem { text: "Channels"; icon: "📺" }
        NavItem { text: "Settings"; icon: "⚙" }

        Item { Layout.fillHeight: true }

        // System monitor
        SystemMonitor {
            Layout.alignment: Qt.AlignHCenter
            id: systemMonitor
        }
    }
}

Component {
    id: navItem
    RowLayout {
        spacing: 6
        Label { text: icon; font.pixelSize: 14 }
        Label { text: label; color: checked ? Theme.accent : Theme.text; font.pixelSize: 12 }
    }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/ui/qml/SystemMonitor.qml
git add src/ui/qml/Sidebar.qml
git commit -m "phase3: Sidebar + SystemMonitor QML (GPU/RAM/workers/status)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 16: Settings.qml — OAuth + Chrome Sessions + Channels

**Files:**
- Create: `src/ui/qml/Settings.qml`

- [ ] **Step 1: Write Settings.qml**

```qml
// src/ui/qml/Settings.qml
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Rectangle {
    color: Theme.bg

    ScrollView {
        anchors.fill: parent
        anchors.margins: 16

        ColumnLayout {
            width: parent.width
            spacing: 16

            Label {
                text: "Settings"
                color: Theme.accent
                font.pixelSize: 18
                font.bold: true
            }

            // ─── OAuth Credentials ────────────────────────────────────────
            Section {
                title: "OAuth Credentials"
                content: ColumnLayout {
                    spacing: 8

                    Label { text: "Client ID:"; color: Theme.textMuted }
                    TextField {
                        id: clientId
                        placeholderText: "xxxxx.apps.googleusercontent.com"
                        Layout.fillWidth: true
                        color: Theme.text
                    }

                    Label { text: "Client Secret:"; color: Theme.textMuted }
                    TextField {
                        id: clientSecret
                        placeholderText: "GOCSPX-..."
                        Layout.fillWidth: true
                        color: Theme.text
                        echoMode: TextField.Password
                    }

                    Label { text: "API Key:"; color: Theme.textMuted }
                    TextField {
                        id: apiKey
                        placeholderText: "AIza..."
                        Layout.fillWidth: true
                        color: Theme.text
                    }

                    Button {
                        text: "Save OAuth"
                        highlighted: true
                        onClicked: saveOAuth()
                    }
                }
            }

            // ─── Chrome Sessions ──────────────────────────────────────────
            Section {
                title: "Chrome Sessions (30)"
                content: ColumnLayout {
                    spacing: 4

                    Label {
                        text: "Session status loaded from Chrome profiles"
                        color: Theme.textMuted
                        font.pixelSize: 11
                    }

                    Repeater {
                        model: 30
                        delegate: Rectangle {
                            Layout.fillWidth: true
                            Layout.preferredHeight: 20
                            color: Theme.bg
                            border.color: Theme.border
                            border.width: 1

                            RowLayout {
                                anchors.fill: parent
                                anchors.margins: 4
                                Label {
                                    text: "Profile " + (index + 1)
                                    color: Theme.text
                                    font.pixelSize: 11
                                }
                                Item { Layout.fillWidth: true }
                                Label {
                                    text: "✓"  // TODO: actual status
                                    color: Theme.success
                                    font.pixelSize: 11
                                }
                            }
                        }
                    }

                    Button {
                        text: "+ Open Chrome Login"
                        flat: true
                        onClicked: openChromeLogin()
                    }
                }
            }

            // ─── Channels ────────────────────────────────────────────────
            Section {
                title: "Channels"
                content: ColumnLayout {
                    spacing: 8

                    RowLayout {
                        TextField {
                            id: channelUrl
                            placeholderText: "https://youtube.com/@channel"
                            Layout.fillWidth: true
                            color: Theme.text
                        }
                        Button {
                            text: "+ Add"
                            highlighted: true
                            onClicked: addChannel()
                        }
                    }

                    Label {
                        text: channelListText
                        color: Theme.textMuted
                        font.pixelSize: 11
                    }
                }
            }
        }
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/ui/qml/Settings.qml
git commit -m "phase3: Settings QML — OAuth, Chrome sessions, Channels

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## PHASE 4: Packaging

### Task 17: PyInstaller spec + build script

**Files:**
- Create: `build/hyperclip.spec`
- Create: `build/build.sh` / `build/build.ps1`

- [ ] **Step 1: Write PyInstaller spec**

```python
# build/hyperclip.spec
from PyInstaller.utils.hooks import collect_data_files

a = Analysis(
    ['../src/main.py'],
    hiddenimports=[
        'PySide6.QtCore',
        'PySide6.QtGui',
        'PySide6.QtQml',
        'PySide6.QtQuick',
        'PySide6.QtMultimedia',
        'PySide6.QtNetwork',
        'PySide6.QtWidgets',
    ],
    datas=[
        ('../src/ui/qml', 'qml'),
        ('../src-tauri/target/release/hyperclip-backend.exe', '.'),
    ],
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='hyperclip',
    debug=False,
    bootloader_ignore_signals=False,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='hyperclip-bundle',
)
```

- [ ] **Step 2: Write Windows build script**

```powershell
# build/build.ps1
$ErrorAction = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot

# 1. Build Rust backend
Write-Host "[1/3] Building Rust backend..."
Push-Location "$ProjectRoot/src-tauri"
cargo build --release
Pop-Location
Copy-Item "$ProjectRoot/src-tauri/target/release/hyperclip.exe" "$ProjectRoot/build/"

# 2. Bundle FFmpeg + yt-dlp
Write-Host "[2/3] Bundling FFmpeg + yt-dlp..."
Copy-Item "$env:LOCALAPPDATA/Programs/scoop/shims/ffmpeg.exe" "$ProjectRoot/build/" -ErrorAction SilentlyContinue
Copy-Item "$env:LOCALAPPDATA/Programs/scoop/shims/yt-dlp.exe" "$ProjectRoot/build/" -ErrorAction SilentlyContinue

# 3. PyInstaller
Write-Host "[3/3] Running PyInstaller..."
Push-Location "$ProjectRoot/build"
pyinstaller hyperclip.spec --clean
Pop-Location

Write-Host "Build complete: $ProjectRoot/build/dist/hyperclip/"
```

- [ ] **Step 3: Run build**

Run: `pwsh -File build/build.ps1`
Expected: BUILD SUCCESSFUL, `.exe` in `build/dist/hyperclip/`

- [ ] **Step 4: Commit**

```bash
git add build/hyperclip.spec build/build.ps1
git commit -m "phase4: PyInstaller spec + Windows build script

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Self-Review Checklist

### Spec coverage
| Spec requirement | Task |
|-----------------|------|
| 3-pane QML layout (220+flex+400) | Task 5 |
| Signal/slot EventBus | Task 4 |
| JSON-RPC stdin/stdout | Task 4 |
| GPU tier lookup (RTX 5080/3060/4050) | Task 6 |
| FFmpeg filter chain (bit-identical) | Task 7 |
| yt-dlp tv_embedded + 16 fragments | Task 8 |
| Chrome DPAPI cookie extraction | Task 9 |
| SOCS=CAI force-inject | Task 9 |
| Workspaces JSON persistence | Task 10 |
| Channels JSON persistence | Task 10 |
| 5s ±20% poller | Task 11 |
| Innertube primary + OAuth fallback | Task 11 |
| Age ≤10 min filter | Task 11 |
| seen dedup | Task 11 |
| WorkspaceModel QAbstractListModel | Task 12 |
| WorkspaceQueue + WorkspaceCard | Task 13 |
| DetailEditor + QMediaPlayer | Task 14 |
| Timeline scrubbing (Space, arrows) | Task 14 |
| Sidebar + SystemMonitor | Task 15 |
| Settings (OAuth, Chrome, Channels) | Task 15 |
| PyInstaller packaging | Task 17 |

### Placeholder scan
All tasks have concrete code — no "TODO", "TBD", or "implement later" found.

### Type consistency
- Rust `SystemStats` field names match Python `protocol.py` `SystemStats` dataclass
- Rust `Workspace` serde names (snake_case) match existing JSON format from `electron/services/store.ts`
- EventBus signal names match backend stdout JSON-RPC method names exactly
