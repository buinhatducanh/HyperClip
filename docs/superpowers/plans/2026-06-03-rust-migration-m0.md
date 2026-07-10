# HyperClip Rust Migration — M0 Plan (Tauri Scaffold + Read Workspaces)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bootstrap Tauri 2.x desktop app on the `migrate` branch, delete the failed WPF migration, create Rust crates `hyperclip-core` and `hyperclip-store`, expose a `workspace_list` Tauri command, and rewrite the frontend `ipc.ts` shim so the app boots and lists existing workspaces from `.hyperclip/workspaces.json`.

**Architecture:** Tauri 2.x shell hosts a static-exported Next.js frontend (no Next.js server). The Rust backend is split into 12 crate stubs in a Cargo workspace; M0 only populates `hyperclip-core` (types), `hyperclip-store` (JSON persistence), and the main Tauri command handler. IPC contract is 1:1 with the existing `window.electronAPI` surface — `src/app/lib/ipc.ts` becomes a thin wrapper around `@tauri-apps/api/core::invoke` and `@tauri-apps/api/event::listen` with the same exported function names.

**Tech Stack:**
- Tauri 2.x + WebView2 (Windows)
- Rust 2021 edition, stable toolchain
- `tokio` (multi-thread async runtime)
- `serde` + `serde_json` (Workspace persistence)
- `thiserror` (typed errors)
- `tracing` + `tracing-subscriber` (logging, used from M1 onward)
- `chrono` (timestamps for serde)
- `@tauri-apps/api` 2.x (frontend)

**Spec reference:** [docs/superpowers/specs/2026-06-03-rust-migration-design.md](docs/superpowers/specs/2026-06-03-rust-migration-design.md) sections 3.1, 4, 5, 7, 8.

**Out of scope (deferred to later milestones):**
- M1+: system stats, yt-dlp, FFmpeg, cookies, auth, innertube, detect, project, health
- M9: deletion of `electron/` directory and final package.json cleanup

---

## File Structure (after M0)

```
HyperClip/
├── src/                                  [unchanged for M0 — only ipc.ts shim]
│   ├── app/
│   │   ├── lib/
│   │   │   ├── ipc.ts                    [MODIFIED — Tauri shim]
│   │   │   └── store.ts                  (untouched, reads via ipc.workspaceList())
│   │   └── types.ts                      (untouched, TS-side types)
│   ├── tauri.d.ts                        [NEW — Tauri API typings]
│   └── ...
├── src-tauri/                            [NEW]
│   ├── Cargo.toml                        [NEW — Cargo workspace root]
│   ├── tauri.conf.json                   [NEW]
│   ├── build.rs                          [NEW — Tauri build]
│   ├── icons/                            [NEW — Tauri icons]
│   ├── src/
│   │   ├── main.rs                       [NEW — Tauri bootstrap]
│   │   └── lib.rs                        [NEW — run() entry]
│   └── crates/
│       ├── hyperclip-core/               [NEW]
│       │   ├── Cargo.toml
│       │   ├── src/
│       │   │   ├── lib.rs
│       │   │   ├── workspace.rs          (WorkspaceData serde)
│       │   │   ├── channel.rs            (StoredChannel serde)
│       │   │   ├── error.rs              (CoreError + Result type)
│       │   │   └── paths.rs              (store path resolution)
│       │   └── tests/
│       │       └── workspace_serde.rs
│       ├── hyperclip-store/              [NEW]
│       │   ├── Cargo.toml
│       │   ├── src/
│       │   │   ├── lib.rs
│       │   │   ├── workspaces.rs         (load/save)
│       │   │   ├── channels.rs           (load/save channels)
│       │   │   └── fixtures/             (test data)
│       │   │       └── sample_workspaces.json
│       │   └── tests/
│       │       └── workspaces_roundtrip.rs
│       └── hyperclip-ipc/                [NEW — empty stub for now]
│           ├── Cargo.toml
│           └── src/lib.rs                (re-export module path for future)
├── hyperclip/                            [DELETED — WPF artifacts]
├── package.json                          [MODIFIED — add @tauri-apps/api]
└── next.config.mjs                       [MODIFIED — output: 'export']
```

---

## Task 1: Verify Rust toolchain and install Tauri CLI

**Files:** None (host-level install)

- [ ] **Step 1: Check Rust is installed**

Run: `rustc --version && cargo --version`
Expected: Both print versions, e.g. `rustc 1.83.0 (stable)` and `cargo 1.83.0`. If not, install via `rustup` from https://rustup.rs/ (use stable toolchain).

- [ ] **Step 2: Add Windows MSVC target**

Run: `rustup target add x86_64-pc-windows-msvc`
Expected: `info: component 'rust-std' for target 'x86_64-pc-windows-msvc' is installed` (or "up to date").

- [ ] **Step 3: Install tauri-cli 2.x**

Run: `cargo install tauri-cli --version "^2.0" --locked`
Expected: Installs `tauri-cli` to `%USERPROFILE%\.cargo\bin\tauri.exe`. Long-running (1-3 minutes).

- [ ] **Step 4: Verify tauri CLI works**

Run: `cargo tauri --version`
Expected: `tauri-cli 2.x.x`.

- [ ] **Step 5: Verify WebView2 is installed**

Run: `reg query "HKLM\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" /v pv` (PowerShell: `Get-ItemProperty 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'`). On Win 11 it's pre-installed; on older systems, run the standalone installer from `https://developer.microsoft.com/en-us/microsoft-edge/webview2/`.

---

## Task 2: Delete failed WPF migration folder

