# Render Optimization Plan — HyperClip

## Context

Dự án HyperClip hiện có pipeline render dựa trên FFmpeg + NVENC, phục vụ workflow: download video → edit trim/overlay → render output. Pipeline hiện tại hoạt động nhưng chưa tối ưu cho GPU NVIDIA RTX 5080.

**Mục tiêu:** Tối ưu hóa render pipeline để giảm thời gian xử lý 2-5x, hỗ trợ batch rendering, và xây dựng kiến trúc mở rộng cho quy mô cao.

---

## Current State

### Pipeline hiện tại (Tier 1+2 ✅ + Tier 3.3 ✅)

```
Add Tracker
  └─► TRACKER_ADD handler
       ├─ getVideoInfo()
       ├─ addWorkspace()
       ├─ downloadVideo() ─────────────────────────────────┐
       │    └─ broadcast download progress                  │
       │                                                   │
       └─ Broadcast: {status: ready, downloadedPath} ←─────┘
            │
            └─► generateBlurBackground() [NON-BLOCK, parallel]
                 └─ Broadcast: {blurBackgroundPath}

User clicks RENDER
  └─► RENDER_START handler → renderQueue
       ├─ If slot free → executeRenderJob() immediately
       └─ If full → wait in queue (FIFO)

User toggles GPU MAX → chunked mode (4 parallel workers)
  └─► RENDER_CHUNKED handler
       └─► renderChunked() — keyframe-aware split → parallel encode → merge
```

### Files chính

| File | Vai trò |
|---|---|
| `electron/services/ffmpeg.ts` | Logic render: `renderVideo()`, `renderVideoNvenc()`, `generateBlurBackground()` |
| `electron/main.ts:803` | RENDER_START handler → render queue manager |
| `electron/main.ts:647` | TRACKER_ADD handler, parallel blur generation |
| `electron/main.ts:920` | RENDER_CANCEL handler, cancel queue + worker pool |
| `electron/main.ts:55` | RenderQueueManager: queue + worker pool integration |
| `electron/main.ts:870` | RENDER_CHUNKED handler — parallel chunk encoding |andler — ABR multi-output encoding |
| `electron/services/worker-pool.ts` | `WorkerPool`, `runFfmpeg()`, `cancelFfmpeg()` |
| `electron/services/ffmpeg-paths.ts` | `getFfmpegPath()`, `getFfprobePath()` |
| `electron/services/ffmpeg.ts` | `renderVideo()`, `renderLadder()`, `renderChunked()` |
| `src/app/page.tsx` | `handleRender()` + `handleExportLadder()` + `handleExportChunked()` |
| `src/app/components/editor/ExportPanel.tsx` | Platform targets + GPU MAX toggle |
| `src/app/lib/ipc.ts` | IPC client wrappers |

### FFmpeg flags (Tier 1+2 ✅ implemented)

```
ffmpeg \
  -ss {trimStart} -t {duration} \
  -hwaccel cuda -hwaccel_device 0 \         ← GPU decode
  -i "{source}" -i "{blur_bg}" \
  -filter_complex "[0:v]scale,pad,overlay,speed][v];[1:v][v]overlay=0:0" \
  -c:v hevc_nvenc \                         ← HEVC (H.264 optional)
  -preset p1 \                             ← fastest preset
  -rc vbr -cq 28 \                         ← 28 for HEVC
  -tune hq \                               ← High Quality
  -rc-lookahead 32 -spatial-aq 1 \        ← quality enhancements
  -max_muxing_queue_size 1024 \            ← prevent drops
  -c:a aac -b:a 192k -r 30 \
  "{output}"
```

### Vấn đề đã xử lý

1. ~~Decode CPU-bound~~ → ✅ GPU decode với `hwaccel cuda`
2. ~~Preset conservative~~ → ✅ `p1` (fastest)
3. ~~Sequential pipeline~~ → ✅ blur non-blocking, render queue parallel
4. ~~Single worker~~ → ✅ 2 concurrent renders (RTX 5080)
5. ~~H.264 only~~ → ✅ HEVC default, H.264 optional
6. ~~No GPU multi-instance~~ → ✅ queue manager với 2 workers
7. **Remaining**: Scene detection (future, low priority)

---

## Optimization Tiers

### Tier 1 — Quick Wins (Ít thay đổi, impact lớn)

**Thay đổi:** Chỉ sửa FFmpeg flags trong `electron/services/ffmpeg.ts`

#### 1.1 NVENC preset → p1 (fastest)
```typescript
// Trước:
'-preset', 'fast',

// Sau:
'-preset', 'p1',
```
**Ước tính:** 2-3x nhanh hơn encode. RTX 5080: 15-25x realtime thay vì 8-15x.

