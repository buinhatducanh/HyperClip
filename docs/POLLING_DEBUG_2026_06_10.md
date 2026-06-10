# Polling Debug — 2026-06-10

## Root causes (tất cả đã fix)

### 1. youtubei.js v17 LockupView format
`getVideos().videos` empty — YouTube trả LockupView thay vì GridVideo.
**Fix:** `extractFromLockupView()` parse trực tiếp từ page memo.

### 2. Channel ID không phải UC format
yt-dlp không available → `resolve_channel_metadata()` fail → channelId lưu handle thay vì UC ID.
**Fix:** `resolveChannelId()` trong JS helper.

### 3. publishedAt seconds vs milliseconds
JS helper trả Unix **seconds**, Rust poller dùng **milliseconds**.
**Fix:** `v.publishedAt * 1000`

### 4. Settings lưu flat JSON
Python ghi `{"autoDownloadMaxAgeMinutes": 1440}`, Rust SettingsStore expect `{"settings": {...}}`.
**Fix:** Flat JSON fallback trong `store.rs`.

### 5. child.wait() deadlock
`stdin.as_mut()` giữ pipe mở → Node không thấy EOF → `child.wait()` treo vô hạn → thread pool exhausted.
**Fix:** `child.kill()` trước `child.wait()`.

### 6. Poller không fire
`rt.spawn()` trên current-thread runtime không có thread driver.
**Fix:** `std::thread::spawn` + `block_on`.

### 7. Node exit trước async hoàn thành (CURRENT)
`stdin.take()` → EOF → `process.stdin.on('end', () => process.exit(0))` → Node exit trước `getLatestVideo()`.
**Fix (đang build):** Remove `on('end')` handler, Rust force-kill sau khi đọc response.

## Files changed

| File | Fix |
|------|-----|
| `innertube_helper.js` | LockupView, handle→UC, temp file write |
| `innertube_client.rs` | child.kill, *1000, tokio::process |
| `poller.rs` | Sequential (no tokio::spawn) |
| `store.rs` | Flat JSON fallback |
| `commands.rs` | thread::spawn + block_on |

## Cần verify tiếp

- **Windows pipe buffering:** `fs.writeSync(1)` vẫn bị delay trên pipe → chuyển temp file
- **tokio::process::Command** cần import `AsyncWriteExt` cho `write_all`

## Build hiện tại
Binary: 1781075117 (thiếu import AsyncWriteExt)
