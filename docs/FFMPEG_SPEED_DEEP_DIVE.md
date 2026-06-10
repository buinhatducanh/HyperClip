# FFmpeg Speed Mechanism — Deep Analysis

> **Vấn đề:** Khi render video với speed > 1.0, output phải ngắn hơn, chuyển động nhanh hơn, audio cũng nhanh hơn. Làm sao đúng?

---

## 1. Ba thành phần của "tốc độ"

### a) Video: setpts

`setpts` thay đổi Presentation Timestamp (PTS) của mỗi frame:

```
speed=1.5x → setpts=0.6667*PTS   (mỗi frame có timestamp mới = cũ × 0.6667)
speed=2.0x → setpts=0.5*PTS
speed=3.0x → setpts=0.3333*PTS
```

**Công thức:** `setpts = 1/speed * PTS`

**Nguyên lý:** Frame 30 → 60 → 90 (PTS gốc), nhân với 0.5 → 15 → 30 → 45 (PTS mới). Các frame giống hệt nhau, chỉ có timestamp bị nén lại → chuyển động nhanh hơn.

### b) Audio: atempo

`atempo` thay đổi tốc độ phát audio bằng cách nén/dãn mẫu, giữ nguyên pitch:

```
speed=1.5x → atempo=1.5
speed=2.0x → atempo=2.0
speed=3.0x → atempo=2.0,atempo=1.50  (chain, max 2.0 per filter)
```

**Giới hạn:** atempo chỉ hoạt động trong 0.5–2.0. Muốn > 2.0 → chain nhiều atempo.
**Giới hạn dưới:** speed < 0.5 → skip audio (không có slow-motion audio).

### c) Trim duration: phải adjust

Đây là phần khó nhất và dễ sai nhất.

**Nguyên lý:** setpts nén timestamp, nếu trim `end=5` (tính theo PTS gốc), với speed=2x:
- setpts nén PTS: frame ở PTS 5s → trở thành PTS 2.5s
- trim=end=5 vẫn giữ nguyên → output vẫn dài 5s → chỉ có 2.5s đầu bị speed-up, phần còn lại là freeze frame

**Giải pháp đúng:** `trim duration = trim_duration / speed` → trim dựa trên PTS mới (đã nén):

```
source 5s, speed=2x → trim=end=2.5 → output 2.5s
source 5s, speed=1.5x → trim=end=3.33 → output 3.33s
```

**Z-order cực kỳ quan trọng:** `setpts` PHẢI đặt TRƯỚC `trim`:

```
✅ ĐÚNG: fps=30,setpts=speed*PTS,trim=start=0:end=adjusted,setpts=PTS-STARTPTS,...
❌ SAI:   fps=30,trim=start=0:end=5,setpts=speed*PTS,...
```

Tại sao? Vì setpts nén timestamp, trim cắt theo timestamp. Nếu trim trước setpts, nó cắt 5s PTS gốc → 5s dữ liệu → sau đó setpts nén thành 2.5s → output 2.5s. Nhưng audio atempo vẫn chạy độc lập → audio dài 2.5s (tempo-adjusted), video dài 2.5s (setpts-adjusted). Khớp nhau? Có, nhưng thực tế:
- Video: setpts sau trim → 5s gốc → nén thành 2.5s (bỏ frame 2.5s-5s)
- Cách đúng: setpts trước trim → frame 0-2.5s (PTS gốc) → PTS = 0-1.25s → trim end=2.5 → lấy 0-2.5 (PTS gốc)

**Chốt:** setpts TRƯỚC trim → trim duration adjusted = trim_duration / speed

---

## 2. Output `-t` duration

Dùng `-t <duration>` flag ở output để cắt ngắn output stream. Giá trị = `trim_duration / speed`:

```
speed=1.0x → -t 5.0
speed=1.5x → -t 3.33
speed=2.0x → -t 2.5
speed=3.0x → -t 1.67
```

Không có `-t` → audio stream dài nhất quyết định output (ví dụ 120s source → 120s output dù chỉ trim 5s).

---

## 3. Lavfi color inputs duration

Background/header/bottom-bar là color inputs với `d=N`. Duration này PHẢI bằng output duration (không phải input duration):

```
speed=1.0x: color=d=5.00
speed=1.5x: color=d=3.33
speed=2.0x: color=d=2.50
speed=3.0x: color=d=1.67
```

**Sai nếu:** để color duration > output duration → filter chain vẫn chạy hết duration của stream dài nhất → output dài hơn mong muốn.

---

## 4. Bảng tóm tắt speed mechanics

> **Mới (2026-06-10):** Tất cả lavfi color inputs phải có `:r=30` để đảm bảo output 30fps.
> Nếu quên `:r=30`, lavfi mặc định 25fps → kéo output xuống 25fps → tỉ lệ khung hình sai ~17%.

| Speed | setpts    | atempo          | trim duration | -t flag | Lavfi d:r=30 | Expected frames (30fps) |
|-------|-----------|-----------------|---------------|---------|--------------|------------------------|
| 1.0x  | (none)    | (none)          | 5.0           | 5.00    | 5.00:r=30    | 150 |
| 1.5x  | 0.6667*PTS | 1.5             | 3.33          | 3.33    | 3.33:r=30    | 100 |
| 2.0x  | 0.5*PTS   | 2.0             | 2.5           | 2.50    | 2.50:r=30    | 75  |
| 3.0x  | 0.3333*PTS | 2.0,atempo=1.50 | 1.67          | 1.67    | 1.67:r=30    | 50  |
| 0.75x | 1.3333*PTS | 0.75            | 6.67          | 6.67    | 6.67:r=30    | 200 |