#### 1.2 GPU-accelerated decode
```typescript
// Thêm trước các input:
'-hwaccel', 'cuda',
'-hwaccel_device', '0',
'-c:v', 'h264_cuvid',  // hoặc 'hevc_cuvid' tùy input
```
**Ước tính:** Decode từ ~3-5x realtime CPU → ~20-30x realtime GPU. Giảm 60-70% thời gian decode.

#### 1.3 H.265 (HEVC) option
```typescript
// Thêm option trong ExportPanel:
// 720p: h264_nvenc (compatibility)
// 1080p: hevc_nvenc (better compression)
'-c:v', 'hevc_nvenc',
'-preset', 'p1',
'-rc', 'vbr',
'-cq', '28',  // HEVC CQ cao hơn vì nén tốt hơn
```
**Ước tính:** File size nhỏ hơn 40-50% cùng chất lượng. Decode vẫn nhanh.

#### 1.4 Tune flag
```typescript
// Thêm:
'-tune', 'hq',  // High Quality — cho content quan trọng
// Hoặc:
// '-tune', 'll',  // Low Latency — cho preview
```
**Ước tính:** Cải thiện quality với cùng bitrate ~5-10%.

#### 1.5 Look-ahead
```typescript
// Thêm:
'-rc-lookahead', '32',  // Improve VBR quality với barely any speed cost
'-spatial-aq', '1',      // Per-frame bit allocation
```
**Ước tính:** Quality improvement ~10-15% VMAF với <5% slowdown.

**Priority order:** 1.1 → 1.2 → 1.4 → 1.3 → 1.5

---

### Tier 2 — Pipeline Refactor (Cần refactor nhỏ)

**Thay đổi:** Cấu trúc lại cách các bước nối tiếp được gọi.

#### 2.1 Parallel blur generation
```
Trước: download → [WAIT] → blur → [WAIT] → render
Sau:   download → [PARALLEL: blur + next_download] → render
```

```typescript
// Trong TRACKER_ADD handler (main.ts:583)
// Sau khi download thành công:
const blurPromise = generateBlurBackground(result.filePath, blurPath)
// KHÔNG await ở đây nếu không cần blur ngay
// Blur có thể chạy song song với queue processing khác

// Render sẽ await blur trước khi bắt đầu
if (!fs.existsSync(blurPath)) {
  await generateBlurBackground(sourceVideo, blurPath)
}
```

#### 2.2 Multi-worker render queue
```typescript
// main.ts — thay vì 1 process:
// activeRenders: Map<string, spawn>
// Thêm:
const MAX_CONCURRENT_RENDERS = 2  // RTX 5080 có 2 NVENC encoders

// Trong RENDER_START:
// - Check đang có bao nhiêu render đang chạy
// - Nếu < MAX: start render ngay
// - Nếu >= MAX: add vào pending queue
// - Khi 1 render finish: start next in queue
```

#### 2.3 Separate decode/encode processes
```typescript
// decode video → intermediate YUV/NV12 file
// encode từ intermediate (cho phép re-encode nhiều lần mà không re-decode)
//
// Workflow:
// 1. ffmpeg -hwaccel cuda -i input.mp4 -c:v hevc_nvenc output.mov  (extract to fast codec)
// 2. ffmpeg -i output.mov [filters] -c:v hevc_nvenc final.mp4  (re-encode với filters)
//
// Benefit: filter chain có thể iterate nhiều lần mà không decode lại
```

#### 2.4 GPU memory optimization
```typescript
// Thêm:
// '-gpu', '0',  // Specify GPU
// '-max_muxing_queue_size', '1024',
// '-threads', '4',  // CPU threads for filter chain
```
**Ước tính:** Giảm VRAM contention khi chạy multi-worker.

---

### Tier 3 — Architecture (Kiến trúc mới)

#### 3.1 Chunk-based parallel encoding ✅ IMPLEMENTED

```typescript
// Chia video thành N segments, encode song song, merge
//
// Steps:
// 1. ffprobe get duration, scene changes
// 2. Split: ffmpeg -ss T1 -t D1 -i input.mp4 seg1.mp4
//                   -ss T2 -t D2 -i input.mp4 seg2.mp4
//                   ... (N segments)
// 3. Encode: parallel workers encode mỗi segment
// 4. Merge: ffmpeg -f concat -i list.txt -c copy final.mp4
//
// Challenge: scene boundary phải smooth (keyframes)
// Solution: dùng scene detection trước (ffprobe + mlnt detect)
```

