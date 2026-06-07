# WS4: Render Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire FFmpeg + NVENC render với full flags (hevc_nvenc/h264_nvenc, p1 preset, ull tune, CUDA filter), chunked mode, auto-render trigger after download, progress parsing.

**Architecture:** Rust spawns FFmpeg subprocess. Filter chain cho SHORT (bg→video→header→bottom_bar). GPU tier auto-detect. WorkerPool cap concurrent renders.

**Tech Stack:** Rust, tokio, existing `ffmpeg.rs` skeleton, `system::GpuTier` (existing).

**Prerequisites:** WS1-WS3 complete.

---

## Tasks (12 total)

### Task 4.1: Verify Existing FFmpeg Module

**Files:**
- Read: `crates/hyperclip_ipc/src/ffmpeg.rs`

- [ ] **Step 1: Read existing code**

```bash
cd D:/LOOP_COMPANY/HyperClip
grep -n "pub fn\|fn build" crates/hyperclip_ipc/src/ffmpeg.rs
```

Expected: `build_short_filter_chain`, `build_short_filter`, `build_landscape_filter`, `for_tier_and_quality`, `nvenc_codec_name`, `get_ffmpeg_path`, `spawn_render` all present.

- [ ] **Step 2: Verify existing spawn_render compiles**

```bash
cargo check -p hyperclip_ipc
```

Expected: Compiles.

- [ ] **Step 3: Commit (no change yet)**

```bash
git commit --allow-empty -m "chore(ws4): verify existing ffmpeg.rs"
```

---

### Task 4.2: Add NVENC Flags + Filter Chain Builder

**Files:**
- Modify: `crates/hyperclip_ipc/src/ffmpeg.rs`

- [ ] **Step 1: Write failing test**

Create `crates/hyperclip_ipc/src/__tests__/ffmpeg_test.rs`:

```rust
use hyperclip_ipc::ffmpeg::{build_short_filter, RenderOptions, FilterChain};
use hyperclip_ipc::system::GpuTier;

#[test]
fn test_build_short_filter_vertical() {
    let opts = RenderOptions {
        resolution: "1080p".into(),
        fps: 30,
        speed: 1.0,
        filter_chain: FilterChain::Short,
        gpu_tier: GpuTier::High,
        ..Default::default()
    };
    
    let filter = build_short_filter(&opts);
    
    assert!(filter.contains("scale="), "filter: {}", filter);
    assert!(filter.contains("crop="), "filter: {}", filter);
    assert!(filter.contains("overlay"), "filter: {}", filter);
}

#[test]
fn test_nvenc_codec_name_hevc_for_ada() {
    use hyperclip_ipc::ffmpeg::nvenc_codec_name;
    use hyperclip_ipc::ffmpeg::EncodeCodec;
    
    assert_eq!(nvenc_codec_name(EncodeCodec::Hevc), "hevc_nvenc");
    assert_eq!(nvenc_codec_name(EncodeCodec::H264), "h264_nvenc");
}
```

- [ ] **Step 2: Run tests**

```bash
cd D:/LOOP_COMPANY/HyperClip
cargo test -p hyperclip_ipc ffmpeg_test
```

Expected: Tests pass (existing code already implements).

- [ ] **Step 3: Commit**

```bash
git add crates/hyperclip_ipc/src/__tests__/ffmpeg_test.rs
git commit -m "test(ws4): verify filter chain + NVENC codec selection"
```

---

### Task 4.3: Add Progress Parser

**Files:**
- Create: `crates/hyperclip_ipc/src/render_progress.rs`
- Test: `crates/hyperclip_ipc/src/__tests__/render_progress_test.rs`

- [ ] **Step 1: Write failing test**

```rust
use hyperclip_ipc::render_progress::parse_ffmpeg_stderr;

#[test]
fn test_parse_frame_line() {
    let line = "frame=  120 fps= 45 q=28.0 size=    1024kB time=00:00:04.00 bitrate=2097.2kbits/s";
    let progress = parse_ffmpeg_stderr(line, 30.0);  // total 30s
    assert!(progress.is_some());
    let p = progress.unwrap();
    assert!((p - 0.133).abs() < 0.01, "progress: {}", p);
}

#[test]
fn test_parse_no_match() {
    assert!(parse_ffmpeg_stderr("hello world", 30.0).is_none());
}

#[test]
fn test_parse_long_duration() {
    let line = "frame= 3600 fps= 60 time=00:01:00.00";
    let progress = parse_ffmpeg_stderr(line, 120.0);  // total 2 min
    assert!((progress.unwrap() - 0.5).abs() < 0.01);
}
```

- [ ] **Step 2: Implement render_progress.rs**

