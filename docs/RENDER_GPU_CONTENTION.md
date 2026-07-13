# Render ↔ GPU Contention (2026-07-11)

## Timeline của vấn đề

### Pass 1: Render ↔ Chrome tabs (12:56 �� 13:13)

| Log | Render FPS | Tốc độ |
|---|---|---|
| `12-56-01` | 826 fps | 27.5x |
| `13-13-21` (Chrome tabs mở đồng thời) | 515 fps | 17.2x |

**Fix**: `ensure_chrome_tabs_open` đợi render xong + 30s startup grace.

### Pass 2: Render ↔ Poller (13:13 → 13:56)

Sau khi fix Chrome, render phục hồi lên **1341 fps** (patch_s1 thành công). Tuy nhiên ở log `13-56-12`, video `mqyuBtkXgSg` chỉ đạt **791 fps**:

```
06:01:07.255  Spawning FFmpeg
06:01:10.454  Poller Spawning 8 parallel poll tasks (cap=8, channels=27)
              ↑ render đang chạy, poller vẫn spawn 27 HTTP requests song song
06:01:13.951  Auto-render completed
              render FPS: 791 (frame cuối) — regress 40% so với 1341
```

**Root cause**: Poller **vẫn poll 27 channels** ngay lúc render chạy → 27 concurrent HTTP calls đến youtubei daemon → CPU/I/O contention với NVENC.

### Pass 4: Channel resolution 5s saved — log 17-21-46

Video `pUjPRNl3F3E` (Chrome detect, channel_id trống):

```
08:25:33.009  ChromeWatcher NEW VIDEO detected (channel_id = "")
              ↓ 6.58s gap
08:25:39.591  Spawning yt-dlp
08:25:45.319  Auto-download complete (6.5 MB)
08:25:51.075  Auto-render completed

E2E: 18.07s
```

**Root cause**: Chrome detect video từ URL `youtube.com/watch?v=X` → không biết channel → phải resolve qua Innertube (`acquire_session` loop với timeout 5s) → Poller chiếm 30 sessions → wait 5s → fail → fallback yt-dlp resolve → cộng dồn thành 6.58s.

**Fix B**: Cache channel_id từ open channel tabs (`youtube.com/@handle/videos` hoặc `/channel/UCxxx/videos`). Khi Chrome detect watch tab video → lấy channel_id đầu tiên trong cache → truyền vào `NewVideoEvent` → commands.rs thấy `channel_id` không rỗng → skip Innertube resolve.

Implementation tại [chrome_watcher.rs](crates/hyperclip_ipc/src/chrome_watcher.rs):
- `extract_channel_from_tab_url()` parse `@handle` hoặc `/channel/UCxxx`
- `cached_channel_ids: Arc<Mutex<HashMap>>` — refresh mỗi poll cycle
- Lookup channel store bằng handle → lấy internal `ch-xxx` id

**Kỳ vọng**: gap detect→download từ 6.58s → <1s. E2E xuống ~13s.

### Pass 4b: download-sections threshold 30min — log 18-01-14

Video `w5zDwVFQi4k` (15 phút, Poller detect, duration=911s):

```
09:01:27.093  Spawning yt-dlp (NO --download-sections)
09:01:35.856  Trimming file to 180s (duration=911s, 5x oversized)
09:01:36.101  Auto-download complete (6.0 MB trimmed)
              Download 8.76s cho ~20MB full → 1 MB/s LAN
```

**Root cause**: threshold `dur <= 10min` → `911 > 600` → skip download-sections → tải FULL 15 phút rồi trim.

**Fix**: threshold `10min → 30min`. Video 360p ≤30 phút: network savings (~50-70%) outweigh ffmpeg streaming overhead. Tiết kiệm ~4.7s cho video 15 phút.

### Pass 3: Download optimization (<5s goal) — log 16-08-43

Video `TS6OEWLH9fc` (3 phút, 360p):

