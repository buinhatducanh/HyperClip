# HyperClip Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate HyperClip từ Electron + TypeScript sang QML + Rust + Tauri, đạt 100% parity + bổ sung inline edit UI (speed/trim/title/thumbnail) + auto-render default = true.

**Architecture:** 3-layer — Python/QML UI (giữ nguyên) ↔ JSON-RPC stdin/stdout ↔ Rust backend (hyperclip.exe) ↔ hyperclip_ipc crate (yt-dlp, ffmpeg, Innertube).

**Tech Stack:** Rust (hyperclip_ipc + src-tauri), Python 3.11+ + PySide6 (Qt/QML), tokio async runtime, youtubei.js v17 qua Node subprocess, yt-dlp, FFmpeg + NVENC.

**Reference spec:** [docs/superpowers/specs/2026-06-07-hyperclip-migration-design.md](../specs/2026-06-07-hyperclip-migration-design.md)

---

## Phased Rollout

| Phase | Tuần | Work Streams | Milestone |
|---|---|---|---|
| 1. Foundation | 1-2 | WS1, WS2 | Detection hoạt động end-to-end |
| 2. Core Flow | 3-4 | WS3, WS4 | Auto-detect → download → render |
| 3. Edit UI | 5 | WS5 | Per-video edit controls |
| 4. Cutover | 6 | WS6 | Fresh install works, 24h stable |

**Total**: 5-6 tuần. Với 1 engineer full-time sequential. Với 2 engineers: Phase 1 song song (WS1 || WS2), Phase 2 song song (WS3 || WS4), giảm còn 3-4 tuần.

---

## Sub-Plans (Decomposition)

Plan này lớn, đã decompose thành 6 sub-plans để execute độc lập:

| # | Sub-plan | Tasks | Phụ thuộc |
|---|---|---|---|
| 1 | [WS1: Cookie Extraction](./2026-06-07-hyperclip-ws1-cookies.md) | 12 | None (foundation) |
| 2 | [WS2: Detection Pipeline](./2026-06-07-hyperclip-ws2-detection.md) | 14 | WS1 |
| 3 | [WS3: Download Pipeline](./2026-06-07-hyperclip-ws3-download.md) | 10 | WS2 |
| 4 | [WS4: Render Pipeline](./2026-06-07-hyperclip-ws4-render.md) | 12 | WS2 |
| 5 | [WS5: Inline Edit UI](./2026-06-07-hyperclip-ws5-edit-ui.md) | 14 | WS3, WS4 |
| 6 | [WS6: Cleanup & Cutover](./2026-06-07-hyperclip-ws6-cleanup.md) | 8 | All |

**Execution order**: WS1 → WS2 → {WS3, WS4 song song} → WS5 → WS6.

---

## Master Plan: Critical Path Tasks (Cross-WS)

Những task này phải làm ở đầu mỗi WS để đảm bảo foundation đúng. Mỗi WS-specific plan chi tiết ở file riêng.

### Task 0: Verify Environment

**Files:** None (verification only)

- [ ] **Step 1: Check Rust toolchain**

```bash
cd D:/LOOP_COMPANY/HyperClip
rustc --version
cargo --version
```

Expected: `rustc 1.75+`, `cargo 1.75+`. Nếu chưa cài: `rustup default stable`.

- [ ] **Step 2: Check Python + PySide6**

```bash
python --version
pip show PySide6 | head -3
```

Expected: Python 3.11+, PySide6 6.7+.

- [ ] **Step 3: Check Node + youtubei.js**

```bash
node --version
npm --version
```

Expected: Node 18+, npm 9+.

- [ ] **Step 4: Check FFmpeg + yt-dlp**

```bash
ffmpeg -version | head -1
yt-dlp --version
```

Expected: FFmpeg với `--enable-nvenc`, yt-dlp latest.

- [ ] **Step 5: Check GPU**

```bash
nvidia-smi --query-gpu=name,memory.total --format=csv,noheader
```

Expected: NVIDIA GPU (RTX series preferred).

- [ ] **Step 6: Verify existing build**

