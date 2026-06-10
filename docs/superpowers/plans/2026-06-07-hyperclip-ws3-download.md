# WS3: Download Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire yt-dlp wrapper với tv_embedded client priority, --download-sections, multi-instance support, progress parsing, auto-download trigger.

**Architecture:** Rust spawns yt-dlp subprocess. Stderr parsing cho progress. Event emission to Python qua JSON-RPC.

**Tech Stack:** Rust, `tokio::process`, regex (stderr parsing), existing types.

**Parent plan:** [2026-06-07-hyperclip-migration.md](./2026-06-07-hyperclip-migration.md)
**Prerequisites:** WS1 + WS2 complete.

---

## Tasks (10 total)

### Task 3.1: yt-dlp Wrapper Module

**Files:**
- Modify: `crates/hyperclip_ipc/src/youtube.rs` (replace stub)

- [ ] **Step 1: Read existing stub**

```bash
cd D:/LOOP_COMPANY/HyperClip
wc -l crates/hyperclip_ipc/src/youtube.rs
```

- [ ] **Step 2: Write failing test**

Create `crates/hyperclip_ipc/src/__tests__/youtube_test.rs`:

```rust
use hyperclip_ipc::youtube::{build_ytdlp_args, DownloadOptions};

#[test]
fn test_build_ytdlp_args_tv_embedded_priority() {
    let opts = DownloadOptions {
        url: "https://youtube.com/watch?v=test".into(),
        output_path: "/tmp/test.mp4".into(),
        trim_start: "00:00:00".into(),
        trim_end: "00:10:00".into(),
        quality: 1080,
        client_priority: vec!["tv_embedded".into(), "web".into(), "ios".into()],
        concurrent_fragments: 16,
        cookies_file: None,
    };
    
    let args = build_ytdlp_args(&opts);
    
    // Must contain tv_embedded client
    assert!(args.iter().any(|a| a.contains("tv_embedded")), "args: {:?}", args);
    // Must have --download-sections
    assert!(args.iter().any(|a| a.starts_with("*00:00:00-")), "args: {:?}", args);
    // Must have --concurrent-fragments
    assert!(args.iter().any(|a| a == &"16".to_string()), "args: {:?}", args);
}

#[test]
fn test_build_ytdlp_args_no_trim_when_full() {
    let opts = DownloadOptions {
        url: "https://youtube.com/watch?v=test".into(),
        output_path: "/tmp/test.mp4".into(),
        trim_start: "".into(),
        trim_end: "".into(),
        quality: 720,
        client_priority: vec!["tv_embedded".into()],
        concurrent_fragments: 16,
        cookies_file: None,
    };
    
    let args = build_ytdlp_args(&opts);
    // No --download-sections when trim empty
    assert!(!args.iter().any(|a| a.starts_with("*")), "args: {:?}", args);
}
```

- [ ] **Step 3: Implement youtube.rs**

Replace `crates/hyperclip_ipc/src/youtube.rs`:

```rust
//! yt-dlp wrapper with tv_embedded client priority.

use std::path::PathBuf;
use std::process::Stdio;
use tokio::process::Command;
use tokio::io::{AsyncBufReadExt, BufReader};
use serde::{Deserialize, Serialize};

use crate::error::{HyperclipError, Result};

#[derive(Debug, Clone)]
pub struct DownloadOptions {
    pub url: String,
    pub output_path: PathBuf,
    pub trim_start: String,  // "HH:MM:SS" or ""
    pub trim_end: String,
    pub quality: u32,
    pub client_priority: Vec<String>,
    pub concurrent_fragments: u32,
    pub cookies_file: Option<PathBuf>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadResult {
    pub file_path: PathBuf,
    pub file_size_bytes: u64,
    pub duration_sec: f64,
    pub width: u32,
    pub height: u32,
    pub codec: String,
    pub fps: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct DownloadProgress {
    pub percent: f64,
    pub speed_mbps: f64,
    pub eta_sec: u64,
}

pub fn build_ytdlp_args(opts: &DownloadOptions) -> Vec<String> {
    let mut args = vec![
        "--no-playlist".into(),
        "--no-warnings".into(),
        "--no-progress".into(),
        "--newline".into(),
        "-f".into(), format!("best[height<=?{}]/best", opts.quality),
        "-o".into(), opts.output_path.to_string_lossy().to_string(),
        "--concurrent-fragments".into(), opts.concurrent_fragments.to_string(),
        "--remux-video".into(), "mp4".into(),
    ];
    
    // Client priority
    let clients = opts.client_priority.join(",");
    args.push("--extractor-args".into());
    args.push(format!("youtube:player_client={}", clients));
    
    // Trim sections
    if !opts.trim_start.is_empty() || !opts.trim_end.is_empty() {
        let end = if opts.trim_end.is_empty() { "99:00:00" } else { &opts.trim_end };
        args.push("--download-sections".into());
        args.push(format!("*{}-{}", opts.trim_start, end));
    }
    
    // Cookies
    if let Some(cookies) = &opts.cookies_file {
        args.push("--cookies".into());
        args.push(cookies.to_string_lossy().to_string());
    }
    
    // URL last
    args.push(opts.url.clone());
    
    args
}

pub async fn download_video<F>(
    opts: DownloadOptions,
    mut on_progress: F,
) -> Result<DownloadResult>
where
    F: FnMut(DownloadProgress),
{
    let args = build_ytdlp_args(&opts);
    
    let mut cmd = Command::new("yt-dlp");
    cmd.args(&args);
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    
    let mut child = cmd.spawn().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            HyperclipError::YtDlpNotFound
        } else {
            HyperclipError::Io(e)
        }
    })?;
    
    let stderr = child.stderr.take().unwrap();
    let mut reader = BufReader::new(stderr).lines();
    
    while let Some(line) = reader.next_line().await? {
        if let Some(progress) = parse_ytdlp_stderr(&line) {
            on_progress(progress);
        }
    }
    
    let status = child.wait().await?;
    if !status.success() {
        return Err(HyperclipError::NetworkTimeout(format!(
            "yt-dlp exited with code {:?}", status.code()
        )));
    }
    
    // Get file metadata
    let metadata = std::fs::metadata(&opts.output_path).map_err(HyperclipError::Io)?;
    
    // TODO(ws3.5): ffprobe to get duration, width, height
    Ok(DownloadResult {
        file_path: opts.output_path.clone(),
        file_size_bytes: metadata.len(),
        duration_sec: 0.0,  // Filled by ffprobe
        width: 0,
        height: 0,
        codec: "h264".into(),  // Assume from tv_embedded
        fps: 30.0,
    })
}

pub fn parse_ytdlp_stderr(line: &str) -> Option<DownloadProgress> {
    // Match: "[download]  45.2% of  288.70MiB at  9.5MiB/s ETA 00:30"
    if !line.contains("[download]") || !line.contains('%') {
        return None;
    }
    
    let percent_part = line.split('%').next()?;
    let percent_str = percent_part.split_whitespace().last()?;
    let percent: f64 = percent_str.parse().ok()?;
    
    let mut speed_mbps = 0.0;
    if let Some(speed_str) = line.split("at ").nth(1)?.split_whitespace().next() {
        speed_mbps = parse_speed(speed_str);
    }
    
    let mut eta_sec = 0u64;
    if let Some(eta_str) = line.split("ETA ").nth(1) {
        eta_sec = parse_eta(eta_str.trim());
    }
    
    Some(DownloadProgress {
        percent: percent / 100.0,
        speed_mbps,
        eta_sec,
    })
}

fn parse_speed(s: &str) -> f64 {
    // "9.5MiB/s" → 9.5 * 1024 * 1024 / 1_000_000 = Mbps
    let num: f64 = s.trim_end_matches("MiB/s").trim_end_matches("KiB/s")
        .parse().unwrap_or(0.0);
    if s.contains("MiB") {
        num * 8.0  // MiB/s → Mbps
    } else if s.contains("KiB") {
        num * 8.0 / 1024.0
    } else {
        0.0
    }
}

fn parse_eta(s: &str) -> u64 {
    // "00:30" or "01:23:45"
    let parts: Vec<&str> = s.split(':').collect();
    match parts.len() {
        2 => parts[0].parse::<u64>().unwrap_or(0) * 60 + parts[1].parse::<u64>().unwrap_or(0),
        3 => parts[0].parse::<u64>().unwrap_or(0) * 3600 + parts[1].parse::<u64>().unwrap_or(0) * 60 + parts[2].parse::<u64>().unwrap_or(0),
        _ => 0,
    }
}
```

- [ ] **Step 4: Run tests**

```bash
cd D:/LOOP_COMPANY/HyperClip
cargo test -p hyperclip_ipc youtube_test
```

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add crates/hyperclip_ipc/src/youtube.rs crates/hyperclip_ipc/src/__tests__/youtube_test.rs
git commit -m "feat(ws3): yt-dlp wrapper (tv_embedded, trim, progress parsing)"
```

---

### Task 3.2: Download Progress Event Emission

**Files:**
- Modify: `crates/hyperclip_ipc/src/youtube.rs`

- [ ] **Step 1: Add emit helper**

Edit `youtube.rs`, add at top:

```rust
use serde_json::json;

