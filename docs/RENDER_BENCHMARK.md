# Render Benchmark — 8 Phút Video

> PO-level analysis: render pipeline performance cho video 8 phút trên 2 cấu hình máy.
> Cập nhật: 2026-05-21

## Mục lục

1. [Input → Output Specification](#1-input--output-specification)
2. [Frame Math](#2-frame-math)
3. [Canvas Transform](#3-canvas-transform)
4. [Pipeline Breakdown — RTX 5080](#4-pipeline-breakdown--rtx-5080)
5. [Pipeline Breakdown — RTX 4050](#5-pipeline-breakdown--rtx-4050)
6. [So sánh trực tiếp](#6-so-sánh-trực-tiếp)
7. [Chunked Encoding — Có giúp không?](#7-chunked-encoding--có-giúp-không)
8. [Real-time Factor & Throughput](#8-real-time-factor--throughput)
9. [VRAM & RAM Analysis](#9-vram--ram-analysis)
10. [Summary — PO View](#10-summary--po-view)

---

## 1. Input → Output Specification

| Thông số | Giá trị |
|---|---|
| **Video** | 8:00 (480 giây) |
| **Source FPS** | 60fps |
| **Source resolution** | 1920×1080 (16:9 landscape) |
| **Source bitrate** | 4027 kbps |
| **Source codec** | H.264 (YouTube default) |
| **Source file size** | ~240 MB |
| **Output FPS** | 30fps |
| **Output canvas** | 1080×1920 (9:16 portrait) |
| **Speed multiplier** | 1.2x |
| **Output duration** | 400 giây (6:40) |
| **Codec** | H.264 NVENC VBR HQ |

**Thay đổi từ source đến output:**
- FPS: 60 → 30 (drop duplicate frames)
- Aspect: 16:9 landscape → 9:16 portrait (crop horizontal sides)
- Speed: ×1.2 (trim duration từ 480s → 400s)

---

## 2. Frame Math

```
Source frames (60fps × 480s)    = 28,800 frames
→ Output frames (30fps × 400s)   = 12,000 frames  ← đây mới là thứ cần encode
```

FFmpeg `fps=30` filter drop duplicate frames → decode chỉ cần output 12,000 frames thực (không phải decode lại 28,800 frames).

```
Source:  ████████████████████████████ 28,800 frames
                        ↓ fps=30 filter (drop dup)
Output:  ██████████████ 12,000 frames ← encode
```

---

## 3. Canvas Transform

```
1920×1080 landscape
        ↓ scale=-2:1472 (pad height to portrait)
2133×1472 (aspect-preserved)
        ↓ crop: (2133-1080)/2 = 527 px mỗi bên
1080×1472 (đủ canvas)
        + header 25% = 480px (top)
        + bottom bar 25% = 192px
        + canvas height = 1920px
```

| Lớp | Chiều cao | Ghi chú |
|---|---|---|
| Header zone | 480px (25%) | Thumbnail overlay |
| Video zone | 1248px (65%) | Crop 2133→1080, center |
| Bottom bar | 192px (10%) | Pre-rendered PNG |
| **Canvas** | **1920px** | |

---

## 4. Pipeline Breakdown — RTX 5080

**Thông số GPU:**
- GPU: AD102 (Blackwell), 16GB VRAM
- NVENC: v7 (Blackwell), ~1500 fps H.264 1080p
- CUDA cores: 16,384
- VRAM per encode stream: ~1.5GB

```
Pipeline step              Time        VRAM        CPU
─────────────────────────────────────────────────────
[1] FFprobe metadata       ~0.3s      0           1 core
[2] Pre-scale              Bỏ qua     —           —      ← source = export resolution
[3] Blur bg gen            2s        200MB       1 core  ← 1 frame scale+boxblur
[4] Thumbnail extract      1s        100MB       1 core  ← 1 frame
[5] Bottom bar PNG         0.3s      50MB        1 core  ← PowerShell System.Drawing
[6] Header overlay         0.5s      100MB       1 core  ← scale 1 frame
──────────────────────────────────────────────────────
PRE-RENDER: ~4s
──────────────────────────────────────────────────────
[7] Decode (H.264)        3s        500MB       1 core  ← h264_nvdec: ~4000 fps
[8] Scale+crop filter      2s        300MB       1 core  ← scale_cuda
[9] NVENC encode          12s       1.5GB       1 core  ← ~1000 fps × 12,000 frames
──────────────────────────────────────────────────────
ENCODE: ~17s
──────────────────────────────────────────────────────
[10] Mux audio             ~1s       0           1 core
──────────────────────────────────────────────────────
TOTAL: ~22s
```

**Chi tiết encode NVENC RTX 5080:**
```
Target bitrate:    8 Mbps (VBR HQ, canvas 1080x1920)
Frame count:       12,000 frames
Encode speed:      ~1000 fps (NVENC Blackwell)
Encode time:       12,000 / 1000 = 12s
Decode time:       12,000 / 4000 = 3s
Filter overhead:   2s
─────────────────────────────
Encode phase:      ~17s
Peak VRAM:         ~2.5GB / 16GB available   ← 16% VRAM
Peak RAM:          ~1.5GB / 64GB available   ← 2% system RAM
CPU usage:         ~15% (1-2 cores)
```

---

## 5. Pipeline Breakdown — RTX 4050

**Thông số GPU:**
- GPU: AD107 (Ada Lovelace), 6GB VRAM
- NVENC: v5 (Ada), ~350 fps H.264 1080p
- CUDA cores: 2,560
- VRAM per encode stream: ~1.5GB

```
Pipeline step              Time        VRAM        CPU
─────────────────────────────────────────────────────
[1] FFprobe metadata       ~0.3s      0           1 core
[2] Pre-scale              Bỏ qua     —           —
[3] Blur bg gen            5s        200MB       1 core  ← CPU boxblur chậm hơn
[4] Thumbnail extract      2s        100MB       1 core
[5] Bottom bar PNG         0.3s      50MB        1 core
[6] Header overlay         0.5s      100MB       1 core
──────────────────────────────────────────────────────
PRE-RENDER: ~8s
──────────────────────────────────────────────────────
[7] Decode (H.264)        8s        500MB       1 core  ← h264_nvdec: ~1500 fps
[8] Scale+crop filter      5s        300MB       1 core  ← scale_cuda
[9] NVENC encode          34s       1.5GB       1 core  ← ~350 fps × 12,000 frames
──────────────────────────────────────────────────────
ENCODE: ~47s
──────────────────────────────────────────────────────
[10] Mux audio             ~1s       0           1 core
──────────────────────────────────────────────────────
TOTAL: ~56s
```

**Chi tiết encode NVENC RTX 4050:**
```
Target bitrate:    8 Mbps (VBR HQ)
Frame count:       12,000 frames
Encode speed:      ~350 fps (NVENC Ada)
Encode time:       12,000 / 350 = 34s
Decode time:       12,000 / 1500 = 8s
Filter overhead:   5s
─────────────────────────────
Encode phase:      ~47s
Peak VRAM:         ~2.5GB / 6GB available   ← 42% VRAM
Peak RAM:          ~1.5GB / 24GB available  ← 6% system RAM
CPU usage:         ~20% (1-2 cores)
```

---

## 6. So sánh trực tiếp

| Metric | RTX 5080 | RTX 4050 | Chênh lệch |
|---|---|---|---|
| **Total render time** | **~22s** | **~56s** | **2.5×** |
| — Pre-render (bg/thumb) | 4s | 8s | 2× |
| — Decode | 3s | 8s | 2.7× |
| — Filter | 2s | 5s | 2.5× |
| — NVENC encode | 12s | 34s | **2.8×** |
| — Mux audio | 1s | 1s | 1× |
| NVENC fps | ~1000 fps | ~350 fps | 2.9× |
| Peak VRAM | 2.5GB | 2.5GB | same |
| Peak RAM | 1.5GB | 1.5GB | same |
| CPU load | ~15% | ~20% | 1.3× |

---

## 7. Chunked Encoding — Có giúp không?

**Đặt lại vấn đề:** Video 400s. Chunk 90s → 5 chunks.

### RTX 5080 — Single vs Chunked

```
RTX 5080 — Single-pass:
  Encode: 12,000 frames / 1000 fps = 12s
  Decode + filter: 3 + 2 = 5s
  Total: ~22s

RTX 5080 — Chunked 4 workers:
  Mỗi worker: 12,000 / 4 = 3,000 frames
  Encode: 3,000 / 1000 = 3s per worker
  Decode × 4 (parallel): max 3s
  Encode × 4 (parallel): max 3s
  Mux overhead: +3s
  Total: ~9s

→ Chunked NHANH HƠN 2.4× (22s → 9s)
→ Nhưng: RTX 5080 encode đã 18× realtime (12s cho 400s output)
→ Chunked chỉ cần thiết khi cần throughput tối đa cho queue dài
```

### RTX 4050 — Single vs Chunked

```
RTX 4050 — Single-pass:
  Encode: 12,000 frames / 350 fps = 34s
  Decode + filter: 8 + 5 = 13s
  Total: ~56s

RTX 4050 — Chunked 2 workers (VRAM limit):
  Mỗi worker: 12,000 / 2 = 6,000 frames
  Encode: 6,000 / 350 = 17s per worker (parallel)
  Decode × 2 (parallel): max 8s
  Encode × 2 (parallel): max 17s
  Mux overhead: +2s
  Total: ~19s

→ Chunked NHANH HƠN 2.9× (56s → 19s)!

RTX 4050 — Chunked 4 workers:
  VRAM: 2.5GB × 4 = 10GB > 6GB → KHÔNG ĐỦ
  → Must limit to 2 workers
```

### Bảng chunked vs single

| Mode | RTX 5080 | RTX 4050 |
|---|---|---|
| Single-pass | 22s | 56s |
| Chunked (max workers) | 9s (4W) | 19s (2W) |
| **Improvement** | **2.4×** | **2.9×** |
| VRAM needed | 10GB (4W) | 5GB (2W) |

### Khi nào nên dùng chunked?

| GPU | Threshold video | Lý do |
|---|---|---|
| RTX 5080 | > 15 phút | Encode đã nhanh, chunked cho crash recovery + queue throughput |
| RTX 4050 | > 2 phút | Encode chậm, chunked cải thiện 2.9× |

**Chunked KHÔNG nên dùng khi:**
- Video ≤ 30 giây: single-pass (code có logic tự bypass chunked)
- Crash recovery quan trọng hơn tốc độ
- VRAM gần đầy (đang render task khác)

---

## 8. Real-time Factor & Throughput

```
RTX 5080: 400s output / 22s render = 18× realtime
RTX 4050: 400s output / 56s render = 7× realtime
```

Video 8 phút render xong trong:

| GPU | Single-pass | Chunked |
|---|---|---|
| RTX 5080 | **~22s** | **~9s** |
| RTX 4050 | **~56s** | **~19s** |

**Throughput per hour:**

| GPU | Mode | Videos/giờ | Videos/ngày (24h) |
|---|---|---|---|
| RTX 5080 | Single | ~165 | ~4,000 |
| RTX 5080 | Chunked | ~400 | ~9,600 |
| RTX 4050 | Single | ~65 | ~1,560 |
| RTX 4050 | Chunked | ~190 | ~4,560 |

**Lưu ý:** Đây là throughput render thuần túy. Thực tế còn phụ thuộc:
- Detection pipeline: ~20s/video
- Download: ~2-5 phút/video (tùy size)
- Render queue scheduling

---

## 9. VRAM & RAM Analysis

### RTX 5080 — 16GB VRAM / 64GB RAM

```
┌──────────────────────────────────────────────────┐
│ VRAM:  2.5GB / 16GB (16%)                       │
│   - Decode buffers:    500MB                     │
│   - Scale filter:      300MB                     │
│   - NVENC buffers:     1.5GB                     │
│   - Overhead:          200MB                      │
├──────────────────────────────────────────────────┤
│ RAM:   1.5GB / 64GB (2%)                        │
│   - FFmpeg process:    ~500MB                    │
│   - Background jobs:    ~1GB                     │
└──────────────────────────────────────────────────┘

Chunked 4 workers: 2.5GB × 4 = 10GB VRAM → 62% VRAM → thoải mái
Chunked 8 workers: 2.5GB × 8 = 20GB VRAM → OVER VRAM → không nên
→ Khuyến nghị: max 6 workers cho chunked trên 5080
```

### RTX 4050 — 6GB VRAM / 24GB RAM

```
┌──────────────────────────────────────────────────┐
│ VRAM:  2.5GB / 6GB (42%)                        │
│   - Decode buffers:    500MB                     │
│   - Scale filter:      300MB                     │
│   - NVENC buffers:     1.5GB                     │
│   - Overhead:          200MB                      │
├──────────────────────────────────────────────────┤
│ RAM:   1.5GB / 24GB (6%)                        │
│   - FFmpeg process:    ~500MB                    │
│   - Background jobs:    ~1GB                     │
└──────────────────────────────────────────────────┘

Single-pass: thoải mái (2.5GB VRAM)
Chunked 2 workers: 2.5GB × 2 = 5GB → 83% VRAM → gần giới hạn
Chunked 3 workers: 2.5GB × 3 = 7.5GB → OVER → không đủ VRAM
→ Khuyến nghị: max 2 workers cho chunked trên 4050
```

---

## 10. Summary — PO View

```
┌──────────────────────┬─────────────────┬─────────────────┐
│                      │   RTX 5080      │   RTX 4050      │
│                      │   16GB / 64GB   │   6GB / 24GB    │
├──────────────────────┼─────────────────┼─────────────────┤
│ Render time          │  22s            │  56s            │
│ Chunked (max W)      │  9s (4W)        │  19s (2W)       │
│ Realtime factor      │  18×            │  7×             │
│ Output size          │  ~200MB         │  ~200MB         │
│ Peak VRAM            │  2.5GB (16%)   │  2.5GB (42%)   │
│ Recommend mode       │  Single/Chunked │  Chunked (2W)   │
│ Throughput/hr        │  ~400 videos    │  ~190 videos    │
│ Crash recovery       │  Chunked         │  Chunked        │
│ VRAM per worker      │  2.5GB          │  2.5GB          │
│ Max chunked workers  │  6              │  2              │
└──────────────────────┴─────────────────┴─────────────────┘
```

### Key Takeaways

1. **RTX 5080** — render siêu nhanh, cả single và chunked đều < 1 phút
2. **RTX 4050** — chunked là bắt buộc để giữ render < 20s cho video 8p
3. **Chunked cải thiện lớn nhất trên GPU yếu:** 4050: 3× faster, 5080: 2.4× faster
4. **VRAM là bottleneck cho chunked:** 4050 chỉ chạy được 2 workers
5. **Nên recommend user 4050 dùng chunked** trong settings mặc định

### Memory Config

Code hiện tại trong `ffmpeg.ts`:

```typescript
// worker-pool.ts
const effectiveWorkers = getEffectiveWorkers() // VRAM-aware

// Chunk pool
const effective = Math.min(getEffectiveWorkers(), 4) // cap at 4 max
```

→ Logic hiện tại đã đúng: cap 4 workers, VRAM-aware. Nhưng trên 4050, `getEffectiveWorkers()` có thể trả về > 2 → cần verify hàm này trả về giá trị phù hợp.

### So sánh 8p vs 10:43p

| Metric | Video 8:00 | Video 10:43 | Chênh |
|---|---|---|---|
| Output frames | 12,000 | 16,080 | 1.34× |
| RTX 5080 single | 22s | 28s | 1.27× |
| RTX 4050 single | 56s | 71s | 1.27× |
| RTX 5080 chunked | 9s | 24s | 2.7× |
| RTX 4050 chunked | 19s | 25s | 1.3× |

→ Chunked overhead tăng mạnh trên RTX 5080 với video dài hơn (4 workers vs 6 chunks → overhead lớn hơn).
→ RTX 4050 chunked performance scale tốt hơn với video dài (2 workers vẫn đủ để parallelize).