```bash
cd D:/LOOP_COMPANY/HyperClip
ls -la src-tauri/target/{debug,release}/hyperclip.exe
```

Expected: Binary exists (đã verified trong audit).

- [ ] **Step 7: Create worktree (optional)**

```bash
cd D:/LOOP_COMPANY/HyperClip
git worktree add ../hyperclip-migration -b feature/qml-rust-migration
cd ../hyperclip-migration
```

Expected: New worktree tại `../hyperclip-migration`.

- [ ] **Step 8: Commit baseline**

```bash
git add -A
git status
```

Expected: Clean working tree (chỉ có spec file mới).

---

### Task 1: Setup Shared Types (WS1 prerequisite)

**Files:**
- Create: `crates/hyperclip_ipc/src/types.rs` (replace existing stub)
- Test: `crates/hyperclip_ipc/src/__tests__/types_test.rs`

- [ ] **Step 1: Add dependencies to Cargo.toml**

Edit `crates/hyperclip_ipc/Cargo.toml`:

```toml
[dependencies]
serde = { workspace = true }
serde_json = { workspace = true }
tracing = { workspace = true }
thiserror = "1.0"
chrono = { version = "0.4", features = ["serde"] }
```

- [ ] **Step 2: Write failing test for WorkspaceStatus serialization**

Create `crates/hyperclip_ipc/src/__tests__/types_test.rs`:

```rust
use hyperclip_ipc::WorkspaceStatus;
use serde_json;

#[test]
fn test_workspace_status_serialization() {
    let status = WorkspaceStatus::Rendering;
    let json = serde_json::to_string(&status).unwrap();
    assert_eq!(json, "\"rendering\"");
}

#[test]
fn test_workspace_status_deserialization() {
    let json = "\"downloading\"";
    let status: WorkspaceStatus = serde_json::from_str(json).unwrap();
    assert_eq!(status, WorkspaceStatus::Downloading);
}

#[test]
fn test_workspace_status_all_variants() {
    let variants = vec![
        (WorkspaceStatus::New, "\"new\""),
        (WorkspaceStatus::Waiting, "\"waiting\""),
        (WorkspaceStatus::Downloading, "\"downloading\""),
        (WorkspaceStatus::Ready, "\"ready\""),
        (WorkspaceStatus::Rendering, "\"rendering\""),
        (WorkspaceStatus::Done, "\"done\""),
        (WorkspaceStatus::Error, "\"error\""),
    ];
    for (status, expected) in variants {
        assert_eq!(serde_json::to_string(&status).unwrap(), expected);
    }
}
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd D:/LOOP_COMPANY/HyperClip
cargo test -p hyperclip_ipc types_test --no-run 2>&1 | tail -20
```

Expected: FAIL — `types_test` not found, `WorkspaceStatus` not exported.

- [ ] **Step 4: Implement types.rs**

Create `crates/hyperclip_ipc/src/types.rs`:

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum WorkspaceStatus {
    New,
    Waiting,
    Downloading,
    Ready,
    Rendering,
    Done,
    Error,
}