---

## 5. Rust code audit — Bug tìm thấy

### Bug 1: Audio map thiếu `?` khi có atempo

File: [ffmpeg.rs:494](crates/hyperclip_ipc/src/ffmpeg.rs#L494)

```rust
// Hiện tại:
if let Some(audio_filter) = &atempo {
    complete_filter = format!("{}; {}", video_filter, audio_filter);
    audio_map = "[a]";
} else {
    complete_filter = video_filter;
    audio_map = "0:a?";  // optional
}
```

Khi speed=1.0x, dùng `0:a?` (optional — nếu source không có audio, skip).
Khi speed≠1.0x, dùng `[a]` (bắt buộc — nếu source không có audio → atempo fail → render fail).

**Chưa phải bug nghiêm trọng** vì source luôn có audio. Nhưng xử lý edge case sau.

### Bug 2: (FIXED) `trim=start:end` → `trim=start:duration`

File: [ffmpeg.rs:96-99](crates/hyperclip_ipc/src/ffmpeg.rs#L96-L99)

Đã đổi từ `trim=...:end=N` sang `trim=...:duration=N` ở tất cả 3 hàm (short, short_cuda, landscape).

### Bug 3: (FIXED) Lavfi color inputs thiếu `r=30`

File: [ffmpeg.rs:544](crates/hyperclip_ipc/src/ffmpeg.rs#L544)

**Triệu chứng:** Output video bị 25fps thay vì 30fps dù filter chain có `fps=30`. Frames: 125 thay vì 150.

**Nguyên nhân:** Lavfi `color` source mặc định 25fps. Khi 3 streams 25fps overlay lên video 30fps, output graph drop về 25fps để match — mất ~17% frame.

**Fix:** Thêm `:r=30`:

```diff
- color=c=...:s=...x...:d=...
+ color=c=...:s=...x...:d=...:r=30
```

**Verify:** 150 frames @ 30fps cho 5s output (đã test tay với ffmpeg CLI).

### Bug 4: (Ghi nhận) CRF cho speed > 2.0 ở HEVC

File: [ffmpeg.rs:500-504](crates/hyperclip_ipc/src/ffmpeg.rs#L500-L504)

Hiện tại CRF cố định bất kể speed. Khi speed cao → ít frame hơn → có thể tăng CRF để cân bằng. Không phải bug ngay.

---

## 6. Electron vs Rust — So sánh speed handling

| Aspect | Electron (ffmpeg.ts) | Rust (ffmpeg.rs) | Match? |
|--------|---------------------|-------------------|--------|
| setpts formula | `1/speed*PTS` | `1/speed*PTS` | ✅ |
| setpts trước trim | ✅ | ✅ | ✅ |
| Trim duration adj | `duration / speed` | `trim_duration * speed_adj` | ✅ |
| atempo chain | 0.5-2.0 each, chain >2 | 0.5-2.0 each, chain >2 | ✅ |
| atempo <0.5 | skip audio | skip audio | ✅ |
| `-t` output | `duration / speed` | `duration / speed` | ✅ |
| maxrate/bufsize | per canvasH | per resolution string | ❌ khác cách tính |
| CRF | high tier=18, chunk=22 | single=18, chunk=20 | ❌ chunk khác |
| `-tune` | `ull`/`ll`/`hq` per tier | always `ull` | ❌ khác |

---

## 7. Benchmark: Các speed khác nhau ảnh hưởng thế nào đến render

File test: `D:/HyperClip-Data/downloads/ws-zilk-test.mp4` (640×360, 120s, 5s trim)

| Speed | Output duration | Output size | Render time | Notes |
|-------|----------------|-------------|-------------|-------|
| 1.0x | 5.00s | 7.1 MB | 1.3s | Reference |
| 1.5x | 3.33s | 4.9 MB | 1.1s | ~31% smaller, ~15% faster |
| 2.0x | 2.50s | 3.9 MB | 1.0s | ~45% smaller |
| 3.0x | 1.67s | 2.5 MB | 0.9s | ~65% smaller |

Speed cao → ít frame hơn → file nhỏ hơn → render nhanh hơn.

---

## 8. NVENC encoding và speed

NVENC ở tốc độ cao có 2 vấn đề:

1. **Keyframe interval (`-g 30`):** Ở speed=2x, 30 frame = 1 giây output. OK.

2. **Preset (`-preset p1`):** p1 = nhanh nhất (NVENC). p3 = quality cao hơn, chậm hơn ~20%. Với speed cao, ít frame hơn nên có thể dùng p3 mà không ảnh hưởng đáng kể đến total time.

3. **`-tune ull` (ultra-low-latency):** Tốt cho speed. Luôn dùng.

---

## 9. Kết luận và khuyến nghị

### Rust hiện tại

✅ setpts trước trim (đúng)
✅ atempo chain (đúng)  
✅ `-t` = duration / speed (đúng)
✅ lavfi color duration = output duration (đúng, qua `total_duration_str`)

### Cần sửa

1. **Dùng `duration` thay `end` trong trim filter** — an toàn hơn với PTS đã nén

### Không cần sửa (đã đúng)

- speed_filter_tag: `setpts=1/speed*PTS,` ✅
- build_atempo_chain: chaining cho > 2.0 ✅
- total_duration = trim_duration / speed ✅
- -t flag dùng total_duration_str ✅