```
07:09:07.864  ChromeWatcher NEW VIDEO detected
07:09:15.924  Spawning yt-dlp (cookies=false)
07:09:24.052  Trimming file to 180s
07:09:24.918  Auto-download complete (6.6 MB)
07:09:27.739  Spawning FFmpeg
07:09:32.354  Auto-render completed (1210 fps, 4.05s)

E2E: 24.5s — quá 15s budget
Download full: 8.13s — bottleneck #1
```

**Root cause**: `[Youtube] Skipping --download-sections for 360p quality` tại [youtube.rs:447](crates/hyperclip_ipc/src/youtube.rs#L447) từng skip option `--download-sections` cho format 18 (360p), dẫn đến tải FULL video ~8MB rồi trim local.

**Fix**: Bỏ giới hạn `quality ≤ 360`. Đổi threshold `30min` → `10min` — cho phép `--download-sections` khi video ≤ 10 phút (network savings 50-70% > ffmpeg overhead).

```rust
// Trước
let use_download_sections = if quality <= 360 { false }
else if let Some(dur) = actual_duration_sec { trim_minutes > 0 && dur > 30*60 }
else { false };

// Sau
let use_download_sections = if let Some(dur) = actual_duration_sec {
    trim_minutes > 0 && dur <= 10*60
} else { false };
```

**Kỳ vọng**: video 3 phút 360p tải ~3MB thay vì 8MB → giảm download từ 8.13s → ~3-4s. E2E xuống ~13s.

### Pass 3: Download 22s + Detection 11s (cùng log 13-56-12)

Video `mqyuBtkXgSg` E2E = 28.6s, vượt budget 15s:

```
06:00:45.343  Spawning yt-dlp
06:01:04.833  Auto-download complete       (download 19.5s — tải FULL rồi trim local)
06:01:07.255  Spawning FFmpeg              (gap 2.4s = trim + setup)
06:01:13.951  Auto-render completed        (render 6.7s nhưng FPS regress)
```

Video `Zk_TR-0mpyg` fail:
```
06:08:51.841  ChromeWatcher: NEW VIDEO detected from Chrome channel tab
06:09:06.032  yt-dlp failed - "Video unavailable" (retry 11s)
```
→ Detection chỉ 1-2s, **retry overhead 11s** do yt-dlp thử nhiều player client (web, android) trước khi báo unavailable.

## Tổng fix pass 2 (2026-07-11)

Thêm `active_renders: Arc<AtomicI32>` được share giữa `Poller` và `AppState`:

- **Poller** [poller.rs:216-229](crates/hyperclip_ipc/src/poller.rs#L216-L229): `poll_once()` defer 100ms/lần, tối đa 3s, khi `active_renders > 0`.
- **AppState**: counter dùng chung với Poller.
- **Render paths** (auto [commands.rs:786](src-tauri/src/commands.rs#L786) và manual [commands.rs:3258](src-tauri/src/commands.rs#L3258)): `fetch_add(1)` khi bắt đầu, `fetch_sub(1)` khi xong.

## Trade-off

- Poller có thể delay tới **3s** khi render active. Trong 3s đó nếu có video mới upload → vẫn được ChromeWatcher catch (< 2s latency).
- Render encode **hồi phục 1341 fps** thay vì 791 fps.
- E2E budget 15s khả thi hơn: download 10s + render 3.7s + gap 1.3s = 15s.

## Vấn đề còn lại (out of scope cho pass này)

1. **Download 19s** — tải FULL video rồi trim local. Format `-f 18` (iPhone 360p) không hỗ trợ `--download-sections`. Cần đổi format ưu tiên hoặc pre-trim bằng cách khác.
2. **yt-dlp retry 11s cho video unavailable** — retry policy quá aggressive. Có thể skip sớm hơn sau 1 attempt.

## Test

- ✅ `cargo build -p hyperclip-tauri` — 0 errors.
- Patch: `release/HyperClip-Patch-2026*.zip` (xem lúc build).
- Render tiếp theo → so sánh FPS encode để verify cải thiện (kỳ vọng > 1000 fps).