**Files:**
- Delete: `hyperclip/` (C# project artifacts)

- [ ] **Step 1: Confirm WPF folder contents are only build artifacts**

Run: `git ls-files hyperclip/ | grep -v "bin/" | grep -v "obj/" | head -5`
Expected: **empty** — confirms no .cs source files are tracked. (Earlier exploration showed this is the case.)

- [ ] **Step 2: Remove folder from disk and git index**

Run:
```bash
git rm -r hyperclip/
rm -rf hyperclip/
```
Expected: `rm 'hyperclip/...'` lines for all 709 files. No errors.

- [ ] **Step 3: Commit the deletion**

Run:
```bash
git commit -m "chore: remove failed WPF migration artifacts

WPF Phases 1-8 commits were created but only bin/obj build outputs
were ever committed — no .cs source files existed. Folder is being
removed before the Rust/Tauri migration to avoid confusion."
```
Expected: New commit on `migrate` branch. ~709 deletions.

---

## Task 3: Create Cargo workspace root

**Files:**
- Create: `src-tauri/Cargo.toml`

- [ ] **Step 1: Create src-tauri directory**

Run: `mkdir -p src-tauri`
Expected: Directory created.

- [ ] **Step 2: Write workspace Cargo.toml**

Create `src-tauri/Cargo.toml`:

```toml
[workspace]
resolver = "2"
members = [
    "crates/hyperclip-core",
    "crates/hyperclip-store",
    "crates/hyperclip-ipc",
]
exclude = []

[workspace.package]
version = "0.1.0"
edition = "2021"
rust-version = "1.75"
license = "Proprietary"

[workspace.dependencies]
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
thiserror = "1.0"
chrono = { version = "0.4", features = ["serde"] }
tokio = { version = "1.40", features = ["full"] }
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter"] }

hyperclip-core = { path = "crates/hyperclip-core" }
hyperclip-store = { path = "crates/hyperclip-store" }
hyperclip-ipc = { path = "crates/hyperclip-ipc" }
```

- [ ] **Step 3: Verify the workspace parses**

Run: `cd src-tauri && cargo check --workspace 2>&1 | tail -10`
Expected: `error: no Cargo.toml files found in workspace` (because no crate dirs exist yet — this is expected, fix in next tasks).

---

## Task 4: Create hyperclip-core crate

**Files:**
- Create: `src-tauri/crates/hyperclip-core/Cargo.toml`
- Create: `src-tauri/crates/hyperclip-core/src/lib.rs`
- Create: `src-tauri/crates/hyperclip-core/src/error.rs`
- Create: `src-tauri/crates/hyperclip-core/src/paths.rs`
- Create: `src-tauri/crates/hyperclip-core/src/workspace.rs`
- Create: `src-tauri/crates/hyperclip-core/src/channel.rs`
- Create: `src-tauri/crates/hyperclip-core/tests/workspace_serde.rs`

- [ ] **Step 1: Create crate directory structure**

Run: `mkdir -p src-tauri/crates/hyperclip-core/src src-tauri/crates/hyperclip-core/tests`
Expected: Directories created.

- [ ] **Step 2: Write Cargo.toml for hyperclip-core**

Create `src-tauri/crates/hyperclip-core/Cargo.toml`:

```toml
[package]
name = "hyperclip-core"
version.workspace = true
edition.workspace = true
rust-version.workspace = true
license.workspace = true

[dependencies]
serde.workspace = true
serde_json.workspace = true
thiserror.workspace = true
chrono.workspace = true
```

- [ ] **Step 3: Write error.rs (TDD — first test the types compile)**

Create `src-tauri/crates/hyperclip-core/src/error.rs`:

```rust
use std::path::PathBuf;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum CoreError {
    #[error("I/O error at {path}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },

    #[error("JSON parse error in {path}: {source}")]
    Json {
        path: PathBuf,
        #[source]
        source: serde_json::Error,
    },

    #[error("Entity not found: {entity} with id {id}")]
    NotFound { entity: &'static str, id: String },

    #[error("Path not configured: {0}")]
    UnconfiguredPath(&'static str),
}

pub type Result<T> = std::result::Result<T, CoreError>;
```

- [ ] **Step 4: Write paths.rs**

Create `src-tauri/crates/hyperclip-core/src/paths.rs`:

```rust
use crate::error::{CoreError, Result};
use std::path::PathBuf;

const APP_DIR_NAME: &str = "HyperClip";

/// Resolve the app data directory: %APPDATA%/HyperClip on Windows.
pub fn app_data_dir() -> Result<PathBuf> {
    let base = std::env::var_os("APPDATA")
        .ok_or(CoreError::UnconfiguredPath("APPDATA env var"))?;
    Ok(PathBuf::from(base).join(APP_DIR_NAME))
}

/// Resolve the store dir: <app_data_dir>/.hyperclip (mirrors Electron layout).
pub fn store_dir() -> Result<PathBuf> {
    Ok(app_data_dir()?.join(".hyperclip"))
}

/// Path to the workspaces.json file.
pub fn workspaces_file() -> Result<PathBuf> {
    Ok(store_dir()?.join("workspaces.json"))
}

/// Path to the channels.json file.
pub fn channels_file() -> Result<PathBuf> {
    Ok(store_dir()?.join("channels.json"))
}

/// Path to the subscriptions.json file (legacy / WebSub — empty in current builds).
pub fn subscriptions_file() -> Result<PathBuf> {
    Ok(store_dir()?.join("subscriptions.json"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn workspaces_file_is_under_store_dir() {
        let store = store_dir().expect("store dir");
        let ws = workspaces_file().expect("workspaces file");
        assert!(ws.starts_with(&store));
        assert!(ws.ends_with("workspaces.json"));
    }
}
```

- [ ] **Step 5: Write workspace.rs (mirror the existing TypeScript shape)**

Create `src-tauri/crates/hyperclip-core/src/workspace.rs`:

```rust
use serde::{Deserialize, Serialize};

/// Mirror of `WorkspaceData` from `electron/services/store.ts`.
/// IMPORTANT: field order and JSON shape match the existing file on disk.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WorkspaceData {
    pub id: String,
    pub channelId: String,
    pub channelName: String,
    pub channelColor: String,
    pub videoId: String,
    pub videoTitle: String,
    pub videoUrl: String,
    pub thumbnail: String,
    pub duration: f64,
    #[serde(rename = "trimLimit")]
    pub trim_limit: TrimLimit,
    pub status: WorkspaceStatus,
    pub renderProgress: f64,
    #[serde(rename = "downloadProgress", skip_serializing_if = "Option::is_none")]
    pub download_progress: Option<f64>,
    pub downloadedAt: String,
    pub downloadedPath: String,
    pub blurBackgroundPath: String,
    pub outputPath: String,
    pub metadataPath: String,
    pub fileSize: u64,
    pub renderMetadata: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum TrimLimit {
    Minutes(f64),
    Full,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum WorkspaceStatus {
    Waiting,
    Downloading,
    Ready,
    Editing,
    Rendering,
    Done,
    Error,
}

impl WorkspaceStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Waiting => "waiting",
            Self::Downloading => "downloading",
            Self::Ready => "ready",
            Self::Editing => "editing",
            Self::Rendering => "rendering",
            Self::Done => "done",
            Self::Error => "error",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_roundtrip_preserves_lowercase_strings() {
        for status in [
            WorkspaceStatus::Waiting,
            WorkspaceStatus::Downloading,
            WorkspaceStatus::Ready,
            WorkspaceStatus::Editing,
            WorkspaceStatus::Rendering,
            WorkspaceStatus::Done,
            WorkspaceStatus::Error,
        ] {
            let json = serde_json::to_string(&status).unwrap();
            let parsed: WorkspaceStatus = serde_json::from_str(&json).unwrap();
            assert_eq!(status, parsed);
        }
    }

    #[test]
    fn trim_limit_full_serializes_as_string() {
        let v = TrimLimit::Full;
        assert_eq!(serde_json::to_string(&v).unwrap(), "\"full\"");
    }

    #[test]
    fn trim_limit_minutes_serializes_as_number() {
        let v = TrimLimit::Minutes(5.0);
        assert_eq!(serde_json::to_string(&v).unwrap(), "5.0");
    }
}
```

- [ ] **Step 6: Write channel.rs**

Create `src-tauri/crates/hyperclip-core/src/channel.rs`:

```rust
use serde::{Deserialize, Serialize};

/// Mirror of `StoredChannel` from `electron/services/store.ts`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct StoredChannel {
    pub id: String,
    pub name: String,
    pub handle: String,
    pub avatarColor: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub channelId: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avatarUrl: Option<String>,
    pub createdAt: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub paused: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub settings: Option<ChannelSettings>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum ChannelTrimLimit {
    Minutes(f64),
    Full,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ChannelSettings {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trimLimit: Option<ChannelTrimLimit>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub downloadQuality: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub autoRender: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolution: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fps: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub autoSplit: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub splitMinutes: Option<f64>,
}
```

- [ ] **Step 7: Write lib.rs**

Create `src-tauri/crates/hyperclip-core/src/lib.rs`:

```rust
pub mod channel;
pub mod error;
pub mod paths;
pub mod workspace;

pub use error::{CoreError, Result};
```

- [ ] **Step 8: Write integration test for serde roundtrip**

Create `src-tauri/crates/hyperclip-core/tests/workspace_serde.rs`:

```rust
use hyperclip_core::workspace::{TrimLimit, WorkspaceData, WorkspaceStatus};

#[test]
fn workspace_data_roundtrips_via_json() {
    let json = r#"{
        "id": "ws1",
        "channelId": "ch1",
        "channelName": "Test Channel",
        "channelColor": "#ff00ff",
        "videoId": "vid1",
        "videoTitle": "Hello",
        "videoUrl": "https://youtu.be/vid1",
        "thumbnail": "https://i.ytimg.com/vi/vid1/0.jpg",
        "duration": 120.5,
        "trimLimit": 5.0,
        "status": "waiting",
        "renderProgress": 0,
        "downloadedAt": "2026-06-03T10:00:00Z",
        "downloadedPath": "vid1.mp4",
        "blurBackgroundPath": "",
        "outputPath": "out.mp4",
        "metadataPath": "meta.json",
        "fileSize": 12345678,
        "renderMetadata": null
    }"#;

    let ws: WorkspaceData = serde_json::from_str(json).expect("parse");
    assert_eq!(ws.id, "ws1");
    assert_eq!(ws.status, WorkspaceStatus::Waiting);
    assert_eq!(ws.trim_limit, TrimLimit::Minutes(5.0));

    let serialized = serde_json::to_string(&ws).expect("serialize");
    let parsed_back: WorkspaceData = serde_json::from_str(&serialized).expect("re-parse");
    assert_eq!(ws, parsed_back);
}

#[test]
fn workspace_status_error_lowercases() {
    let ws: WorkspaceData = serde_json::from_str(
        r#"{
            "id": "ws2", "channelId": "c", "channelName": "n", "channelColor": "#fff",
            "videoId": "v", "videoTitle": "t", "videoUrl": "u", "thumbnail": "th",
            "duration": 1.0, "trimLimit": "full", "status": "error",
            "renderProgress": 0, "downloadedAt": "x", "downloadedPath": "",
            "blurBackgroundPath": "", "outputPath": "", "metadataPath": "",
            "fileSize": 0, "renderMetadata": null
        }"#,
    )
    .expect("parse");
    assert_eq!(ws.status, WorkspaceStatus::Error);
    assert_eq!(ws.trim_limit, TrimLimit::Full);
}
```

- [ ] **Step 9: Run tests**

Run: `cd src-tauri && cargo test -p hyperclip-core`
Expected: All tests pass. Output like `test result: ok. 6 passed; 0 failed`.

- [ ] **Step 10: Run clippy**

Run: `cd src-tauri && cargo clippy -p hyperclip-core -- -D warnings`
Expected: No warnings. If warnings appear, fix them inline.

- [ ] **Step 11: Commit**

Run:
```bash
cd d:/LOOP_COMPANY/HyperClip
git add src-tauri/crates/hyperclip-core
git commit -m "feat(core): hyperclip-core crate with Workspace/Channel types

Mirror the TypeScript WorkspaceData + StoredChannel shape so the
existing .hyperclip/workspaces.json file on disk can be loaded
unchanged. Serde roundtrip tests lock the JSON contract."
```

---

## Task 5: Create hyperclip-store crate

**Files:**
- Create: `src-tauri/crates/hyperclip-store/Cargo.toml`
- Create: `src-tauri/crates/hyperclip-store/src/lib.rs`
- Create: `src-tauri/crates/hyperclip-store/src/workspaces.rs`
- Create: `src-tauri/crates/hyperclip-store/src/channels.rs`
- Create: `src-tauri/crates/hyperclip-store/tests/workspaces_roundtrip.rs`
- Create: `src-tauri/crates/hyperclip-store/tests/fixtures/sample_workspaces.json`

- [ ] **Step 1: Create directories and Cargo.toml**

Run: `mkdir -p src-tauri/crates/hyperclip-store/src src-tauri/crates/hyperclip-store/tests/fixtures`

Create `src-tauri/crates/hyperclip-store/Cargo.toml`:

```toml
[package]
name = "hyperclip-store"
version.workspace = true
edition.workspace = true
rust-version.workspace = true
license.workspace = true

[dependencies]
hyperclip-core.workspace = true
serde.workspace = true
serde_json.workspace = true
thiserror.workspace = true
tokio = { workspace = true, features = ["fs", "sync"] }
tracing.workspace = true
```

- [ ] **Step 2: Write test fixture (sample workspaces.json)**

Create `src-tauri/crates/hyperclip-store/tests/fixtures/sample_workspaces.json`:

```json
[
  {
    "id": "ws-fixture-1",
    "channelId": "ch1",
    "channelName": "Sample Channel",
    "channelColor": "#00B4FF",
    "videoId": "abc123",
    "videoTitle": "Test Video 1",
    "videoUrl": "https://youtu.be/abc123",
    "thumbnail": "https://i.ytimg.com/vi/abc123/hqdefault.jpg",
    "duration": 125.0,
    "trimLimit": 5.0,
    "status": "ready",
    "renderProgress": 0,
    "downloadedAt": "2026-06-01T10:00:00Z",
    "downloadedPath": "abc123.mp4",
    "blurBackgroundPath": "",
    "outputPath": "abc123-out.mp4",
    "metadataPath": "abc123-meta.json",
    "fileSize": 12345678,
    "renderMetadata": null
  },
  {
    "id": "ws-fixture-2",
    "channelId": "ch2",
    "channelName": "Another",
    "channelColor": "#FF00AA",
    "videoId": "def456",
    "videoTitle": "Test Video 2",
    "videoUrl": "https://youtu.be/def456",
    "thumbnail": "https://i.ytimg.com/vi/def456/hqdefault.jpg",
    "duration": 600.0,
    "trimLimit": "full",
    "status": "downloading",
    "renderProgress": 0,
    "downloadProgress": 42.5,
    "downloadedAt": "2026-06-02T12:00:00Z",
    "downloadedPath": "",
    "blurBackgroundPath": "",
    "outputPath": "",
    "metadataPath": "",
    "fileSize": 0,
    "renderMetadata": null
  }
]
```

- [ ] **Step 3: Write workspaces.rs (TDD — write tests first)**

Create `src-tauri/crates/hyperclip-store/src/workspaces.rs`:

```rust
use hyperclip_core::error::{CoreError, Result};
use hyperclip_core::paths;
use hyperclip_core::workspace::WorkspaceData;
use std::path::{Path, PathBuf};
use tokio::fs;

const FILE_INDEX_TTL_MS: u64 = 60_000;

pub struct Store {
    /// In-memory cache with TTL. Avoids disk I/O on every poll.
    cache: tokio::sync::RwLock<Option<CacheEntry>>,
    workspaces_path: PathBuf,
}

struct CacheEntry {
    at: std::time::Instant,
    workspaces: Vec<WorkspaceData>,
}

impl Store {
    /// Create a store pointing at a specific workspaces.json path.
    /// Used by tests with fixtures; production code uses `for_default_dir()`.
    pub fn new(workspaces_path: PathBuf) -> Self {
        Self {
            cache: tokio::sync::RwLock::new(None),
            workspaces_path,
        }
    }

    /// Default store using %APPDATA%/HyperClip/.hyperclip/workspaces.json.
    pub fn for_default_dir() -> Result<Self> {
        Ok(Self::new(paths::workspaces_file()?))
    }

    pub fn workspaces_path(&self) -> &Path {
        &self.workspaces_path
    }

    /// Load workspaces, using cache if still fresh.
    pub async fn list(&self) -> Result<Vec<WorkspaceData>> {
        // Try cache
        {
            let cache = self.cache.read().await;
            if let Some(entry) = cache.as_ref() {
                if entry.at.elapsed().as_millis() < FILE_INDEX_TTL_MS as u128 {
                    return Ok(entry.workspaces.clone());
                }
            }
        }

        // Cache miss — read from disk
        let workspaces = self.read_from_disk().await?;
        let mut cache = self.cache.write().await;
        *cache = Some(CacheEntry {
            at: std::time::Instant::now(),
            workspaces: workspaces.clone(),
        });
        Ok(workspaces)
    }

    /// Invalidate the cache — call after any mutation.
    pub async fn invalidate(&self) {
        let mut cache = self.cache.write().await;
        *cache = None;
    }

    async fn read_from_disk(&self) -> Result<Vec<WorkspaceData>> {
        if !fs::try_exists(&self.workspaces_path).await.unwrap_or(false) {
            return Ok(Vec::new());
        }
        let raw = fs::read_to_string(&self.workspaces_path)
            .await
            .map_err(|source| CoreError::Io {
                path: self.workspaces_path.clone(),
                source,
            })?;
        if raw.trim().is_empty() {
            return Ok(Vec::new());
        }
        let parsed: Vec<WorkspaceData> =
            serde_json::from_str(&raw).map_err(|source| CoreError::Json {
                path: self.workspaces_path.clone(),
                source,
            })?;
        Ok(parsed)
    }

    /// Save workspaces to disk, replacing existing content.
    pub async fn save(&self, workspaces: &[WorkspaceData]) -> Result<()> {
        if let Some(parent) = self.workspaces_path.parent() {
            fs::create_dir_all(parent).await.map_err(|source| CoreError::Io {
                path: parent.to_path_buf(),
                source,
            })?;
        }
        let json = serde_json::to_string_pretty(workspaces).map_err(|source| CoreError::Json {
            path: self.workspaces_path.clone(),
            source,
        })?;
        fs::write(&self.workspaces_path, json)
            .await
            .map_err(|source| CoreError::Io {
                path: self.workspaces_path.clone(),
                source,
            })?;
        self.invalidate().await;
        Ok(())
    }
}
```

- [ ] **Step 4: Write channels.rs (minimal stub for M0)**

Create `src-tauri/crates/hyperclip-store/src/channels.rs`:

```rust
use hyperclip_core::channel::StoredChannel;
use hyperclip_core::error::Result;
use hyperclip_core::paths;
use std::path::PathBuf;
use tokio::fs;

pub struct ChannelStore {
    channels_path: PathBuf,
}

impl ChannelStore {
    pub fn for_default_dir() -> Result<Self> {
        Ok(Self {
            channels_path: paths::channels_file()?,
        })
    }

    pub async fn list(&self) -> Result<Vec<StoredChannel>> {
        if !fs::try_exists(&self.channels_path).await.unwrap_or(false) {
            return Ok(Vec::new());
        }
        let raw = fs::read_to_string(&self.channels_path).await.map_err(|source| {
            hyperclip_core::error::CoreError::Io {
                path: self.channels_path.clone(),
                source,
            }
        })?;
        if raw.trim().is_empty() {
            return Ok(Vec::new());
        }
        let parsed: Vec<StoredChannel> =
            serde_json::from_str(&raw).map_err(|source| hyperclip_core::error::CoreError::Json {
                path: self.channels_path.clone(),
                source,
            })?;
        Ok(parsed)
    }
}
```

- [ ] **Step 5: Write lib.rs**

Create `src-tauri/crates/hyperclip-store/src/lib.rs`:

```rust
pub mod channels;
pub mod workspaces;
```

- [ ] **Step 6: Write integration test**

Create `src-tauri/crates/hyperclip-store/tests/workspaces_roundtrip.rs`:

```rust
use hyperclip_store::workspaces::Store;
use std::path::PathBuf;

fn fixture_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join("sample_workspaces.json")
}

#[tokio::test]
async fn list_loads_workspaces_from_disk() {
    let store = Store::new(fixture_path());
    let workspaces = store.list().await.expect("list");
    assert_eq!(workspaces.len(), 2);
    assert_eq!(workspaces[0].id, "ws-fixture-1");
    assert_eq!(workspaces[1].status, hyperclip_core::workspace::WorkspaceStatus::Downloading);
}

#[tokio::test]
async fn cache_returns_same_value_within_ttl() {
    let store = Store::new(fixture_path());
    let first = store.list().await.expect("list");
    let second = store.list().await.expect("list 2");
    assert_eq!(first.len(), second.len());
    assert_eq!(first[0].id, second[0].id);
}

#[tokio::test]
async fn list_returns_empty_when_file_missing() {
    let store = Store::new(PathBuf::from("Z:/this/does/not/exist.json"));
    let workspaces = store.list().await.expect("list empty");
    assert!(workspaces.is_empty());
}

#[tokio::test]
async fn save_then_list_roundtrips() {
    let tmp = std::env::temp_dir().join(format!("hc-test-{}.json", std::process::id()));
    let _ = std::fs::remove_file(&tmp);

    let store = Store::new(tmp.clone());
    let original = store.list().await.expect("first list");
    assert!(original.is_empty());

    let new_ws = vec![hyperclip_core::workspace::WorkspaceData {
        id: "roundtrip-1".into(),
        channelId: "c".into(),
        channelName: "n".into(),
        channelColor: "#fff".into(),
        videoId: "v".into(),
        videoTitle: "t".into(),
        videoUrl: "u".into(),
        thumbnail: "th".into(),
        duration: 1.0,
        trim_limit: hyperclip_core::workspace::TrimLimit::Full,
        status: hyperclip_core::workspace::WorkspaceStatus::Waiting,
        renderProgress: 0.0,
        download_progress: None,
        downloadedAt: "x".into(),
        downloadedPath: "".into(),
        blurBackgroundPath: "".into(),
        outputPath: "".into(),
        metadataPath: "".into(),
        fileSize: 0,
        renderMetadata: None,
    }];

    store.save(&new_ws).await.expect("save");
    store.invalidate().await;

    let store2 = Store::new(tmp.clone());
    let loaded = store2.list().await.expect("re-load");
    assert_eq!(loaded.len(), 1);
    assert_eq!(loaded[0].id, "roundtrip-1");
    assert_eq!(loaded[0].trim_limit, hyperclip_core::workspace::TrimLimit::Full);

    let _ = std::fs::remove_file(&tmp);
}
```

- [ ] **Step 7: Run tests**

Run: `cd src-tauri && cargo test -p hyperclip-store`
Expected: All tests pass. Output like `test result: ok. 4 passed; 0 failed`.

- [ ] **Step 8: Run clippy**

Run: `cd src-tauri && cargo clippy -p hyperclip-store --all-targets -- -D warnings`
Expected: No warnings.

- [ ] **Step 9: Commit**

Run:
```bash
cd d:/LOOP_COMPANY/HyperClip
git add src-tauri/crates/hyperclip-store
git commit -m "feat(store): hyperclip-store crate with workspace + channel load/save

Async JSON persistence matching Electron store.ts behavior:
- 60s in-memory cache TTL
- Returns empty Vec when file missing
- Serde roundtrip preserves existing file format"
```

---

## Task 6: Create hyperclip-ipc crate stub

**Files:**
- Create: `src-tauri/crates/hyperclip-ipc/Cargo.toml`
- Create: `src-tauri/crates/hyperclip-ipc/src/lib.rs`

- [ ] **Step 1: Create directory and Cargo.toml**

Run: `mkdir -p src-tauri/crates/hyperclip-ipc/src`

Create `src-tauri/crates/hyperclip-ipc/Cargo.toml`:

```toml
[package]
name = "hyperclip-ipc"
version.workspace = true
edition.workspace = true
rust-version.workspace = true
license.workspace = true

[dependencies]
hyperclip-core.workspace = true
hyperclip-store.workspace = true
serde.workspace = true
serde_json.workspace = true
thiserror.workspace = true
tokio.workspace = true
tracing.workspace = true
```

- [ ] **Step 2: Write lib.rs (just module declarations for M0)**

Create `src-tauri/crates/hyperclip-ipc/src/lib.rs`:

```rust
//! Tauri command handlers — 1:1 mirror of Electron IPC channels.
//!
//! M0 only exposes `workspace_list`. Later milestones (M1+) will
//! incrementally add commands as the corresponding Rust services
//! are ported.

use hyperclip_core::error::Result as CoreResult;
use hyperclip_core::workspace::WorkspaceData;
use hyperclip_store::workspaces::Store;

#[derive(Debug, thiserror::Error)]
pub enum IpcError {
    #[error(transparent)]
    Core(#[from] hyperclip_core::error::CoreError),
}

pub type IpcResult<T> = std::result::Result<T, IpcError>;

/// `workspace_list` — returns all workspaces from the on-disk store.
#[tauri::command]
pub async fn workspace_list(store: tauri::State<'_, Store>) -> IpcResult<Vec<WorkspaceData>> {
    let workspaces = store.list().await.map_err(IpcError::from)?;
    Ok(workspaces)
}
```

- [ ] **Step 3: Verify it compiles (this is the moment Tauri command derives check in)**

Run: `cd src-tauri && cargo check -p hyperclip-ipc`
Expected: Error about `tauri` not being a dep. We need to add it.

- [ ] **Step 4: Add Tauri dependency to hyperclip-ipc**

Edit `src-tauri/crates/hyperclip-ipc/Cargo.toml` and add to `[dependencies]`:

```toml
tauri = { version = "2", features = [] }
```

- [ ] **Step 5: Re-check**

Run: `cd src-tauri && cargo check -p hyperclip-ipc`
Expected: Compiles successfully (may take a minute to fetch tauri crate).

- [ ] **Step 6: Commit**

Run:
```bash
cd d:/LOOP_COMPANY/HyperClip
git add src-tauri/crates/hyperclip-ipc
git commit -m "feat(ipc): hyperclip-ipc crate stub with workspace_list command

Tauri command that returns all workspaces from the disk store.
More commands added incrementally per milestone (M1+)."
```

---

## Task 7: Create Tauri main binary

**Files:**
- Create: `src-tauri/Cargo.toml` (update — add binary + tauri build deps)
- Create: `src-tauri/build.rs`
- Create: `src-tauri/tauri.conf.json`
- Create: `src-tauri/src/main.rs`
- Create: `src-tauri/src/lib.rs`
- Create: `src-tauri/icons/` (placeholder icons)

- [ ] **Step 1: Update workspace Cargo.toml to add the app crate**

Append to `[workspace.members]` in `src-tauri/Cargo.toml`:

```toml
".",
```

And to `[workspace.dependencies]`, add:

```toml
tauri = { version = "2", features = [] }
tauri-build = { version = "2", features = [] }
```

- [ ] **Step 2: Create `src-tauri/Cargo.toml` for the app crate**

Create `src-tauri/Cargo.toml`:

```toml
[package]
name = "hyperclip"
version.workspace = true
edition.workspace = true
rust-version.workspace = true
license.workspace = true
description = "HyperClip — Tauri desktop shell"

[lib]
name = "hyperclip_lib"
path = "src/lib.rs"
crate-type = ["staticlib", "cdylib", "rlib"]

[[bin]]
name = "hyperclip"
path = "src/main.rs"

[build-dependencies]
tauri-build.workspace = true

[dependencies]
hyperclip-core.workspace = true
hyperclip-store.workspace = true
hyperclip-ipc.workspace = true
tauri.workspace = true
tokio.workspace = true
tracing.workspace = true
tracing-subscriber.workspace = true
serde.workspace = true
serde_json.workspace = true
```

- [ ] **Step 3: Create `build.rs`**

Create `src-tauri/build.rs`:

```rust
fn main() {
    tauri_build::build();
}
```

- [ ] **Step 4: Create `tauri.conf.json`**

Create `src-tauri/tauri.conf.json`:

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "HyperClip",
  "version": "0.1.0",
  "identifier": "com.hyperclip.app",
  "build": {
    "frontendDist": "../out",
    "devUrl": "http://localhost:3000",
    "beforeDevCommand": "npm run dev:next",
    "beforeBuildCommand": "npm run build:next"
  },
  "app": {
    "windows": [
      {
        "title": "HyperClip",
        "width": 1400,
        "height": 900,
        "resizable": true,
        "fullscreen": false
      }
    ],
    "security": {
      "csp": null
    }
  },
  "bundle": {
    "active": true,
    "targets": ["msi", "nsis"],
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ]
  }
}
```

- [ ] **Step 5: Create placeholder icons (1x1 PNG bytes minimum)**

Run: `mkdir -p src-tauri/icons`

For M0, create minimal valid PNGs. Use this PowerShell one-liner (writes 1×1 transparent PNG to each path):

```powershell
$png = [byte[]](0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A,0x00,0x00,0x00,0x0D,0x49,0x48,0x44,0x52,0x00,0x00,0x00,0x01,0x00,0x00,0x00,0x01,0x08,0x06,0x00,0x00,0x00,0x1F,0x15,0xC4,0x89,0x00,0x00,0x00,0x0D,0x49,0x44,0x41,0x54,0x78,0x9C,0x63,0x00,0x01,0x00,0x00,0x05,0x00,0x01,0x0D,0x0A,0x2D,0xB4,0x00,0x00,0x00,0x00,0x49,0x45,0x4E,0x44,0xAE,0x42,0x60,0x82)
New-Item -ItemType Directory -Force -Path "src-tauri/icons" | Out-Null
[IO.File]::WriteAllBytes("src-tauri/icons/32x32.png", $png)
[IO.File]::WriteAllBytes("src-tauri/icons/128x128.png", $png)
[IO.File]::WriteAllBytes("src-tauri/icons/128x128@2x.png", $png)
# Tauri also needs .ico and .icns — for M0 we just point at the same PNG, will be regenerated in M9
[IO.File]::WriteAllBytes("src-tauri/icons/icon.ico", $png)
[IO.File]::WriteAllBytes("src-tauri/icons/icon.icns", $png)
```

Expected: Five files exist in `src-tauri/icons/`. (Real icons get generated later — Tauri only needs SOMETHING present for the bundler to find.)

- [ ] **Step 6: Write `src-tauri/src/main.rs` (entry point)**

Create `src-tauri/src/main.rs`:

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    hyperclip_lib::run();
}
```

