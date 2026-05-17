# Technology Overview — HyperClip (2026-05-17)

> Document cập nhật trạng thái công nghệ tại 2026-05-17. Source of truth cho nghiệp vụ: `HYPERCLIP_RULES.md`.

---

## 1. Architecture

```
Renderer (Next.js) ←→ preload.ts (IPC bridge) ←→ Main (Electron)
  page.tsx → Zustand store → DetailEditor.tsx
                                               ↓
                            main.ts → ffmpeg.ts / innertube_client.ts / youtube.ts
```

---

## 2. Detection Pipeline

### Primary: Innertube (youtubei.js) — NO QUOTA
- 30 Chrome sessions with SAPISIDHASH auth
- Sessions: `D:\HyperClip-Data\chrome-profiles\profile-N\_hyperclip_cookies.json`
- SOCS=CAI force-injected — no consent banner needed
- 7-strategy video extraction: getVideos → getHome → getChannelVideos → browse /videos → getPlaylist → RSS → OAuth

### Fallback: OAuth Data API v3
- 30 GCP projects (~285k units/day distributed)
- Triggered when: Innertube returns `publishedAt=0` (empty timestamp) or `published=(empty)`
- Cost: ~2.5 units/poll

### Channel Tab Discovery
- Zilk Kay (@zilkkay6971): no Videos/Featured tabs → `_fetchUploadsTab()` with `params='EgZ2aWRlb3M%3D'`

### Age Filter
- Skip videos > 10 minutes old
- `publishedAt=0` → OAuth verify → accept if ≤ 10 min

---

## 3. Download Pipeline

### yt-dlp + Chrome Cookies
```
yt-dlp --extractor-args "youtube:player_client=web" \
       --cookies _yt_cookies.txt \
       -f "bestvideo[height<=N][vcodec=h264]+bestaudio[acodec=aac]"
```
- Chrome cookies bypass EJS challenge
- `player_client=web` → yt-dlp auto-selects best format
- 16 concurrent fragments for 1080p+

### Quality
- `autoDownloadQuality` setting (default: 720)
- yt-dlp selects best ≤ N. If YouTube only has lower → downgrade automatically.

### Auto-Ingestion Flow
1. Poller detects new video (≤ 10 min old)
2. Create workspace → download queue
3. FFprobe → generate blur background (verticals only)
4. FFprobe → detect aspect ratio → isShort flag

---

## 4. Render Pipeline

### Flow
```
EditorState → page.tsx handleRender()
           ↓ metadata object (with overlays)
executeRenderJob() [main.ts]
           ↓ resolve paths + thumbnail fallback
           ↓ preRenderOverlays() → PNG files
renderVideo() [ffmpeg.ts]
           ↓ buildFilterComplex() → FFmpeg filter chain
           ↓ runFfmpeg() → NVENC GPU encode
           ↓ archive → cleanup
```

### Filter Chain (SHORT mode, 1080×1920)
```
[0:v]fps=30,setpts=PTS-STARTPTS → trim → scale=-2:1344 → crop=1080:1344:655:0[vid]
[1:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=...(setsar=1)[bg]
[2:v]scale=1080:384:force_original_aspect_ratio=increase,crop=...[hd]
[3:v]null[bb]
[bg][vid]overlay=0:384[vz]
[vz][hd]overlay=0:0[vh]
[vh][bb]overlay=0:1728[final]
```

**Critical rules:**
- `fps=30` BEFORE `setpts=PTS-STARTPTS` — normalizes framerate, then resets timestamps
- NO `select='not(mod(n,2))'` — causes 2× frame halving (60fps → 30fps → 15fps)
- NO `-r 30` output flag — conflicts with filter chain
- Order: `fps → setpts → trim → scale → crop`

### Zone Layout (SHORT, 1080×1920)
| Zone | Height | Y | Content |
|------|--------|---|---------|
| Header | 384 (20%) | 0 | Thumbnail or custom image |
| Video | 1344 (70%) | 384 | Cropped + scaled source |
| Bottom bar | 192 (10%) | 1728 | Solid accent color + white text |

### Encoding Parameters
| Quality | Maxrate | Bufsize | CRF H.264 | CRF HEVC |
|---------|---------|---------|------------|----------|
| 360p | 3 Mbps | 6 Mbps | 22 | 26 |
| 720p | 6 Mbps | 12 Mbps | 20 | 24 |
| 1080p | 12 Mbps | 24 Mbps | 18 | 20 |

NVENC: `-preset p3 -rc vbr_hq -cq N -tune hq -bf 0 -refs 1 -g 30`
User preset (p1/p2/p3) respected.

### Pre-rendered Overlays (PowerShell System.Drawing)
- **SHORT bottom bar**: canvasW × bottomH PNG, solid accent fill, white bold text centered
  - LockBits forces A=255 (fixes anti-aliasing alpha artifacts)
- **LANDSCAPE title overlay**: transparent PNG, border + text
- FFmpeg gyan.dev 7.x does NOT support `color:alpha=N` → must pre-render

### Thumbnail Fallback
When `blurBackgroundPath` is empty (app restart, workspace loaded from disk, blur not generated):
→ Use `thumb_${workspaceId}.jpg` as header overlay source
→ executeRenderJob() fills empty header src with thumbnail disk path

### Preview = Render Parity
Preview (DetailEditor.tsx) now matches FFmpeg output:
- Video: `objectFit: cover` (crop horizontal like FFmpeg)
- Header zone: shows thumbnail
- Bottom bar: blur image background + gradient overlay + accent bar + white text

---

## 5. Quality Validation

### Download
yt-dlp selects best format ≤ N. If YouTube only has 360p → downloads 360p (not 1080p).

### Render
Canvas always rendered at selected quality (360p/720p/1080p). Source is upscaled if lower.

### UI Validation (TODO)
Quality buttons in editor should be disabled if YouTube doesn't have that format:
- `getVideoFormats(videoId)` → check available heights
- Disable buttons for unavailable qualities

---

## 6. Issues Log (2026-05-17)

| # | Description | Status |
|---|-------------|--------|
| 1 | 1fps render output | FIXED — `fps=30,setpts` (no select) |
| 2 | Header thumbnail missing | FIXED — thumbnail disk path fallback |
| 3 | Bottom bar missing | FIXED — `bottomBarEnabled` metadata + always push header overlay |
| 4 | Zilk Kay skipped (Tab "featured" not found) | FIXED — `_fetchUploadsTab` |
| 5 | Filter chain `[3:v]null` bottom bar | FIXED — `preRenderOverlays` creates bar when enabled |
| 6 | Progress 93.3% after render done | PENDING |
| 7 | Quality validation (disable unavailable options) | PENDING |
| 8 | PO Token extraction fails | DOCUMENTED — Chrome cookies + yt-dlp auto bypass |
| 9 | Cookie DB lock when Chrome running | KNOWN |

---

## 7. Key Files

| File | Purpose |
|------|---------|
| `electron/services/ffmpeg.ts` | Filter chain, NVENC params, pre-render overlays |
| `electron/services/youtube.ts` | yt-dlp downloader |
| `electron/services/innertube_client.ts` | Innertube pool + 7-strategy extraction |
| `electron/main.ts` | Auto-download + render IPC + thumbnail fallback |
| `src/app/components/DetailEditor.tsx` | Preview editor (canvas zones, bottom bar CSS) |
| `src/app/page.tsx` | Dashboard + render trigger + overlays |
| `scripts/render-core.ps1` | Reference PS1 render script (baseline) |
| `memory/render_pipeline_refactor.md` | Render pipeline refactor notes |
