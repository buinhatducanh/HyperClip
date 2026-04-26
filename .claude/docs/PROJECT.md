# HyperClip — Auto-Render Vertical Video Desktop App

> **Mục tiêu:** Desktop application tự động tải video YouTube và render sang định dạng dọc 9:16 (TikTok/Reels) cho một power user duy nhất.

> **Kiến trúc:** Electron + Next.js — GIỮ NGUYÊN giao diện prototype web, migrate từ Vite → Next.js, bọc bằng Electron shell.

---

## Nguồn đặc tả

| File | Mô tả |
|------|--------|
| `Description.docx` | Tech stack, E2E workflow, nghiệp vụ |
| `src/imports/pasted_text/dashboard-design.md` | UI/UX spec (3-pane layout, theme, components) |

---

## Architecture

```
HyperClip Desktop App
├── Main Process (Electron / Node.js)
│   ├── yt-dlp wrapper         — Auto-download YouTube
│   ├── FFmpeg wrapper          — Video processing + NVENC render
│   ├── WebSub listener         — YouTube PubSub webhook
│   ├── RAM Disk manager        — Temp storage (64GB)
│   ├── System monitor          — GPU, RAM, Network stats
│   └── IPC Server              — Giao tiếp với renderer
├── Renderer Process (Next.js / React)
│   ├── React-Konva Canvas      — Editor workspace (zero-latency)
│   ├── Zustand store           — Global state
│   └── UI Components           — Workspace, Settings, System Monitor
└── Shared
    ├── metadata.json            — Editor config (NOT video)
    └── IPC protocol             — Main ↔ Renderer communication
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop Shell | Electron |
| Frontend | Next.js 14 (App Router) |
| Canvas | React-Konva (Canvas 2D) |
| State | Zustand |
| Styling | Tailwind CSS v4 + inline styles |
| UI Components | shadcn/ui (Radix UI) |
| Icons | Lucide React |
| Toasts | Sonner |
| Backend (main process) | Node.js/Bun.js |
| Downloader | yt-dlp (Direct IP Binding, bypass VPN) |
| Video Processing | FFmpeg + NVIDIA CUDA/NVENC |
| YouTube Events | WebSub (PubSubHubbub) |

### Hardware Target
- CPU: Intel Core Ultra 9 285K
- GPU: RTX 5080 16GB (NVENC)
- RAM: 64GB DDR5 (RAM Disk)

---

## E2E Workflow (5 bước)

1. **Tracking Setup** → User thêm URL YouTube, cấu hình trim limit, đăng ký WebSub webhook
2. **Auto-Ingestion** → Google webhook trigger (<0.5s), yt-dlp kéo video vào RAM disk (bypass VPN)
3. **Pre-processing** → Tạo workspace, gen blur background, gửi notification
4. **Web-based Workspace** → Canvas editor (CapCut-style), drag-drop zero-latency, sinh metadata.json
5. **Render & Export** → FFmpeg + NVENC, output .mp4 9:16 ra `/output/`

---

## UI/UX Spec (Design Doc)

### Layout 3-pane
```
[Left Sidebar 220px] | [Center (flex-1) — Workspace Pipeline] | [Right Panel — Editor]
```

### Theme
- Background: `#121212`, Surfaces: `#1E1E1E`
- Accent: Electric Blue `#00B4FF`, Neon Green `#00FF88`
- Flat design: NO shadows, NO gradients, NO decorative UI
- Font: Inter

### Workspace Pipeline (Center)
- Input Bar: URL + Trim dropdown + Add Tracker
- Workspace Queue: grouped by status
  - 🟢 Ready (highlighted) | 🟡 Waiting | 🔵 Downloading | 🟣 Editing | 🔴 Rendering | ✅ Done (collapsible)
- Workspace Card: thumbnail, title, channel, duration, status badge

### Editor (Right)
- Canvas 9:16 với React-Konva: video 16:9 center + blur top/bottom
- Toolbar (left-side vertical)
- Controls (right-side panel):
  1. Trim Video — dual-handle slider
  2. Background — Regenerate Blur + Custom Image
  3. Speed — [1.0x] [1.1x] [1.2x] [1.5x]
  4. Text & Overlays
  5. Image/Thumbnail Overlay
  6. Export Settings — [1080p] [720p]
- Primary: Full-width "⚡ RENDER VIDEO"

### Floating Render Queue (Bottom Bar)
- Collapsible, multi-worker status
- Real-time progress

### System Monitor (Sidebar)
- RAM Disk, GPU NVENC (glow when rendering), Network, Workers

---

## Cấu trúc thư mục (Target)

```
hyperclip-desktop/
├── electron/
│   ├── main.ts
│   ├── preload.ts
│   ├── ipc/
│   │   ├── channels.ts
│   │   ├── handlers.ts
│   │   └── types.ts
│   ├── services/
│   │   ├── youtube.ts        # yt-dlp wrapper
│   │   ├── ffmpeg.ts         # FFmpeg + NVENC
│   │   ├── websub.ts         # YouTube PubSub
│   │   ├── ramdisk.ts        # RAM disk manager
│   │   └── system.ts         # Stats collector
│   └── utils/
│       ├── network.ts
│       └── logger.ts
├── src/                      # Next.js renderer
│   ├── app/
│   │   ├── page.tsx          # Dashboard (3-pane)
│   │   ├── editor/page.tsx
│   │   ├── workspaces/page.tsx
│   │   └── settings/page.tsx
│   ├── components/
│   │   ├── layout/ (Sidebar, TopBar, Layout)
│   │   ├── workspace/ (InputBar, WorkspaceCard, WorkspaceQueue, RenderQueueBar)
│   │   ├── editor/ (Canvas, Toolbar, Trim, Speed, Background, Text, Image, Export)
│   │   ├── system/ (SystemMonitor, WorkerStatus)
│   │   └── ui/
│   └── lib/
│       ├── store.ts           # Zustand
│       ├── ipc.ts             # IPC client
│       ├── constants.ts
│       └── utils.ts
├── resources/
│   └── icon.ico
├── package.json
├── electron-builder.yml
└── tsconfig.json
```