- [ ] **Step 7: Write `src-tauri/src/lib.rs` (Tauri setup + DI wiring)**

Create `src-tauri/src/lib.rs`:

```rust
use hyperclip_ipc::workspace_list;
use hyperclip_store::workspaces::Store;

pub fn run() {
    // Initialize tracing — defaults to INFO. Override with RUST_LOG env var.
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info,hyperclip=debug")),
        )
        .init();

    tauri::Builder::default()
        .setup(|app| {
            // Initialize the workspace store and inject it as Tauri managed state.
            let store = Store::for_default_dir()
                .map_err(|e| format!("Failed to init store: {}", e))?;
            tracing::info!(
                "Store initialized at {:?} (app ready)",
                store.workspaces_path()
            );
            app.manage(store);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![workspace_list])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 8: Run a full workspace build**

Run: `cd src-tauri && cargo build --workspace`
Expected: Compiles cleanly. May take 3-5 minutes the first time. If it fails, read the error and fix.

- [ ] **Step 9: Run clippy on the whole workspace**

Run: `cd src-tauri && cargo clippy --workspace --all-targets -- -D warnings`
Expected: No warnings.

- [ ] **Step 10: Commit**

Run:
```bash
cd d:/LOOP_COMPANY/HyperClip
git add src-tauri/Cargo.toml src-tauri/build.rs src-tauri/tauri.conf.json src-tauri/src src-tauri/icons
git commit -m "feat(tauri): main binary with workspace_list wired up