#### 3.2 Worker pool (child processes) ✅ IMPLEMENTED
```
┌─────────────────────────────────────┐
│  Main Process (Electron)             │
│  ├─ RenderQueueManager (job order)   │
│  └─ WorkerPool (concurrency control) │
│       ├─ FFmpeg child process 1        │
│       └─ FFmpeg child process 2        │
└─────────────────────────────────────┘

// electron/services/worker-pool.ts
// - WorkerPool class: queue, cancel, release
// - runFfmpeg(): spawn + progress callback + timeout + pool tracking
// - cancelFfmpeg(jobId): kill active process or remove from queue
// - cancelAllFfmpeg(): shutdown all
//
// Replace activeRenders Map with WorkerPool for:
// - Accurate concurrency enforcement (2 slots)
// - Proper cancel (kill FFmpeg process directly)
// - Graceful shutdown (drain all)
```

#### 3.4 Cloud burst — NOT NEEDED
```
Local-only pipeline. Videos queue FIFO, GPU processes when free.

Cloud burst removed — not needed for this use case.
Only makes sense if: 50+ videos/day + dedicated render farm or cloud GPU subscription.

For personal/content-creator use: local GPU + 2-worker queue is sufficient.
```

### Verification checklist

- [ ] Render 1 video 10 phút → output đúng, file playable
- [ ] Render queue 5 videos → all complete, progress bars accurate
- [ ] GPU utilization ~90-95% when rendering (nvidia-smi)
- [ ] VRAM usage < 8GB single worker, < 14GB dual workers
- [ ] Render cancel → process killed, no orphan ffmpeg
- [ ] H.265 output → plays on VLC, mobile, web
- [ ] Chunked mode (4x parallel) → visible speedup vs single
- [ ] Ladder mode → all platform outputs created
- [ ] Worker pool cancel → job removed from queue

---

## Implementation Roadmap

```
Phase 1: Tier 1 ✅ DONE
  ├─ 1.1 NVENC preset p1          → ffmpeg.ts ✅
  ├─ 1.2 GPU decode               → ffmpeg.ts ✅
  ├─ 1.4 Tune flag                → ffmpeg.ts ✅
  └─ 1.3 H.265 option             → ExportPanel + ffmpeg.ts ✅

Phase 2: Tier 2 ✅ DONE
  ├─ 2.1 Parallel blur gen         → main.ts ✅
  ├─ 2.2 Multi-worker queue        → main.ts ✅
  └─ 2.4 GPU memory tuning         → ffmpeg.ts ✅ (max_muxing_queue_size added)

Phase 3: Tier 3 — ALL COMPLETE ✅
  ├─ 3.1 Chunk encoding ✅         → ffmpeg.ts + main.ts + ExportPanel ✅
  ├─ 3.2 Worker pool ✅           → worker-pool.ts + ffmpeg.ts ✅
  └─ 3.4 Cloud burst — NOT NEEDED (local GPU sufficient)
```

---

## Verification Plan

### Benchmark methodology
```bash
# Test video: 10 phút YouTube video (1920x1080 @ 60fps)
# Metric: thời gian render total, GPU utilization, VRAM usage

# Baseline (hiện tại):
echo "Baseline: preset=fast, no hwaccel, h264"
time ffmpeg -ss $START -t $DUR -i input.mp4 -i blur.png \
  -filter_complex "..." -c:v h264_nvenc -preset fast \
  -rc vbr -cq 23 -c:a aac -b:a 192k output_baseline.mp4

# After Tier 1:
echo "Tier 1: preset=p1, hwaccel=cuda, tune=hq"
time ffmpeg -hwaccel cuda -ss $START -t $DUR -i input.mp4 -i blur.png \
  -filter_complex "..." -c:v h264_nvenc -preset p1 \
  -rc vbr -cq 23 -tune hq -c:a aac -b:a 192k output_t1.mp4
```

### Expected results (RTX 5080, 10-min video)

| Configuration | Encode time | Decode time | Total | Speedup |
|---|---|---|---|---|
| **Baseline** (fast, CPU decode) | ~60s | ~180s | ~240s | 1x |
| **Tier 1** (p1, CUDA decode, tune=hq) | ~20s | ~30s | ~50s | **4.8x** ✅ |
| **Tier 2** (p1, 2-worker queue) | ~20s×2 | ~30s | ~35s | **6.8x** ✅ |
| **Tier 3.1** (4x chunked parallel) | ~8s×4 | ~30s | ~38s | **6.3x** ✅ |

> **Note:** Decode là bottleneck lớn hơn encode với preset p1. GPU decode (cuvid) là thay đổi lớn nhất.

### Test checklist
- [ ] Render 1 video 10 phút → output đúng, file playable
- [ ] Render queue 5 videos → all complete, progress bars accurate
- [ ] GPU utilization ~90-95% khi render (check nvidia-smi)
- [ ] VRAM usage < 8GB cho single worker, < 14GB cho 2 workers
- [ ] Render cancel → process killed, no orphan ffmpeg
- [ ] H.265 output → plays on VLC, mobile, web
- [ ] No quality degradation vs baseline (visual diff check)