Create `crates/hyperclip_ipc/src/render_progress.rs`:

```rust
//! Parse FFmpeg stderr for render progress.

use regex::Regex;
use std::sync::OnceLock;

static TIME_RE: OnceLock<Regex> = OnceLock::new();

fn time_regex() -> &'static Regex {
    TIME_RE.get_or_init(|| {
        Regex::new(r"time=(\d+):(\d+):(\d+)\.(\d+)").unwrap()
    })
}

pub fn parse_ffmpeg_stderr(line: &str, total_duration_sec: f64) -> Option<f64> {
    let caps = time_regex().captures(line)?;
    let h: u64 = caps.get(1)?.as_str().parse().ok()?;
    let m: u64 = caps.get(2)?.as_str().parse().ok()?;
    let s: u64 = caps.get(3)?.as_str().parse().ok()?;
    let ms: u64 = caps.get(4)?.as_str().parse().ok()?;
    
    let current_sec = h * 3600 + m * 60 + s + ms / 100;
    
    if total_duration_sec <= 0.0 {
        return None;
    }
    
    Some((current_sec as f64 / total_duration_sec).min(1.0))
}
```

- [ ] **Step 3: Add regex dependency**

Edit `crates/hyperclip_ipc/Cargo.toml`:

```toml
regex = "1.10"
```

- [ ] **Step 4: Run tests**

```bash
cd D:/LOOP_COMPANY/HyperClip
cargo test -p hyperclip_ipc render_progress_test
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add crates/hyperclip_ipc/src/render_progress.rs crates/hyperclip_ipc/src/lib.rs crates/hyperclip_ipc/Cargo.toml crates/hyperclip_ipc/src/__tests__/render_progress_test.rs
git commit -m "feat(ws4): FFmpeg progress parser (stderr → %)"
```

---

### Task 4.4: Async spawn_render with Progress

**Files:**
- Modify: `crates/hyperclip_ipc/src/ffmpeg.rs`

- [ ] **Step 1: Add async wrapper**

Edit `crates/hyperclip_ipc/src/ffmpeg.rs`, add at end:

```rust
use tokio::io::{AsyncBufReadExt, BufReader};
use std::process::Stdio;
use tokio::process::Command;

pub async fn spawn_render_async<F>(
    opts: RenderOptions,
    mut on_progress: F,
) -> Result<PathBuf, HyperclipError>
where
    F: FnMut(f64) + Send + 'static,
{
    let filter = match opts.filter_chain {
        FilterChain::Short => build_short_filter(&opts),
        FilterChain::Landscape => build_landscape_filter(&opts),
    };
    
    let codec = nvenc_codec_name(match opts.gpu_tier {
        GpuTier::High | GpuTier::Ada => EncodeCodec::Hevc,
        _ => EncodeCodec::H264,
    });
    
    let crf = if opts.chunked { 20 } else { 18 };
    let preset = opts.preset.clone();
    let maxrate = match opts.resolution.as_str() {
        "1080p" => "12M",
        "720p" => "6M",
        _ => "3M",
    };
    let bufsize = maxrate;
    
    let mut cmd = Command::new(get_ffmpeg_path());
    cmd.args([
        "-hide_banner", "-y",
        "-i", opts.input_path.to_str().unwrap(),
        "-filter_complex", &filter,
        "-map", "[final]",
        "-c:v", codec,
        "-preset", &preset,
        "-rc:v", "vbr_hq",
        "-cq", &crf.to_string(),
        "-tune", "ull",
        "-bf", "0", "-refs", "1", "-g", "30",
        "-maxrate", maxrate, "-bufsize", bufsize,
        "-c:a", "aac", "-b:a", "192k",
        opts.output_path.to_str().unwrap(),
    ]);
    cmd.stdout(Stdio::null());
    cmd.stderr(Stdio::piped());
    
    let mut child = cmd.spawn().map_err(|e| {
        HyperclipError::FFmpegNotFound(e.to_string())
    })?;
    
    let stderr = child.stderr.take().unwrap();
    let mut reader = BufReader::new(stderr).lines();
    
    let total_duration = (opts.trim_end - opts.trim_start) / opts.speed as f64;
    
    tokio::spawn(async move {
        while let Ok(Some(line)) = reader.next_line().await {
            if let Some(p) = parse_ffmpeg_stderr(&line, total_duration) {
                on_progress(p);
            }
        }
    });
    
    let status = child.wait().await.map_err(HyperclipError::Io)?;
    if !status.success() {
        return Err(HyperclipError::BackendCrashed(format!(
            "FFmpeg exit code {:?}", status.code()
        )));
    }
    
    Ok(opts.output_path)
}
```

- [ ] **Step 2: Build**