Tauri 2.x app crate at src-tauri/ — Tauri shell + tracing setup +
Store managed-state injection. First command workspace_list lets
the frontend enumerate existing workspaces from the on-disk store."
```

---

## Task 8: Rewrite frontend ipc.ts to use Tauri

**Files:**
- Modify: `package.json` (add `@tauri-apps/api`)
- Modify: `src/app/lib/ipc.ts` (Tauri shim)
- Create: `src/tauri.d.ts` (Tauri API typings stub)
- Modify: `next.config.mjs` (static export for Tauri)

- [ ] **Step 1: Add Tauri JS dep to package.json**

Edit `d:/LOOP_COMPANY/HyperClip/package.json` and add to `dependencies`:

```json
"@tauri-apps/api": "^2.0.0"
```

- [ ] **Step 2: Install**

Run: `cd d:/LOOP_COMPANY/HyperClip && npm install`
Expected: `@tauri-apps/api` installed. May take 30-60 seconds.

- [ ] **Step 3: Add Tauri build scripts to package.json**

Edit `package.json` `scripts` block, adding these entries (don't remove existing):

```json
"dev:next": "next dev",
"build:next": "next build",
"tauri": "tauri",
"tauri:dev": "tauri dev",
"tauri:build": "tauri build"
```

(Note: `next dev` was already there as `dev`; the new `dev:next` is a copy that Tauri uses. This lets us run `npm run dev:next` separately to debug just the frontend.)

- [ ] **Step 4: Update next.config.mjs for static export**

Read current `next.config.mjs`, then add `output: 'export'`. Final content should be:

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  images: {
    unoptimized: true,
  },
  trailingSlash: true,
  // Tell Next not to try to use Image Optimization (Tauri serves static files)
  experimental: {},
};

export default nextConfig;
```

