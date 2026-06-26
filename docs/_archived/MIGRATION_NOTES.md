# Migration Notes — Electron → QML/Rust (2026-06-09)

> Xóa `electron/` và `src/app/` (Next.js) khỏi repo. Dưới đây là các logic quan trọng từ Electron cần verify khi chạy QML/Rust.

---

## 1. Health Alerts (`electron/services/health_alerts.ts`)

6 conditions cần replicate trong Rust:

| Condition | Trigger | Severity | Rust status |
|-----------|---------|----------|-------------|
| Innertube dead | readySessions = 0 | critical | `detection.rs` có comment "Health monitor" — cần verify |
| OAuth quota low | < 10% remaining | warning | Rust `project.rs` có quota tracking |
| OAuth exhausted | all projects exhausted | critical | Rust `project.rs` |
| Disk low | freeGB < 5 | critical | Rust `system.rs` có disk stats |
| Download failures | 3+ consecutive | warning | Chưa thấy implementation |
| No new videos | 24h since last detection | warning | Chưa thấy implementation |

**Thêm:** `ALERT_COOLDOWN_MS = 5 min` giữa các lần gửi cảnh báo trùng.

## 2. Detection Pipeline (`electron/services/subscription_feed.ts`)

Fallback chain quan trọng:
1. **Innertube PRIMARY** (0 quota, ~200ms/request) — scan ALL channels
2. **OAuth DISTRIBUTED** (2 random channels/poll) — ~69k units/day
3. **OAuth FULL COVERAGE** (ALL channels khi Innertube dead) — ~1.7M units/day
4. **RSS fallback** (10 priority channels, 3 concurrent) — slow, final resort

**Edge cases cần verify trong Rust poller:**
- `publishedAt=0` → OAuth verify (`/videos?id=...&part=snippet`) — age filter ≤ 10 phút
- Duration filter từ settings (`videoMinDurationSec` / `videoMaxDurationSec`)
- Uploads playlist ID cache (TTL 24h, persisted to `channels/uploads-cache.json`)
- `MAX_VIDEOS_PER_POLL = 5` — early stop khi đủ video mới
- `MAX_CONCURRENT = 20` channels per batch
- `fetchChannelWithRss()` — fallback cho publishAt=0
- `verifyVideoAgeByOAuth()` — gọi Data API v3 với token từ TokenManager

## 3. yt-dlp Download Strategy (`electron/services/youtube.ts`)

### Client fallback chain:
```
tv_embedded → web → ios
```
- `tv_embedded`: H.264 720p/1080p60 (avc1.64001f/avc1.64002a), bypass EJS qua HLS
- `web`: H.264 360p khi EJS block (với Chrome session cookies)
- `ios`: H.264 fallback cuối

### Format selector:
```
bestvideo[height<=${maxHeight}][fps<=30][vcodec!="none"]+bestaudio / 18/best[height<=${maxHeight}][fps<=30]
```

### Multi-instance download:
- Split video thành N sections, download parallel, merge với FFmpeg concat
- 1080p: up to 6 instances, 720p: up to 4
- Yêu cầu free RAM ≥ 8GB để dùng multi-instance

### Simulated progress:
- `_simulateDownloadProgress()` — chạy fake % khi yt-dlp chưa emit real progress
- Hiển thị speed/ETA fake dựa trên quality (360→2.5MB/s, 1080→18MB/s)

### Pre-check probe:
- `probeVideoAvailability()` — `--dump-json --no-download` với cả 3 clients parallel
- Detect: private / not-found / rate-limited / processing

### Section download (`downloadSectionsAsSeparate`):
- Auto-split: N workspaces, mỗi cái chứa 1 phần, render riêng biệt
- Sequential fallback khi parallel fail

## 4. Auto-Download Chain (`electron/main.ts`)

```
enqueueBgDownload()  →  workspace 'waiting'  →  UI thấy ngay
    ↓
processBgDownloadQueue()  →  maxConcurrent (3 default)
    ↓
autoDownloadFromWebSub()  →  preCheck → download → trim → thumb → blur → auto-render
```