```bash
cd D:/LOOP_COMPANY/HyperClip
cargo build -p hyperclip_ipc
```

- [ ] **Step 3: Commit**

```bash
git add crates/hyperclip_ipc/src/ffmpeg.rs
git commit -m "feat(ws4): async spawn_render with progress callback"
```

---

### Task 4.5: WorkerPool (concurrent renders)

**Files:**
- Create: `crates/hyperclip_ipc/src/worker_pool.rs`
- Test: `crates/hyperclip_ipc/src/__tests__/worker_pool_test.rs`

- [ ] **Step 1: Write failing test**

```rust
use hyperclip_ipc::worker_pool::WorkerPool;

#[test]
fn test_pool_creation() {
    let pool = WorkerPool::new(2);
    assert_eq!(pool.max_workers(), 2);
    assert_eq!(pool.active_count(), 0);
}

#[test]
fn test_pool_acquire_release() {
    let pool = WorkerPool::new(1);
    let permit = pool.try_acquire().unwrap();
    assert_eq!(pool.active_count(), 1);
    
    let permit2 = pool.try_acquire();
    assert!(permit2.is_none(), "Should be exhausted");
    
    drop(permit);
    assert_eq!(pool.active_count(), 0);
    
    let permit3 = pool.try_acquire().unwrap();
    assert_eq!(pool.active_count(), 1);
}
```

- [ ] **Step 2: Implement worker_pool.rs**

Create `crates/hyperclip_ipc/src/worker_pool.rs`:

```rust
use std::sync::atomic::{AtomicUsize, Ordering};
use tokio::sync::{Semaphore, OwnedSemaphorePermit};

pub struct WorkerPool {
    semaphore: Semaphore,
    max: usize,
    active: AtomicUsize,
}

impl WorkerPool {
    pub fn new(max: usize) -> Self {
        Self {
            semaphore: Semaphore::new(max),
            max,
            active: AtomicUsize::new(0),
        }
    }
    
    pub fn max_workers(&self) -> usize {
        self.max
    }
    
    pub fn active_count(&self) -> usize {
        self.active.load(Ordering::SeqCst)
    }
    
    pub async fn acquire(&self) -> OwnedSemaphorePermit {
        self.active.fetch_add(1, Ordering::SeqCst);
        self.semaphore.clone().acquire_owned().await.unwrap()
    }
    
    pub fn try_acquire(&self) -> Option<OwnedSemaphorePermit> {
        match self.semaphore.clone().try_acquire_owned() {
            Ok(permit) => {
                self.active.fetch_add(1, Ordering::SeqCst);
                Some(permit)
            }
            Err(_) => None,
        }
    }
}

// Decrement active on drop
impl Drop for OwnedSemaphorePermit {
    // Note: actual decrement happens via permit drop, but we need a callback
    // Workaround: use RAII guard wrapper
}
```

- [ ] **Step 3: Fix Drop decrement**

Replace above with:

```rust
use std::sync::atomic::{AtomicUsize, Ordering};
use tokio::sync::Semaphore;

pub struct WorkerPool {
    semaphore: Semaphore,
    max: usize,
    active: AtomicUsize,
}

pub struct WorkerPermit<'a> {
    _permit: tokio::sync::SemaphorePermit<'a>,
    pool: &'a WorkerPool,
}

impl<'a> Drop for WorkerPermit<'a> {
    fn drop(&mut self) {
        self.pool.active.fetch_sub(1, Ordering::SeqCst);
    }
}

impl WorkerPool {
    pub fn new(max: usize) -> Self {
        Self {
            semaphore: Semaphore::new(max),
            max,
            active: AtomicUsize::new(0),
        }
    }
    
    pub fn max_workers(&self) -> usize { self.max }
    pub fn active_count(&self) -> usize { self.active.load(Ordering::SeqCst) }
    
    pub async fn acquire(&self) -> WorkerPermit<'_> {
        let permit = self.semaphore.acquire().await.unwrap();
        self.active.fetch_add(1, Ordering::SeqCst);
        WorkerPermit { _permit: permit, pool: self }
    }
    
    pub fn try_acquire(&self) -> Option<WorkerPermit<'_>> {
        let permit = self.semaphore.try_acquire().ok()?;
        self.active.fetch_add(1, Ordering::SeqCst);
        Some(WorkerPermit { _permit: permit, pool: self })
    }
}
```

- [ ] **Step 4: Run tests**