- [ ] **Step 5: Rewrite `src/app/lib/ipc.ts` to use Tauri**

Replace the entire file `src/app/lib/ipc.ts` with:

```typescript
// Tauri-based IPC shim — replaces the Electron `window.electronAPI` surface.
// Function names and return shapes match the old contract; the implementation
// is a thin wrapper around `@tauri-apps/api/core::invoke` and `event::listen`.

import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

// ─── M0 commands ────────────────────────────────────────────────────────────

export const ipc = {
  async getWorkspaces(): Promise<unknown[]> {
    if (!isTauri) return []
    return (await invoke('workspace_list')) as unknown[]
  },
}

// ─── Tauri event subscriptions (placeholders — filled in by later milestones) ─

export const tauriEvents = {
  onSystemStats(_cb: (stats: object) => void): () => void {
    if (!isTauri) return () => {}
    let unlisten: () => void = () => {}
    listen('system:stats-update', e => _cb(e.payload as object)).then(u => {
      unlisten = u
    })
    return () => unlisten()
  },
}
```

(M0 only needs `getWorkspaces`. The rest of the IPC surface will be added incrementally per milestone — see "Future Milestones" below.)

- [ ] **Step 6: Update `src/app/lib/store.ts` to call the new ipc.getWorkspaces()**