---

## Types (src/app/types.ts — cần mở rộng)

```typescript
// === Workspace ===
type WorkspaceStatus = 'waiting' | 'downloading' | 'ready' | 'editing' | 'rendering' | 'done'
type TrimLimit = '5min' | '10min' | 'full'
type ExportQuality = 1080 | 720 | 360

interface Workspace {
  id: string
  channelId: string
  channelName: string
  channelColor: string
  videoTitle: string
  videoUrl: string
  thumbnail: string
  duration: string
  trimLimit: TrimLimit
  status: WorkspaceStatus
  renderProgress?: number
  downloadedAt: string
  fileSize: string
  ramdiskPath?: string
  outputPath?: string
  metadataPath?: string
}

// === Render ===
interface RenderWorker {
  id: string
  workspaceId: string
  status: 'rendering' | 'queued' | 'done' | 'failed'
  progress: number
  startedAt?: string
}

interface RenderMetadata {
  workspace_id: string
  source_video: string
  blur_background: string
  export_resolution: string
  video_speed: number
  fps_target: 30
  overlays: Overlay[]
  trim: { start: number; end: number }
}

// === System ===
interface SystemStats {
  ramUsed: number
  ramTotal: number
  ramDiskUsed: number
  ramDiskTotal: number
  gpuUsage: number
  gpuTemp: number
  gpuName: string
  networkIp: string
  isOnline: boolean
  activeWorkers: number
}

// === Notification ===
interface AppNotification {
  id: string
  type: 'success' | 'error' | 'warning' | 'info'
  message: string
  workspaceId?: string
  timestamp: string
}

// === Editor ===
interface EditorState {
  canvasBg: 'black' | 'white'
  trimStart: number
  trimEnd: number
  videoSpeed: number
  backgroundType: 'blur' | 'solid' | 'image'
  backgroundColor?: string
  uploadedBackgroundUrl?: string | null
  overlays: Overlay[]
  exportQuality: ExportQuality
}
```

---

## Metadata Format (Frontend ↔ Backend)

```json
{
  "workspace_id": "WS-10293",
  "source_video": "ramdisk/vid_10293.mp4",
  "blur_background": "ramdisk/blur_10293.jpg",
  "export_resolution": "1080x1920",
  "video_speed": 1.1,
  "fps_target": 30,
  "overlays": [
    { "type": "image", "src": "thumb1.png", "y": 100, "x": 0 },
    { "type": "text", "content": "PART 1", "font": "Arial", "y": 1600 }
  ],
  "trim": { "start": 0, "end": 600 }
}
```

---

## Implementation Progress

### ✅ Đã hoàn thành
- [x] Electron scaffolding (main, preload, IPC)
- [x] Next.js 14 App Router (layout, page, globals.css)
- [x] Zustand store (workspace state, system stats, render, notifications)
- [x] IPC client wrapper + type declarations
- [x] Theme constants + Tailwind v3 config
- [x] 'use client' directives on all React component files
- [x] Electron builder config (electron-builder.yml)
- [x] Next.js build hoàn chỉnh (JS bundles, page.js)

### 🔄 Còn lại

**Phase 2 — Electron Backend:**
- [ ] yt-dlp service (download, Direct IP Binding)
- [ ] FFmpeg service (blur, render, NVENC)
- [ ] WebSub listener (YouTube PubSub)
- [ ] RAM disk manager

**Phase 3 — Workspace Pipeline (UI nâng cấp):**
- [ ] InputBar (URL + Trim + Add)
- [ ] WorkspaceQueue (group by status)
- [ ] WorkspaceCard (full design với design doc)
- [ ] RenderQueueBar (floating bottom)

**Phase 4 — Editor (nâng cấp):**
- [ ] React-Konva Canvas (9:16, draggable video)
- [ ] SpeedControls, BackgroundControls, ImageOverlay, ExportPanel

**Phase 5 — Pages:**
- [ ] Workspaces management page
- [ ] Settings page

**Phase 6 — Build:**
- [ ] electron-builder package .exe
- [ ] App icon

### ⚠️ Known Issues
- Build: static HTML generation cho `/_error` và `/_not-found` bị lỗi (Next.js 14 SSR với `'use client'`). Không ảnh hưởng Electron production vì dùng `next start` (dynamic rendering).
- Fix: chạy `npm run dev` để dev, production build cần thêm bước fix hoặc bỏ qua error page generation.

---

## Key Decisions

1. **Desktop Framework:** Electron + Next.js (spec nói Next.js SPA, Electron làm shell)
2. **State:** Zustand (frontend) — clean, great for real-time
3. **Canvas:** React-Konva (zero-latency drag & drop như spec)
4. **Backend:** Node.js trong Electron main process
5. **Metadata:** JSON file — không can thiệp video gốc
6. **Render:** FFmpeg + NVENC — hardware acceleration
7. **Network:** Direct IP Binding — bypass VPN cho yt-dlp/ffmpeg
8. **Storage:** RAM Disk — video temp, tăng tốc đọc/ghi

---

## Memory Files
- `C:\Users\MSI\.claude\projects\D--LOOP-COMPANY-HyperClip\memory\`

## Ngày cập nhật
2026-04-22