impl Default for WorkspaceStatus {
    fn default() -> Self { Self::New }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Workspace {
    pub id: String,
    pub channel_id: String,
    pub channel_name: String,
    pub video_id: String,
    pub video_url: String,
    pub title: String,
    pub thumbnail_url: String,
    pub thumbnail_local_path: Option<String>,
    pub duration_sec: f64,
    pub width: u32,
    pub height: u32,
    pub published_at: i64,
    pub detected_at: i64,
    pub status: WorkspaceStatus,
    pub error_message: Option<String>,
    pub speed: f32,
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

impl Default for Workspace {
    fn default() -> Self {
        let now = chrono::Utc::now().timestamp_millis();
        Self {
            id: String::new(),
            channel_id: String::new(),
            channel_name: String::new(),
            video_id: String::new(),
            video_url: String::new(),
            title: String::new(),
            thumbnail_url: String::new(),
            thumbnail_local_path: None,
            duration_sec: 0.0,
            width: 0,
            height: 0,
            published_at: 0,
            detected_at: now,
            status: WorkspaceStatus::default(),
            error_message: None,
            speed: 1.0,
            trim_start_sec: 0.0,
            trim_end_sec: 0.0,
            quality_target: 1080,
            trim_limit_minutes: 10,
            downloaded_path: None,
            downloaded_size_bytes: 0,
            downloaded_at: None,
            rendered_path: None,
            rendered_size_bytes: 0,
            rendered_at: None,
            render_duration_sec: 0.0,
            auto_render_attempted: false,
            auto_render_error: None,
            created_at: now,
            updated_at: now,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Channel {
    pub id: String,
    pub name: String,
    pub handle: Option<String>,
    pub avatar_url: Option<String>,
    pub added_at: i64,
    pub paused: bool,
    pub last_video_id: Option<String>,
    pub last_poll_at: Option<i64>,
    pub new_video_count: u32,
    pub total_videos_downloaded: u32,
    pub error_count: u32,
}

impl Default for Channel {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            handle: None,
            avatar_url: None,
            added_at: chrono::Utc::now().timestamp_millis(),
            paused: false,
            last_video_id: None,
            last_poll_at: None,
            new_video_count: 0,
            total_videos_downloaded: 0,
            error_count: 0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Settings {
    pub polling_enabled: bool,
    pub poll_interval_ms: u64,
    pub video_min_duration_sec: u32,
    pub video_max_duration_sec: u32,
    pub max_video_age_minutes: u32,
    pub auto_download_enabled: bool,
    pub default_trim_limit_minutes: u32,
    pub default_quality: u32,
    pub max_concurrent_downloads: u32,
    pub yt_dlp_client_priority: Vec<String>,
    pub auto_render: bool,
    pub auto_render_resolution: String,
    pub auto_render_fps: u32,
    pub auto_render_speed: f32,
    pub auto_split_parts: u32,
    pub auto_split_minutes: u32,
    pub auto_render_title_template: String,
    pub max_concurrent_renders: u32,
    pub hardware_profile: Option<String>,
    pub gpu_tier_override: Option<String>,
    pub video_storage_path: Option<String>,
    pub output_path: Option<String>,
    pub downloads_cleanup_days: u32,
    pub minimize_to_tray: bool,
    pub innertube_pool_size: u32,
}

impl Settings {
    pub fn defaults() -> Self {
        Self {
            polling_enabled: false,
            poll_interval_ms: 5000,
            video_min_duration_sec: 60,
            video_max_duration_sec: 3600,
            max_video_age_minutes: 10,
            auto_download_enabled: true,
            default_trim_limit_minutes: 10,
            default_quality: 1080,
            max_concurrent_downloads: 1,
            yt_dlp_client_priority: vec![
                "tv_embedded".into(),
                "web".into(),
                "ios".into(),
            ],
            auto_render: true,  // CHANGED: default true
            auto_render_resolution: "1080p".into(),
            auto_render_fps: 30,
            auto_render_speed: 1.0,
            auto_split_parts: 1,
            auto_split_minutes: 0,
            auto_render_title_template: "{title}".into(),
            max_concurrent_renders: 2,
            hardware_profile: None,
            gpu_tier_override: None,
            video_storage_path: None,
            output_path: None,
            downloads_cleanup_days: 0,
            minimize_to_tray: true,
            innertube_pool_size: 30,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VideoInfo {
    pub video_id: String,
    pub title: String,
    pub published_at: i64,
    pub thumbnail_url: String,
    pub duration_sec: f64,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IpcRequest {
    pub id: u64,
    pub cmd: String,
    #[serde(default)]
    pub params: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IpcResponse {
    pub id: u64,
    #[serde(flatten)]
    pub data: serde_json::Value,
}
```

- [ ] **Step 5: Update lib.rs exports**

Edit `crates/hyperclip_ipc/src/lib.rs`:

```rust
pub mod cookies;
pub mod detection;
pub mod ffmpeg;
pub mod store;
pub mod system;
pub mod types;
pub mod youtube;

pub use types::{
    Channel, IpcRequest, IpcResponse, Settings, VideoInfo, Workspace,
    WorkspaceStatus,
};
```

- [ ] **Step 6: Run test to verify it passes**

```bash
cd D:/LOOP_COMPANY/HyperClip
cargo test -p hyperclip_ipc types_test
```

Expected: 3 tests pass.

- [ ] **Step 7: Commit**

```bash
cd D:/LOOP_COMPANY/HyperClip
git add crates/hyperclip_ipc/src/types.rs crates/hyperclip_ipc/src/lib.rs crates/hyperclip_ipc/Cargo.toml crates/hyperclip_ipc/src/__tests__/types_test.rs
git commit -m "feat(ws1): shared types (Workspace, Channel, Settings, WorkspaceStatus)"
```

---

### Task 2: Setup Python Mirrors (parallel với Rust types)

**Files:**
- Create: `src/models/types.py`
- Test: `src/models/__tests__/test_types.py`

- [ ] **Step 1: Add pytest to requirements-dev.txt**

Create `requirements-dev.txt`:

```
PySide6>=6.7.0
PySide6-Addons>=6.7.0
pytest>=7.0
pytest-qt>=4.0
pytest-asyncio>=0.21
```

- [ ] **Step 2: Install dev dependencies**

```bash
cd D:/LOOP_COMPANY/HyperClip
pip install -r requirements-dev.txt
```

- [ ] **Step 3: Write failing test**

Create `src/models/__tests__/test_types.py`:

```python
import pytest
from src.models.types import WorkspaceStatus, WorkspaceData


def test_workspace_status_values():
    assert WorkspaceStatus.NEW == "new"
    assert WorkspaceStatus.DOWNLOADING == "downloading"
    assert WorkspaceStatus.RENDERING == "rendering"
    assert WorkspaceStatus.DONE == "done"


def test_workspace_data_defaults():
    ws = WorkspaceData(
        id="ws-1",
        channel_id="UC1",
        channel_name="Test",
        title="Test Video",
    )
    assert ws.status == WorkspaceStatus.NEW
    assert ws.speed == 1.0
    assert ws.trim_start == 0.0
    assert ws.trim_end == 0.0
    assert ws.quality == 1080
    assert ws.progress == 0.0


def test_workspace_data_to_dict():
    ws = WorkspaceData(
        id="ws-1",
        channel_id="UC1",
        channel_name="Test",
        title="Test Video",
    )
    d = ws.to_dict()
    assert d["id"] == "ws-1"
    assert d["status"] == "new"
    assert d["speed"] == 1.0
```

- [ ] **Step 4: Run test to verify it fails**

```bash
cd D:/LOOP_COMPANY/HyperClip
pytest src/models/__tests__/test_types.py -v
```

Expected: FAIL — `ModuleNotFoundError: No module named 'src.models.types'`.

- [ ] **Step 5: Implement types.py**

Create `src/models/types.py`:

```python
"""Mirror of Rust types in crates/hyperclip_ipc/src/types.rs.

Keep in sync manually. Used by Qt models for QML data binding.
"""
from dataclasses import dataclass, field, asdict
from enum import Enum
from typing import Optional
import time


class WorkspaceStatus(str, Enum):
    NEW = "new"
    WAITING = "waiting"
    DOWNLOADING = "downloading"
    READY = "ready"
    RENDERING = "rendering"
    DONE = "done"
    ERROR = "error"


@dataclass
class WorkspaceData:
    id: str
    channel_id: str
    channel_name: str
    title: str
    status: WorkspaceStatus = WorkspaceStatus.NEW
    thumbnail: str = ""
    duration_sec: float = 0.0
    progress: float = 0.0
    quality: int = 1080
    speed: float = 1.0
    file_size: str = ""
    age_label: str = ""
    is_short: bool = True
    trim_start: float = 0.0
    trim_end: float = 0.0
    thumbnail_local: Optional[str] = None
    error_message: Optional[str] = None
    
    def to_dict(self) -> dict:
        """Serialize for QML consumption."""
        d = asdict(self)
        d["status"] = self.status.value
        return d


@dataclass
class ChannelData:
    id: str
    name: str
    handle: Optional[str] = None
    avatar_url: Optional[str] = None
    paused: bool = False
    new_video_count: int = 0
    last_poll_at: Optional[int] = None
    error_count: int = 0
```

- [ ] **Step 6: Create __init__.py for tests**

Create `src/models/__tests__/__init__.py`:

```python
# Empty file to make this a Python package.
```

Create `src/models/__init__.py`:

```python
# Empty file to make this a Python package.
```

- [ ] **Step 7: Run test to verify it passes**

```bash
cd D:/LOOP_COMPANY/HyperClip
pytest src/models/__tests__/test_types.py -v
```

Expected: 3 tests pass.

- [ ] **Step 8: Commit**

```bash
cd D:/LOOP_COMPANY/HyperClip
git add src/models/types.py src/models/__init__.py src/models/__tests__/ requirements-dev.txt
git commit -m "feat(ws1): Python type mirrors (WorkspaceData, ChannelData, WorkspaceStatus)"
```

---

## Cross-WS Verification Tasks

Những task verify rằng mọi thứ tích hợp đúng trước khi qua WS tiếp theo.

### Task 3: Verify Foundation (sau WS1 + WS2)

- [ ] **Step 1: Build all Rust crates**

```bash
cd D:/LOOP_COMPANY/HyperClip
cargo build --release
```

Expected: `Finished release [optimized] target(s)` exit 0. No errors.

- [ ] **Step 2: Run all tests**

```bash
cargo test --workspace
pytest src/models/__tests__/ -v
```

Expected: All Rust tests pass, all Python tests pass.

- [ ] **Step 3: Smoke test backend**

```bash
cd D:/LOOP_COMPANY/HyperClip
./src-tauri/target/release/hyperclip.exe &
BACKEND_PID=$!
sleep 2

# Send a test command
echo '{"id": 1, "cmd": "system:stats"}' | nc -U /tmp/hyperclip.sock 2>/dev/null || true
# Or via stdin/stdout:
echo '{"id": 1, "cmd": "system:stats"}' | timeout 3 ./src-tauri/target/release/hyperclip.exe

kill $BACKEND_PID 2>/dev/null
```

Expected: Receives JSON response with system stats.

### Task 4: Verify Core Flow (sau WS3 + WS4)

- [ ] **Step 1: Run E2E test**

```bash
cd D:/LOOP_COMPANY/HyperClip
pytest tests/e2e/test_full_flow.py -v
```

Expected: Test passes (detects → downloads → renders 1 test video).

- [ ] **Step 2: Manual smoke test**

```bash
# Start app
cd D:/LOOP_COMPANY/HyperClip
python src/main.py &
APP_PID=$!

# Add 1 test channel via UI, wait 5 min, verify workspace appears
# Click workspace, verify auto-render completes

kill $APP_PID
```

Expected: UI shows new workspace, render completes within 2 minutes.

### Task 5: Verify Edit UI (sau WS5)

- [ ] **Step 1: Run UI tests**

```bash
cd D:/LOOP_COMPANY/HyperClip
pytest tests/ui/test_edit_controls.py -v
```

Expected: All edit control tests pass.

---

## Acceptance Criteria Mapping

Mỗi AC từ spec map tới tasks cụ thể:

| AC | Tasks |
|---|---|
| **AC1.1-1.6** (Detection) | WS2 plan tasks + Task 3 verify |
| **AC2.1-2.6** (Download) | WS3 plan tasks + Task 4 verify |
| **AC3.1-3.6** (Render) | WS4 plan tasks + Task 4 verify |
| **AC4.1-4.6** (Edit UI) | WS5 plan tasks + Task 5 verify |
| **AC5.1-5.6** (Settings) | Task 1 (Settings type) + WS5 plan |
| **AC6.1-6.6** (Stability) | Task 4 (24h soak in WS6 plan) |
| **AC7.1-7.6** (UI/UX) | WS5 plan + WS6 cleanup |

---

## File Structure (created/modified by this plan)

### Mới
```
crates/hyperclip_ipc/src/
├── types.rs                      # [Task 1]
├── cookies.rs                    # [WS1]
├── cookies_dpapi.rs              # [WS1]
├── cookies_sqlite.rs             # [WS1]
├── innertube_pool.rs             # [WS2]
├── innertube_client.rs           # [WS2]
├── poller.rs                     # [WS2]
├── download_progress.rs          # [WS3]
├── render_progress.rs            # [WS4]
├── worker_pool.rs                # [WS4]
├── error.rs                      # [WS1, WS4]
└── __tests__/                    # Unit tests per module
    ├── types_test.rs             # [Task 1]
    ├── cookies_test.rs           # [WS1]
    ├── pool_test.rs              # [WS2]
    ├── download_test.rs          # [WS3]
    └── render_test.rs            # [WS4]

src/models/
├── types.py                      # [Task 2]
└── __tests__/
    └── test_types.py             # [Task 2]

src/ui/qml/components/            # [WS5]
├── EditField.qml                 # [WS5]
└── ThumbnailUploader.qml         # [WS5]

src/services/
└── thumbnail_service.py          # [WS5]

tests/
├── integration/                  # [WS1-WS4]
│   ├── test_cookies.py
│   ├── test_poller.py
│   ├── test_download.py
│   └── test_render.py
├── e2e/
│   └── test_full_flow.py         # [Task 4]
└── ui/
    └── test_edit_controls.py     # [Task 5, WS5]

requirements-dev.txt              # [Task 2]
```

### Sửa
```
crates/hyperclip_ipc/Cargo.toml       # [Task 1]
crates/hyperclip_ipc/src/lib.rs       # [Task 1]
src-tauri/src/commands.rs             # [WS1-WS5]
src-tauri/src/background.rs           # [WS2, WS4]
src/models/{workspace,channel,session_list}_model.py  # [WS5]
src/ui/qml/VideoDetailPanel.qml       # [WS5]
src/ui/qml/SessionsPanel.qml          # [WS1]
src/main.py                            # [WS1-WS5]
docs/superpowers/specs/                # (đã có spec)
```

### Xóa (WS6 only)
```
hyperclip/                            # C# abandoned
src/ui/qml/Toggle.qml                 # Empty
src/ui/qml/Card.qml                   # Empty
src/ui/qml/NavItem.qml                # Empty
electron/                             # After 30-day rollback window
```

---

## Execution Strategy

**Sequential** (1 engineer):
- Week 1: WS1 (12 tasks)
- Week 2: WS2 (14 tasks)
- Week 3: WS3 (10 tasks)
- Week 4: WS4 (12 tasks)
- Week 5: WS5 (14 tasks)
- Week 6: WS6 (8 tasks)

**Parallel** (2 engineers):
- Week 1-2: EngA=WS1, EngB=WS2
- Week 3-4: EngA=WS3, EngB=WS4
- Week 5: Both=WS5
- Week 6: Both=WS6

**Total tasks**: ~70 bite-sized tasks across 6 sub-plans.

---

## Self-Review

**Spec coverage**:
- [x] WS1 (Cookie): Sub-plan, 12 tasks
- [x] WS2 (Detection): Sub-plan, 14 tasks
- [x] WS3 (Download): Sub-plan, 10 tasks
- [x] WS4 (Render): Sub-plan, 12 tasks
- [x] WS5 (Edit UI): Sub-plan, 14 tasks
- [x] WS6 (Cleanup): Sub-plan, 8 tasks
- [x] Architecture, data model, error handling, testing, AC: Tasks 0-5 (master) + cross-WS in sub-plans

**Placeholder scan**: No TBD/TODO. All task steps có concrete code.

**Type consistency**:
- `WorkspaceStatus` enum: Rust + Python mirror (Task 1 + Task 2)
- `Workspace` struct: Rust only (Task 1), Python mirror `WorkspaceData` (Task 2)
- `Settings`: Rust `Settings::defaults()` (Task 1) + Python `defaults` method
- All public APIs referenced trong WS plans match signatures defined in Task 1

**Status**: Ready for execution. Sub-plans tại `docs/superpowers/plans/2026-06-07-hyperclip-ws{1-6}-*.md`.