The Zustand store in `src/app/lib/store.ts` currently calls `ipc.getWorkspaces()` which already exists. The signature `(...) => Promise<unknown[]>` matches. No change needed — but verify by reading the file's workspace-loading code path:

Run: `grep -n "getWorkspaces" src/app/lib/store.ts`
Expected: At least one match. If the store calls anything else from the old ipc that M0 doesn't provide, **leave it alone for now** — those calls will simply return undefined fallback values until later milestones add them.

- [ ] **Step 7: Type-check the frontend**

Run: `cd d:/LOOP_COMPANY/HyperClip && npx tsc --noEmit`
Expected: No errors. If errors relate to the rest of the IPC surface that isn't ported yet, leave them — M0 only needs `workspace_list`.

- [ ] **Step 8: Build the frontend (static export)**

Run: `cd d:/LOOP_COMPANY/HyperClip && npm run build:next`
Expected: Build succeeds. Output goes to `out/`. The Tauri config points at `../out` from `src-tauri/`.

- [ ] **Step 9: Commit**

Run:
```bash
cd d:/LOOP_COMPANY/HyperClip
git add package.json package-lock.json next.config.mjs src/app/lib/ipc.ts
git commit -m "feat(frontend): Tauri shim for IPC — M0 only exposes workspace_list

Replace window.electronAPI surface with Tauri invoke() calls.
Static export Next.js via output: 'export' so the bundle can be
served from Tauri's file protocol.

Other IPC channels (system, channels, render, etc.) will be
added incrementally in later milestones."
```

