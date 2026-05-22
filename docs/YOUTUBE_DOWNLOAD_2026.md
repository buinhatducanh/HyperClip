# YouTube Download Strategy (2026-05-18)

> Chiến lược download video từ YouTube — updated 2026-05-18

---

## Root Cause: Tại sao `web` client chỉ trả về 360p?

### Symptom
yt-dlp với `web` client và Chrome session cookies chỉ download được 360p:
```
[Download] quality=1080 maxHeight=1080p selector=...
[info] Available formats for pBGHOHWayLE:
18  mp4   640x360   ← chỉ có 1 format
```

Trong khi `tv_embedded` trả về đầy đủ:
```
[youtube] Available formats:
299 mp4  1920x1080 60 ← 1080p60 ✅
136 mp4  1280x720   30 ← 720p ✅
134 mp4  640x360    30 ← 360p
```

### Root Cause

1. **`web` client bị EJS challenge**: YouTube trả về HTML page với embedded JS challenge (`"n challenge solving failed"`) — yt-dlp không giải được → fallback về format cuối cùng được parse (360p)
2. **Chrome CDP cookies thiếu `PREF` preferences**: Cookies được extract từ Chrome in-memory session không chứa đầy đủ preferences (`f6=40000000&...`) mà YouTube cần để serve high-res formats cho `web` client
3. **`tv_embedded` không bị EJS**: Client này dùng HLS streaming (m3u8 manifest) thay vì DASH → bypass được EJS challenge

---

## Client Priority (2026-05-18)

```
tv_embedded  → web  →  ios
   1st         2nd     3rd
```

Code: `electron/services/youtube.ts` line ~1091
```typescript
// tv_embedded first: returns H.264 720p/1080p (avc1.64001f/avc1.64002a)
// even when 'web' client is limited to 360p by EJS challenge with Chrome session cookies.
// web second: fallback for edge cases (private videos, geo-restrictions).
const clients: YtdlpClient[] = ['tv_embedded', 'web', 'ios']
```

### Available formats by client

| Client | 360p | 720p | 1080p+ | Audio |
|--------|------|------|--------|-------|
| `tv_embedded` | ✅ H.264 | ✅ H.264 | ✅ H.264 1080p60 | AAC + OPUS |
| `web` | ✅ H.264 | ❌ (EJS limit) | ❌ (EJS limit) | AAC |
| `ios` | ✅ H.264 | ✅ H.264 | ❌ | AAC |

---

## Format Selector

### Priority: Resolution over Codec

```
bestvideo[height<=N]+bestaudio[acodec=aac]
→ bestvideo[height<=N]+bestaudio
→ bestvideo+bestaudio
bestvideo+bestaudio/bestvideo+bestaudio/bestvideo+bestaudio/bestvideo+bestaudio
```

**Tại sao không giới hạn H.264?**
- `web` client: YouTube chỉ có H.264 360p → H.264 360p được pick
- `tv_embedded` client: YouTube có H.264 1080p60 → H.264 1080p60 được pick
- Không cần restrict codec → yt-dlp tự chọn best available

### Old (broken) selector
```
bestvideo[height<=1080][vcodec=h264]+bestaudio[acodec=aac]  ← H.264 360p matches here!
→ bestvideo[height<=1080]+bestaudio                         ← never reached
→ bestvideo[vcodec=h264]+bestaudio[acodec=aac]
```

**yt-dlp short-circuits**: H.264 360p matches step 3 → never reaches VP9 1080p in step 2.

### Download command (final)
```bash
yt-dlp --js-runtimes node \
       --extractor-args "youtube:player_client=tv_embedded" \
       --cookies _yt_cookies.txt \
       -f "bestvideo[height<=1080]+bestaudio[acodec=aac]/bestvideo[height<=1080]+bestaudio/bestvideo+bestaudio" \
       --concurrent-fragments 32 \
       --retries 3 \
       "https://www.youtube.com/watch?v=VIDEO_ID"
```

---

## Download Speed Optimization (2026-05-21)

**Multi-instance + High Concurrency:**
```
RAM ≥ 16GB + 1080p:  4 yt-dlp instances × 32 concurrent fragments
RAM ≥ 8GB  + 1080p:  2 yt-dlp instances × 32 concurrent fragments
RAM < 8GB  or <1080p: 1 instance × 32 concurrent fragments
```

**Impact:**
- Before: 1 instance × 16 frags → ~43s CDN download (400MB file @ 75 Mbps)
- After: 4 instances × 32 frags → ~32s CDN download → **−25% download time**
- YouTube CDN per-IP cap: ~75-150 Mbps → instances/fragments increase không vượt được cap

**Memory per instance:** ~200-400MB RAM (buffer + network overhead)

---

## yt-dlp + EJS Challenge

yt-dlp >= 2024.09+ hỗ trợ JavaScript challenge solving:
```
[jsc:node] Solving JS challenges using node
```

- Requires `--js-runtimes node` flag
- yt-dlp auto-downloads JS challenge solver from GitHub
- `tv_embedded` không cần challenge solving vì dùng HLS

---

## Cookies from Chrome CDP

- Extracted via CDP (Chrome DevTools Protocol) from persistent Chrome session
- SOCS=CAI force-injected — bypasses EU consent banner
- Cookie file: `D:\HyperClip-Data\app\_yt_cookies.txt`
- Updated every download (CDP re-read)

### Limitations
- No `PREF` cookie or limited `PREF` → `web` client restricted to 360p
- `PREF` preferences (e.g., `f6=40000000&f7=...`) set via YouTube UI → not in CDP cookies
- **Solution**: Use `tv_embedded` client instead — doesn't need `PREF`

---

## E2E Verification (2026-05-18)

| Step | Result |
|------|--------|
| Detection | 1080p60 YouTube video detected in < 5s |
| Cookie extraction | 30 cookies via CDP, SOCS=CAI injected |
| Pre-check | duration=646s, aspect=1920x1080 |
| Download | `tv_embedded` → 288.7 MB in 30.4s, ASPECT=1920x1080 |
| Render | 874 MB output, 265s @ 1x speed |
| Archive | `..._1920p_h264_2026-05-17T18-27-22.mp4` |
| Progress | 100% ✅ (no stuck at 93.3%) |