### `autoDownloadFromWebSub()` flow:
1. Update workspace → `downloading`
2. Export Chrome cookies (`getYtCookiesFile()`)
3. Pre-check probe (private → stop, not-found → stop, too short <60s → stop)
4. Auto-split check (if `autoSplitMinutes > 0`)
5. Download via `downloadVideo()` (delegates to `downloadVideoStrategy`)
6. Download failed → classify: permanent (mark seen) vs retryable (set retryableAt)
7. Post-process parallel: thumbnail + videoInfo + trim + blur
8. Duration < 60s → Short → skip
9. Update workspace → `ready`
10. Auto-render trigger (sequential queue, 1 render at a time)

### Auto-render metadata (`buildAutoRenderMetadata()`):
- Priority: user-edited renderMetadata > global auto-render settings
- Template: `{title}` → videoTitle, `{channel}` → channelName
- Default: 480×480 @ 30fps, hevc, p1/ull, blur background
- Auto-split: chunkDuration set to section duration → 1 chunk per workspace

### Startup logic:
- `triggerAutoRenderForReadyWorkspaces()` — catch-up 'ready' workspaces chưa được auto-render
- `scanExistingDownloadedFiles()` — register existing files as "seen"
- `resolveChannelIdsForPoll()` — resolve @handle → UCxxx cho channels bị thiếu channelId

## 5. Store Schema (`electron/services/store.ts`)

### `WorkspaceData` — fields cần match với Rust:
```typescript
{
  id, channelId, channelName, channelColor, videoId, videoTitle, videoUrl,
  thumbnail, duration, trimLimit, status, renderProgress, downloadProgress,
  downloadedAt, downloadedPath, blurBackgroundPath, outputPath, metadataPath,
  fileSize, renderMetadata, createdAt, updatedAt,
  isShort?, publishedAt?, detectedAt?, retryableAt?, videoResolution?,
  downloadQuality?, preScaledPath?, autoRenderAttempted?, availableFormats?,
  metrics?  // { detectedAt, downloadMs, downloadQuality, downloadResolution, ... }
}
```

### Status values:
`waiting | downloading | ready | editing | rendering | done | error`

### `SeenVideosStore`:
```typescript
{ [channelId: string]: { ids: string[]; expiresAt: number } }
```
- TTL: 48h per channel
- Marked seen only AFTER successful download (không block retry)

### `RenderedVideoRecord`:
- `id`, `workspaceId`, `channelId`, `channelName`, `videoTitle`
- `archivedPath`, `outputPath`, `quality`, `codec`, `fileSize`, `fileSizeBytes`
- `duration`, `thumbnail`, `thumbnailData?`, `videoResolution?`
- `renderedAt`, `renderDurationMs?`, `renderConfig?`, `sourceInfo?`
- Capped: max 500 entries, max 30 days

## 6. Token Manager (`electron/services/token_manager.ts`)

### Key logic:
- `getBestAvailable(channelId?)` — assigned project → least-used project fallback
- Auto-refresh token nếu hết hạn trong 5 phút
- Backup project cho channel
- Proactive refresh: 30 min interval, check startup
- Legacy migration: reads `oauth_tokens.json` / `oauth_config.json` → project structure
- Token refresh rate limit: check reset định kỳ 30 min
- MAX_UNITS_PER_TOKEN = 9500

## 7. Other Services (đã port hoặc không critical)

| File | Logic | Ported? |
|------|-------|---------|
| `ramdisk.ts` | Path resolution, settings load/save | Rust `store.rs` |
| `paths.ts` | `getAppStoreDir()`, `getVideoStoragePath()` | Rust |
| `youtube_poller.ts` | Poller orchestration | Rust `poller.rs` |
| `innertube_client.ts` | Innertube pool, getLatestVideos | Rust `innertube_pool.rs` |
| `chrome_cookies.ts` | Chrome DPAPI + SQLite extraction | Rust `cookies.rs` |
| `ffmpeg.ts` | Render pipeline, filter chain, NVENC params | Rust `ffmpeg.rs` |
| `worker-pool.ts` | FFmpeg process management | Chưa port |
| `unified_log.ts` | Structured logging | Rust `tracing` |

## 8. Cross-Machine Path Compatibility

Electron store dùng `makeStorableDownloadedPath()`:
- `downloadedPath` chỉ lưu filename (basename), không lưu absolute path
- `resolveDownloadedPath()` quét multi-storage-dirs để tìm file
- File-index cache 60s TTL

Cần verify Rust store làm tương tự.

---

> File này giữ lại trong `docs/` để tham khảo. Khi Rust đã replicate toàn bộ logic, có thể xóa.