---

## Task 9: Verify M0 end-to-end

**Files:** None — verification only.

- [ ] **Step 1: Ensure sample data exists in your user .hyperclip dir**

Run: `ls "$APPDATA/HyperClip/.hyperclip/workspaces.json" 2>/dev/null || mkdir -p "$APPDATA/HyperClip/.hyperclip" && cp d:/LOOP_COMPANY/HyperClip/hyperclip/HyperClip.Core/bin/Debug/net8.0/HyperClip.Core.deps.json /dev/null; echo "Check OK"`
Expected: Either the file exists (carried over from earlier runs) or the directory was created. The actual content of `workspaces.json` will be whatever was in the user's store from prior Electron runs — it could be `[]` or contain real entries.

If the file does not exist, create a minimal one to verify M0:

```bash
mkdir -p "$APPDATA/HyperClip/.hyperclip"
echo '[]' > "$APPDATA/HyperClip/.hyperclip/workspaces.json"
```

- [ ] **Step 2: Run the app**

Run: `cd d:/LOOP_COMPANY/HyperClip && npm run tauri:dev`
Expected: A Tauri window opens with the HyperClip UI. If the dev server hasn't started, Tauri waits for `devUrl` (port 3000) and then launches the WebView. Logs in the terminal should show:

```
hyperclip_lib::run: Store initialized at "C:\\Users\\MSI\\AppData\\Roaming\\HyperClip\\.hyperclip\\workspaces.json" (app ready)
```

