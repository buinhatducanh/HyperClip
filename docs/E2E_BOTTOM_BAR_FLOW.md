# E2E Flow Analysis — Bottom Bar Render (PO Perspective)

> Date: 2026-05-17
> Status: IMPLEMENTED & TESTED

---

## User Journey

```
1. User opens app → selects video → DetailEditor opens
2. Preview canvas: HEADER(20%) | VIDEO(70%) | BOTTOM(10%)
3. User expands "BOTTOM BAR" section
   - Toggle ON → bar enabled
   - Enter text: "PART 1"
   - Pick color: #00B4FF (default)
4. User clicks RENDER (or RENDER CHUNKED for long videos)
5. FFmpeg processes → output.mp4 saved
6. Progress bar in UI → notification when done
```

---

## Data Flow (Technical)

```
EditorState
├─ bottomBarEnabled: true
├─ bottomBarColor:  '#00B4FF'
├─ titleText:        'PART 1'
├─ exportQuality:    1080
└─ headerImageDiskPath: 'C:/.../header.jpg'
    │
    │ page.tsx overlays[] construction (line 711-732)
    │ ┌─ type: 'header', src: headerImageDiskPath
    │ └─ type: 'title',  content: 'PART 1', borderColor: '#00B4FF'  ← bar color
    │
    │ page.tsx metadata (line 734-746)
    │ ├─ export_resolution: '1080x1920'
    │ ├─ bottomBarH: 192 (floor(1920 * 0.10))
    │ └─ overlays: [header, title]
    │
    │ IPC 'render:start' → executeRenderJob()
    │
    ├─ renderVideo() — ffmpeg.ts line 1029
    │   ├─ canvasH=1920, headerH=384, videoH=1344, bottomBarH=192
    │   ├─ preRenderOverlays() — ffmpeg.ts line 829
    │   │   └─ PowerShell: 1080x192 PNG, cyan bar, "PART 1" white
    │   │       └─ bottom_bar_overlay.png
    │   │
    │   └─ buildFilterComplex() — ffmpeg.ts
    │       ├─ [bg][vid]overlay=0:384 → [vz]     (bg + video)
    │       ├─ [3:v]null               → [bb]     (bottom bar PNG)
    │       ├─ [vz][bb]overlay=0:1728 → [vb]     (bottom bar on video)
    │       ├─ [2:v]scale...crop...   → [hd]     (header image)
    │       └─ [vb][hd]overlay=0:0    → [final]  (header on top of bottom bar)
    │
    ├─ FFmpeg encoding
    └─ output.mp4 → notification
```

---

## Key Design Decisions

### 1. `borderColor` carries bar color

When `bottomBarEnabled=true`, `page.tsx` sets:
```typescript
overlays.push({
  type: 'title',
  content: editorState.titleText,           // 'PART 1'
  borderColor: editorState.bottomBarColor, // '#00B4FF' ← bar fill color
})
```

`preRenderOverlays()` reads `titleOl.borderColor` → PowerShell fill color. Single field carries both meanings.

### 2. `bottomBarH` = floor(canvasH * 0.10)

Computed at 3 places with identical formula:
- `page.tsx`: `bottomBarH = floor(quality * 0.10)`
- `renderVideo()`: `metadata.bottomBarH ?? floor(canvasH * BOTTOM_PCT)`
- `buildFilterComplex()`: `bottomBarY = headerH + videoH`

### 3. `bottomBarEnabled` gates overlay in page.tsx

FFmpeg receives NO signal about whether bar is enabled. It just renders whatever overlay exists:
- `bottomBarEnabled=true` → `page.tsx` adds title overlay with `borderColor=bottomBarColor` → PNG generated
- `bottomBarEnabled=false` → NO title overlay in SHORT mode → no PNG, no bottom bar

### 4. Preview canvas zones are fixed (not conditional)

For SHORT mode, zone heights are ALWAYS 20/70/10% regardless of `bottomBarEnabled`. The toggle only controls whether the bar is rendered in the preview — the zone space is always reserved.

---

## UI State → Render Mapping

| UI State | EditorState | Overlay added | PNG generated | Result |
|----------|-------------|--------------|--------------|--------|
| SHORT + Bottom Bar ON + text | `bottomBarEnabled=true`, `bottomBarColor='#00B4FF'` | `type:'title', borderColor='#00B4FF'` | YES | Opaque cyan bar + white text |
| SHORT + Bottom Bar OFF | `bottomBarEnabled=false` | None for SHORT | NO | Header + video (no bar) |
| SHORT + Bottom Bar ON + no text | `bottomBarEnabled=true` | NO overlay (no content) | NO | Header + video (no bar) |
| LANDSCAPE | N/A | `type:'title', borderColor='#00B4FF'` | YES | Transparent overlay with border |

---

## Files & Line References

| Step | File | Lines |
|------|------|-------|
| Overlays build | `src/app/page.tsx` | 711-732 |
| Metadata build | `src/app/page.tsx` | 734-746 |
| IPC call | `src/app/page.tsx` | 750 |
| IPC handler | `electron/main.ts` | 2292-2310 |
| Render queue | `electron/main.ts` | 225-420 |
| `renderVideo()` | `electron/services/ffmpeg.ts` | 1029 |
| `preRenderOverlays()` | `electron/services/ffmpeg.ts` | 829-950 |
| `buildFilterComplex()` | `electron/services/ffmpeg.ts` | 416-637 |
| Preview zones | `src/app/components/DetailEditor.tsx` | 1204-1208 |
| Bottom bar preview | `src/app/components/DetailEditor.tsx` | 1393-1409 |
| Zone constants | `electron/services/ffmpeg.ts` | 83-86 |

---

## Related Docs

- `docs/BOTTOM_BAR_LAYOUT.md` — Zone system, filter chain, constants
- `docs/BUG_LAGGY_RENDER.md` — Prior render pipeline fixes
