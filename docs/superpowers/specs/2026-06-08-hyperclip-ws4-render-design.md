# WS4: Render Pipeline — Design

**Date**: 2026-06-08
**Status**: Approved
**Goal**: Wire FFmpeg + NVENC render với full flags (hevc_nvenc/h264_nvenc, p1 preset, ull tune, CUDA filter), chunked mode, auto-render trigger after download, progress parsing → QML events.

## Architecture

Rust spawns FFmpeg subprocess (`tokio::process::Command`). Filter chain cho SHORT (bg→video→header→bottom_bar). GPU tier auto-detect via `get_gpu_config()`. WorkerPool (Semaphore) cap concurrent renders.

```
User clicks "Render" / Download completes
         ↓
render:start IPC command
         ↓
commands.rs acquires WorkerPermit → spawn_render_async()
         ↓
tokio::process::Command → FFmpeg subprocess
    ├── stdout = null
    └── stderr = piped → parse_ffmpeg_stderr() → on_progress(0.0..1.0)
         ↓
progress → stdout JSON-RPC "render:progress-event" { workspace_id, progress }
         ↓
Python EventBus → QML progress bar update
```

## Changes

### 1. Fix `ffmpeg.rs` — `spawn_render_async` production-ready

- Add `workspace_id: String` field to `RenderOptions`
- GPU tier → codec: High/Ada → HEVC, Mid/Low → H.264
- CRF: single=18, chunked=20
- CUDA filter: `scale_cuda`/`overlay_cuda` khi GPU tier != Software
- `-maxrate`/`-bufsize` per resolution: 1080p→12M/12M, 720p→6M, 360p→3M
- `-hwaccel cuda -hwaccel_output_format cuda` khi CUDA enabled
- Dynamische canvas size từ `opts.resolution`
- **Lifetime fix**: dùng `tokio::io::split` thay vì spawn task mượn `reader`
- Filter chain dùng `use_cuda` parameter từ gpu_tier

### 2. `worker_pool.rs` (mới)

Semaphore-based concurrent render cap.

```rust
pub struct WorkerPool {
    semaphore: Semaphore,
    max: usize,
    active: AtomicUsize,
}

pub struct WorkerPermit<'a> { ... }  // RAII: decrement active on drop

impl WorkerPool {
    pub fn new(max: usize) -> Self;
    pub async fn acquire(&self) -> WorkerPermit<'_>;
    pub fn try_acquire(&self) -> Option<WorkerPermit<'_>>;
    pub fn max_workers(&self) -> usize;
    pub fn active_count(&self) -> usize;
}
```

### 3. Wire `render:start` / `render:cancel` / `render:chunked`

**render:start** — Tìm workspace, build RenderOptions, acquire permit, spawn async task:

```
render:start { id }
  → find workspace từ store
  → build RenderOptions (resolution, fps, speed, trim từ workspace settings)
  → acquire WorkerPool permit
  → tokio::spawn(async { spawn_render_async(opts, progress_cb).await })
  → return { ok: true, id, status: "rendering" }
```

**render:cancel** — dùng `CancellationToken` per render. Map `HashMap<String, CancellationToken>` trong AppState:

```
render:cancel { id }
  → tìm CancellationToken cho workspace_id
  → cancel → FFmpeg child.kill()
  → cleanup: update workspace status → "ready"
```

**Progress events**: Trong callback `on_progress`, ghi stdout JSON:

```json
{"method": "render:progress-event", "params": {"workspace_id": "...", "progress": 0.5}}
```

Python EventBus đọc stdout và emit Qt signal.

### 4. Auto-render trigger

Sau khi download hoàn tất (trong `download_workspace` hoặc event handler), auto-submit `render:start` nếu `settings.auto_render == true`.

### 5. Chunked mode (bonus task)

Video > `chunk_duration_sec` → split thành chunks:
1. Giống `--download-sections` pattern: concat-demuxer
2. Mỗi chunk render riêng → concat `ffmpeg -f concat -safe 0`
3. Không implement nếu `chunked == false`

### File plan

| File | Action |
|---|---|
| `crates/hyperclip_ipc/src/ffmpeg.rs` | Sửa — NVENC flags, GPU tier, CUDA, workspace_id, lifetime fix |
| `crates/hyperclip_ipc/src/worker_pool.rs` | Mới — Semaphore pool |
| `crates/hyperclip_ipc/src/lib.rs` | Sửa — thêm `pub mod worker_pool; pub use worker_pool::*;` |
| `src-tauri/src/commands.rs` | Sửa — `render:start/cancel/chunked` handlers real |
| `src-tauri/src/main.rs` | Sửa — thêm AppState render pool, cancel map |
| `src/models/types.py` | Sửa — thêm `render_progress` field cho WorkspaceData |
| `src/main.py` | Sửa — EventBus listener cho `render:progress-event` |

## Self-Review

- [x] NVENC per GPU tier — HEVC cho High/Ada, H.264 cho Mid/Low
- [x] CUDA filter chain (`scale_cuda`) khi GPU hỗ trợ
- [x] WorkerPool cap concurrent (GPU tier-aware `max_workers`)
- [x] Workspace ID trong progress events
- [x] Auto-render trigger sau download
- [x] Render cancel via CancellationToken
- [x] Chunked mode option
- [x] No placeholders, no contradictions