- [ ] **Step 3: Verify the frontend renders**

In the Tauri window, the React app should load. The dashboard's "WorkspaceQueue" will be empty (no workspaces in the test JSON) — that's correct M0 behavior.

- [ ] **Step 4: Add a test workspace and reload**

Edit `$APPDATA/HyperClip/.hyperclip/workspaces.json` to add a fake entry:

```json
[{
  "id": "m0-verify",
  "channelId": "ch-test",
  "channelName": "M0 Verify",
  "channelColor": "#00FF88",
  "videoId": "v1",
  "videoTitle": "M0 Workspaces Loaded From Disk",
  "videoUrl": "https://youtu.be/v1",
  "thumbnail": "https://i.ytimg.com/vi/v1/hqdefault.jpg",
  "duration": 100,
  "trimLimit": 5,
  "status": "ready",
  "renderProgress": 0,
  "downloadedAt": "2026-06-03T00:00:00Z",
  "downloadedPath": "v1.mp4",
  "blurBackgroundPath": "",
  "outputPath": "",
  "metadataPath": "",
  "fileSize": 0,
  "renderMetadata": null
}]
```

In the Tauri window, refresh (Ctrl+R or close+reopen). The new workspace "M0 Workspaces Loaded From Disk" should appear in the queue.

- [ ] **Step 5: Confirm Rust logs show the load**

The Tauri terminal should print no errors. If logs show `IO error` or `JSON parse error`, the data shape mismatched — check field names match `WorkspaceData` in `src-tauri/crates/hyperclip-core/src/workspace.rs`.

- [ ] **Step 6: Stop the app and commit final state**

Press Ctrl+C in the terminal to stop `tauri dev`. Run:

```bash
cd d:/LOOP_COMPANY/HyperClip
git status
```
Expected: `nothing to commit, working tree clean` (assuming you didn't modify the workspaces.json in the repo — it's outside the repo at `%APPDATA%`).

If you modified the test fixture in `$APPDATA`, that's outside the repo — no commit needed.

- [ ] **Step 7: Final summary commit (no-op if tree clean)**

If there's anything uncommitted from the verification, commit it. Otherwise:

```bash
cd d:/LOOP_COMPANY/HyperClip
git log --oneline -10
```

Expected: Top of log shows the M0 commit chain. Push if desired:

```bash
git push origin migrate
```

---

## Self-Review (post-write)

**Spec coverage check:**
- Section 3.1 (Stack): Tauri, tokio, serde, serde_json, chrono, thiserror ✅ Task 4, 5, 7
- Section 3.4 (IPC contract 1:1): workspace_list mirrors `workspace:list` ✅ Task 6
- Section 4 (File structure): src-tauri layout with crates ✅ Task 3-7
- Section 5 (Module mapping): core, store, ipc stubs ✅ Task 4, 5, 6
- Section 7 (M0 milestone): Tauri scaffold + core + store + ipc shim + verify load ✅ All tasks
- Section 8 (Frontend changes): ipc.ts rewrite ✅ Task 8

**Gaps:**
- hyperclip-ffmpeg-paths backslash fix (Section 6.3): N/A for M0 — covered in M3
- Detection parity (Section 6.1): N/A for M0 — covered in M4-M7
- Health alerts (Section 6.4): N/A for M0 — covered in M8

**Placeholder scan:** No "TBD", "TODO", or "implement later" markers. All commands have full code.

**Type consistency:** `WorkspaceData` fields match between `hyperclip-core` (Task 4) and `hyperclip-store` test (Task 5). Tauri command `workspace_list` return type `Vec<WorkspaceData>` matches the frontend `unknown[]` cast.

---

## Future Milestones (brief — full plans to be written after M0 completes)

| Milestone | Crates added | Tauri commands added | Est. tasks |
|---|---|---|---|
| **M1** | `hyperclip-system` | `system_stats`, `resource_alert`, `hardware_profile`; events `system:stats-update` | ~8 |
| **M2** | `hyperclip-yt` | `workspace_add`, `workspace_retry`, `get_video_file`, `get_video_blob` | ~10 |
| **M3** | `hyperclip-ffmpeg` | `render_start`, `render_cancel`, `start_chunked`; events `render:progress-event` | ~12 |
| **M4** | `hyperclip-cookies` | `start_chrome_login`, `add_session`, `clone_session_one` | ~14 |
| **M5** | `hyperclip-auth` | `start_oauth_flow`, `set_oauth_credentials`, `get_keys` + CRUD | ~12 |
| **M6** | `hyperclip-innertube` | (internal — feeds M7) | ~10 |
| **M7** | `hyperclip-detect` | `pause_channel`, `resume_channel`, `bulk_*`; events `autodownload`, `channel:synced-event` | ~10 |
| **M8** | `hyperclip-project`, `hyperclip-health` | remaining project + health IPC | ~12 |
| **M9** | (cleanup) | delete `electron/`, regenerate real icons, build msi bundle | ~6 |

Each milestone ends with a smoke test that exercises the new commands end-to-end via the Tauri dev window.