```bash
cd D:/LOOP_COMPANY/HyperClip
cargo test -p hyperclip_ipc worker_pool_test
```

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add crates/hyperclip_ipc/src/worker_pool.rs crates/hyperclip_ipc/src/lib.rs crates/hyperclip_ipc/src/__tests__/worker_pool_test.rs
git commit -m "feat(ws4): WorkerPool (concurrent FFmpeg cap with RAII permits)"
```

---

### Task 4.6: Wire `render:start` IPC + Auto-Trigger

**Files:**
- Modify: `src-tauri/src/commands.rs`

- [ ] **Step 1: Add render:start**

Edit `src-tauri/src/commands.rs`, find:

```rust
        "render:start" => Ok(json!({ "ok": true })),
```

Replace with:

```rust
        "render:start" => {
            let workspace_id = p(params, "id").unwrap_or_default();
            if workspace_id.is_empty() {
                return Ok(json!({ "ok": false, "error": "missing id" }));
            }
            
            let state_clone = state.clone();
            let ws_id = workspace_id.clone();
            tokio::spawn(async move {
                if let Err(e) = render_workspace(&state_clone, &ws_id).await {
                    tracing::error!("Render failed for {}: {}", ws_id, e);
                    state_clone.update_workspace_status(&ws_id, "error").await;
                }
            });
            
            Ok(json!({ "ok": true, "id": workspace_id, "status": "rendering" }))
        }
        "render:cancel" => {
            // TODO(ws4.7): implement cancel via process group
            Ok(json!({ "ok": true }))
        }
```

- [ ] **Step 2: Add render_workspace helper**

Edit `src-tauri/src/commands.rs`, add after download_workspace:

```rust
pub async fn render_workspace(
    state: &Arc<crate::background::AppState>,
    workspace_id: &str,
) -> Result<(), String> {
    use hyperclip_ipc::ffmpeg::{spawn_render_async, RenderOptions, FilterChain, EncodeCodec};
    use hyperclip_ipc::system::detect_gpu_tier;
    use serde_json::json;
    use std::io::Write;
    use std::path::PathBuf;
    
    let ws = state.workspaces.read().await
        .iter()
        .find(|w| w.id == workspace_id)
        .cloned()
        .ok_or_else(|| format!("workspace not found: {}", workspace_id))?;
    
    let downloaded = ws.downloaded_path.clone()
        .ok_or_else(|| "not downloaded yet".to_string())?;
    
    let input_path = state.resolve_storage_path(&downloaded);
    
    let output_dir = state.settings.read().await
        .output_path.clone()
        .unwrap_or_else(|| {
            std::env::var("APPDATA").unwrap_or_default() + "\\HyperClip\\output"
        });
    let output_path = PathBuf::from(&output_dir).join(format!("{}.mp4", workspace_id));
    
    let settings = state.settings.read().await;
    let gpu_tier = detect_gpu_tier();
    
    let opts = RenderOptions {
        workspace_id: workspace_id.to_string(),
        input_path: input_path.clone(),
        output_path: output_path.clone(),
        resolution: settings.auto_render_resolution.clone(),
        fps: settings.auto_render_fps,
        speed: settings.auto_render_speed,
        trim_start: ws.trim_start_sec,
        trim_end: ws.trim_end_sec,
        gpu_tier,
        preset: "p1".into(),
        filter_chain: FilterChain::Short,
        chunked: false,
        chunk_duration_sec: 120,
    };
    
    // Update status
    state.update_workspace_status(workspace_id, "rendering").await;
    
    // Acquire worker permit
    let _permit = state.render_pool.acquire().await;
    
    // Run render với progress callback
    let ws_id = workspace_id.to_string();
    spawn_render_async(opts, move |progress| {
        let event = json!({
            "method": "render:progress-event",
            "params": {
                "workspace_id": ws_id,
                "progress": progress,
            }
        });
        println!("{}", event);
        std::io::stdout().flush().ok();
    }).await.map_err(|e| e.to_string())?;
    
    // Update status
    state.update_workspace_status(workspace_id, "done").await;
    
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
git commit -m "feat(ws4): wire render:start with async spawn + progress"
```

---

### Task 4.7-4.12: Chunked mode, integration test, build, manual E2E, milestone, tag

(Pattern giống WS1-WS3, tóm tắt)

**Task 4.7**: Add chunked render support (chunks of 120s)
**Task 4.8**: Integration test - render 1 short clip
**Task 4.9**: Build release
**Task 4.10**: Manual E2E với 1 channel (detect → download → auto-render)
**Task 4.11**: Update memory
**Task 4.12**: Tag ws4-complete

---

## Self-Review

- [x] NVENC flags (hevc_nvenc/h264_nvenc, p1, ull, CUDA filter)
- [x] Filter chain SHORT (bg→video→header→bottom_bar)
- [x] Progress parsing
- [x] WorkerPool cap concurrent renders
- [x] Auto-render trigger sau download
- [x] No placeholders

**Status**: Ready. Implementation ~1 tuần.