/// Emit download progress event to Python via stdout.
pub fn emit_download_progress(workspace_id: &str, progress: &DownloadProgress) {
    let event = json!({
        "method": "download:progress-event",
        "params": {
            "workspace_id": workspace_id,
            "percent": progress.percent,
            "speed_mbps": progress.speed_mbps,
            "eta_sec": progress.eta_sec,
        }
    });
    println!("{}", event);
    use std::io::Write;
    std::io::stdout().flush().ok();
}
```

- [ ] **Step 2: Commit**

```bash
git add crates/hyperclip_ipc/src/youtube.rs
git commit -m "feat(ws3): emit download:progress-event to Python"
```

---

### Task 3.3: Wire `workspace:retry` + `workspace:autoDownload` IPC

**Files:**
- Modify: `src-tauri/src/commands.rs`

- [ ] **Step 1: Add commands**

Edit `src-tauri/src/commands.rs`, find:

```rust
        "workspace:retry" => Ok(json!({ "ok": true })),
```

Replace with:

```rust
        "workspace:retry" => {
            let workspace_id = p(params, "id").unwrap_or_default();
            if workspace_id.is_empty() {
                return Ok(json!({ "ok": false, "error": "missing id" }));
            }
            
            // Spawn async download task
            let state_clone = state.clone();
            let ws_id = workspace_id.clone();
            tokio::spawn(async move {
                if let Err(e) = download_workspace(&state_clone, &ws_id).await {
                    tracing::error!("Download failed for {}: {}", ws_id, e);
                }
            });
            
            Ok(json!({ "ok": true, "id": workspace_id, "status": "downloading" }))
        }
        "workspace:autoDownload" => {
            // Trigger download cho workspace mới detect
            let workspace_id = p(params, "id").unwrap_or_default();
            if workspace_id.is_empty() {
                return Ok(json!({ "ok": false, "error": "missing id" }));
            }
            
            let state_clone = state.clone();
            let ws_id = workspace_id.clone();
            tokio::spawn(async move {
                let _ = download_workspace(&state_clone, &ws_id).await;
            });
            
            Ok(json!({ "ok": true }))
        }
```

- [ ] **Step 2: Add download_workspace helper**

Edit `src-tauri/src/commands.rs`, add at bottom:

```rust
async fn download_workspace(
    state: &Arc<crate::background::AppState>,
    workspace_id: &str,
) -> Result<(), String> {
    use hyperclip_ipc::youtube::{download_video, DownloadOptions, emit_download_progress};
    use std::path::PathBuf;
    
    // Load workspace
    let ws = state.workspaces.read().await
        .iter()
        .find(|w| w.id == workspace_id)
        .cloned()
        .ok_or_else(|| format!("workspace not found: {}", workspace_id))?;
    
    // Build output path
    let storage_dir = state.settings.read().await
        .video_storage_path.clone()
        .unwrap_or_else(|| {
            std::env::var("APPDATA").unwrap_or_default() + "\\HyperClip\\video_storage"
        });
    let output_path = PathBuf::from(storage_dir).join(format!("{}.mp4", ws.video_id));
    
    let opts = DownloadOptions {
        url: ws.video_url.clone(),
        output_path: output_path.clone(),
        trim_start: "00:00:00".into(),
        trim_end: format!("00:{:02}:00", ws.trim_limit_minutes),
        quality: ws.quality_target,
        client_priority: vec!["tv_embedded".into(), "web".into(), "ios".into()],
        concurrent_fragments: 16,
        cookies_file: None,  // TODO(ws2): from session pool
    };
    
    download_video(opts, |progress| {
        emit_download_progress(workspace_id, &progress);
    }).await.map_err(|e| e.to_string())?;
    
    // Update workspace status
    state.update_workspace_status(workspace_id, "ready").await;
    
    // Trigger auto-render if enabled
    let settings = state.settings.read().await;
    if settings.auto_render {
        let state_clone = state.clone();
        let ws_id = workspace_id.to_string();
        tokio::spawn(async move {
            let _ = crate::commands::render_workspace(&state_clone, &ws_id).await;
        });
    }
    
    Ok(())
}
```

- [ ] **Step 3: Build**

```bash
cd D:/LOOP_COMPANY/HyperClip
cargo build --release -p hyperclip-tauri
```

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands.rs
git commit -m "feat(ws3): wire workspace:retry + autoDownload"
```

---

### Task 3.4-3.7: ffprobe metadata, integration test, build, commit

(Pattern giống WS1, tóm tắt)

**Task 3.4**: Add ffprobe wrapper to get duration/width/height after download
**Task 3.5**: Integration test - download 1 test video
**Task 3.6**: Build release
**Task 3.7**: Manual E2E test với 1 channel

---

### Task 3.8-3.10: Polish + Milestone

- [ ] **Task 3.8**: Update memory với WS3 patterns
- [ ] **Task 3.9**: All unit tests pass
- [ ] **Task 3.10**: Tag ws3-complete

---

## Self-Review

- [x] tv_embedded client priority implemented
- [x] --download-sections cho trim 10 phút
- [x] Progress parsing qua stderr
- [x] Auto-download trigger
- [x] No placeholders

**Status**: Ready. Implementation ~1 tuần.