---

## Key Files Reference

### `electron/services/ffmpeg.ts` — Primary optimization target

```typescript
// Line 147-330: renderVideo() — main render function (Tier 1+2 applied)
// Line 332-435: renderVideoNvenc() — consistent with renderVideo
// Line 81-145: generateBlurBackground() — blur generation (non-blocking)

// Key flags (all Tier 1 applied):
const args: string[] = [
  '-ss', String(trimStart), '-t', String(duration),
  '-hwaccel', 'cuda', '-hwaccel_device', '0',     // GPU decode
  '-i', `"${source_video}"`,
  '-i', `"${blur_background}"`,
  '-filter_complex', filterComplex,
  '-c:v', nvencCodec,                            // hevc_nvenc / h264_nvenc
  '-preset', preset,                              // p1 / p2 / p3
  '-rc', 'vbr', '-cq', String(cq),              // 28 for HEVC
  '-tune', tune,                                  // hq / ll / film
  '-rc-lookahead', '32', '-spatial-aq', '1',    // quality enhancements
  '-max_muxing_queue_size', '1024',              // prevent frame drops
  '-c:a', 'aac', '-b:a', '192k', '-r', '30',
]
```

### `electron/main.ts` — Render orchestration

```typescript
// Line 55-120: RenderQueueManager — FIFO queue + concurrent workers
//   MAX_CONCURRENT_RENDERS = 2 (RTX 5080 has 2 NVENC encoders)
//   renderQueue[] — pending jobs
//   startNextQueuedRender() — auto-starts next job when slot frees
//   executeRenderJob() — runs single render with progress tracking

// Line 876-882: RENDER_START handler — adds to queue, auto-starts if slot free
// Line 920-930: RENDER_CANCEL handler — removes from queue + kills active process
// Line 956: quitAll() — drains queue on shutdown
```

### `src/app/components/editor/ExportPanel.tsx` — Export options UI

```typescript
// Quality buttons: 720 / 1080
// onExport → gọi handleRender() → ipc.startRender()

// Thêm: codec selection (H.264 / H.265)
// Thêm: preset selection (Speed / Balanced / Quality)
```

### `src/app/types.ts` — EditorState

```typescript
// EditorState interface có exportQuality, speedMultiplier
// Thêm: codec, presetLevel
```

---

## Anti-patterns to Avoid

- **Không dùng** `-preset slow` hoặc `veryslow` — NVENC không như x264, đây là hardware encode
- **Không dùng** `-rc constqp` cho VBR content — CRF mode NVENC không tối ưu
- **Không hardcode** GPU device `0` — hỗ trợ multi-GPU systems
- **Không ignore** `-max_muxing_queue_size` khi dùng complex filter chains
- **Không merge** segments với re-encode — dùng `-c copy` concat để tránh quality loss
- **Không encode** nhiều hơn 2 sessions trên RTX 5080 — NVENC encoder count = 2

---

## FFmpeg NVENC Reference

```
NVENC Presets (nhanh → chậm):
  p1 / lossless   — fastest, larger file
  p2              — fast
  p3              — default (balanced)
  p4 / fast       — current baseline
  p5 / medium     — slower
  p6              — slow
  p7 / slow       — slowest

Rate Control:
  -rc constqp     — CRF equivalent (ignore for VBR content)
  -rc vbr         — Variable Bitrate (recommended)
  -rc vbr_hq      — VBR High Quality (2-pass)
  -rc cbr          — Constant Bitrate (streaming)
  -cq             — VBR quality level (lower = better, 18-28 typical)

Codec:
  h264_nvenc      — H.264/AVC (best compatibility)
  hevc_nvenc      — H.265/HEVC (40-50% smaller, same quality)
  av1_nvenc       — AV1 (best compression, newest, slower)

Hardware:
  -hwaccel cuda    — use GPU for decoding
  -hwaccel_device N — use GPU N (0-indexed)
  -c:v h264_cuvid — GPU decode H.264
  -c:v hevc_cuvid — GPU decode HEVC

Tune flags:
  -tune hq        — High Quality content
  -tune ll        — Low Latency / gaming
  -tune ull       — Ultra Low Latency
  -tune film      — Film content
  -tune animation — Animation

Other useful:
  -spatial-aq 1   — Spatial adaptive quantization (quality boost)
  -temporal-aq 1  — Temporal AQ (video stability)
  -rc-lookahead 32 — Better VBR with small overhead
  -profiles:v high — H.264 profile (max compatibility)
```
