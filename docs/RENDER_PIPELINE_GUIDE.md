# Render Pipeline Guide — Short Mode (9:16)

> Dành cho: AI agents khi cần render hoặc debug render.
> **Luôn đọc file này trước khi chạy bất kỳ lệnh render nào.**

---

## 1. 4 Input Streams

Render Short mode cần **đúng 4 input streams**, không hơn không kém:

| Index | Content | Source | Duration |
|-------|---------|--------|----------|
| `[0:v]` | Source video (16:9) | File MP4/MKV gốc | Full |
| `[1:v]` | Background | Blur image (loop) hoặc solid lavfi color | Loop/static |
| `[2:v]` | Header overlay | Thumbnail image (loop) | Loop/static |
| `[3:v]` | Bottom bar PNG | **Pre-rendered** file `.png` | Static single frame |

⚠️ **Quan trọng:** Bottom bar là PNG file thật (đã pre-render sẵn), không phải lavfi color. Nếu dùng lavfi color thay PNG, bar sẽ không có text và màu accent.

---

## 2. Zone Layout

Canvas 9:16 (1080×1920 là chuẩn):

```
┌─────────────────┐  y=0
│  HEADER ZONE    │  20% = 384px
│  (thumbnail)    │      ← overlay [2:v] scale crop
├─────────────────┤  y=384
│                 │
│  VIDEO ZONE     │  70% = 1344px
│  (source crop)  │      ← [0:v] scale=-2:1344 crop=1080:1344
│                 │
├─────────────────┤  y=1728
│  BOTTOM BAR     │  10% = 192px
│  (accent + text)│      ← [3:v] null, overlay=0:1728
└─────────────────┘  y=1920
```

### Công thức

```
headerH     = canvasH * 20%
bottomH     = canvasH * 10%
videoH      = canvasH - headerH - bottomH   (70%)
bottomBarY  = headerH + videoH              (= canvasH - bottomH)
cropX       = ((videoH * 16/9) - canvasW) / 2
```

---

## 3. Đúng Filter Chain (Electron Reference)

```
[0:v]fps=30,trim=start=0:end=N,setpts=PTS-STARTPTS,
      scale=-2:videoH:flags=lanczos,crop=canvasW:videoH:cropX:0[vid]

[1:v]scale=canvasW:canvasH:force_original_aspect_ratio=increase,
      crop=canvasW:canvasH:(ow-iw)/2:(oh-ih)/2,setsar=1[bg]

[2:v]scale=canvasW:headerH:force_original_aspect_ratio=increase,
      crop=canvasW:headerH:(ow-iw)/2:(oh-ih)/2[hd]

[3:v]null[bb]

[bg][vid]overlay=0:headerH[vz]
[vz][hd]overlay=0:0[vh]              (header ON TOP of video)
[vh][bb]overlay=0:bottomBarY[final]  (bottom bar ON TOP)
```

**Z-order (bottom → top):** `bg → video → header → bottom_bar`

> Lưu ý: Header nằm **dưới** bottom bar, nhưng nằm **trên** video. Bottom bar là layer trên cùng — nó phải đè lên header và video.

---

## 4. Bottom Bar Pre-render

Bottom bar là PNG được tạo riêng, KHÔNG dùng drawtext hay lavfi.

### PowerShell Script (reference từ Electron)

```powershell
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap($canvasW, $bottomH)
$g = [System.Drawing.Graphics]::FromImage($bmp)

# Fill accent color (ví dụ #00B4FF → RGB 0,180,255)
$brush = New-Object System.Drawing.SolidBrush(
  [System.Drawing.Color]::FromArgb(255, $r, $g, $b))
$g.FillRectangle($brush, 0, 0, $canvasW, $bottomH)

# Gradient overlay (top 60%)
$gradTop = [Math]::Floor($bottomH * 0.60)
$brush2 = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
  (New-Object Drawing.Point(0,0)), (New-Object Drawing.Point(0,$gradTop)),
  [Drawing.Color]::FromArgb(200,0,0,0), [Drawing.Color]::Transparent)
$g.FillRectangle($brush2, 0, 0, $canvasW, $gradTop)

# White text centered
$font = New-Object Drawing.Font("Arial", 48, [Drawing.FontStyle]::Bold)
$sf = New-Object Drawing.StringFormat
$sf.Alignment = [Drawing.StringAlignment]::Center
$sf.LineAlignment = [Drawing.StringAlignment]::Center
$rect = New-Object Drawing.RectangleF(0, 0, $canvasW, $bottomH)
$g.DrawString("TEXT HERE", $font,
  (New-Object Drawing.SolidBrush([Drawing.Color]::White)), $rect, $sf)

# CRITICAL: LockBits force A=255 trên mọi pixel
$rect2 = New-Object Drawing.Rectangle(0, 0, $canvasW, $bottomH)
$bd = $bmp.LockBits($rect2,
  [Drawing.Imaging.ImageLockMode]::ReadWrite,
  [Drawing.Imaging.PixelFormat]::Format32bppArgb)
$bytes = [byte[]]::new($bd.Stride * $bottomH)
[Marshal]::Copy($bd.Scan0, $bytes, 0, $bytes.Length)
for($i=3; $i -lt $bytes.Length; $i+=4) { $bytes[$i] = 255 }
[Marshal]::Copy($bytes, 0, $bd.Scan0, $bytes.Length)
$bmp.UnlockBits($bd)

$bmp.Save($outputPath, [Drawing.Imaging.ImageFormat]::Png)
```

---

## 5. Assets Chuẩn Bị Trước Khi Render

### Thumbnail (cho header)
```bash
ffmpeg -i source.mp4 -vframes 1 -vf "scale=1280:-2" -q:v 2 thumb.jpg
```

### Blur background
```bash
ffmpeg -i source.mp4 -vf "scale=32:18:flags=bilinear,scale=1080:1920:flags=bilinear" \
  -vframes 1 blur.jpg
```

### Bottom bar PNG
Dùng PowerShell script ở section 4 hoặc Python PIL.

---

## 6. Full Render Command (Template)

```bash
ffmpeg -hide_banner -y \
  -i "<source.mp4>" \
  -loop 1 -i "<blur.jpg>" \
  -loop 1 -i "<thumb.jpg>" \
  -i "<bottom_bar.png>" \
  -filter_complex "\
[0:v]fps=30,trim=start=<START>:end=<END>,setpts=PTS-STARTPTS,\
  scale=-2:<VIDEO_H>:flags=lanczos,crop=<CANVAS_W>:<VIDEO_H>:<CROP_X>:0[vid];\
[1:v]scale=<CANVAS_W>:<CANVAS_H>:force_original_aspect_ratio=increase,\
  crop=<CANVAS_W>:<CANVAS_H>:(ow-iw)/2:(oh-ih)/2,setsar=1[bg];\
[bg][vid]overlay=0:<HEADER_H>[vz];\
[2:v]scale=<CANVAS_W>:<HEADER_H>:force_original_aspect_ratio=increase,\
  crop=<CANVAS_W>:<HEADER_H>:(ow-iw)/2:(oh-ih)/2[hd];\
[vz][hd]overlay=0:0[vh];\
[3:v]null[bb];\
[vh][bb]overlay=0:<BOTTOM_Y>[final]" \
  -t <DURATION> -map "[final]" -map "0:a?" \
  -c:v h264_nvenc -preset p1 -rc:v vbr_hq -cq 18 -tune ull \
  -bf 0 -refs 1 -g 30 -maxrate 12M -bufsize 12M \
  -c:a aac -b:a 192k \
  "<output.mp4>"
```

### Tabel tham số cho 1080p

| Biến | Giá trị | Ghi chú |
|------|---------|---------|
| CANVAS_W | 1080 | |
| CANVAS_H | 1920 | |
| HEADER_H | 384 | canvasH × 20% |
| VIDEO_H | 1344 | canvasH × 70% |
| BOTTOM_H | 192 | canvasH × 10% |
| BOTTOM_Y | 1728 | headerH + videoH |
| CROP_X | 654 | ((videoH×16/9) - canvasW)/2 |
| DURATION | 5 | giây |

---

## 8. Settings-Driven Render

Render dùng settings từ `SettingsModel`:

| QML Property | Rust setting key | Default | Ý nghĩa |
|-------------|-----------------|---------|---------|
| `settings.autoRenderResolution` | `auto_render_resolution` | `"1080p"` | Độ phân giải output |
| `settings.autoRenderFPS` | `auto_render_fps` | `30` | FPS output |
| `settings.autoRenderSpeed` | `auto_render_speed` | `1.0` | Tốc độ (1.0-2.0) |
| `settings.autoSplitParts` | `auto_split_parts` | `1` | Số phần tách mặc định |
| `settings.autoSplitMinutes` | `auto_split_minutes` | `0` | Số phút mỗi phần |
| `settings.autoRenderTitleTemplate` | `auto_render_title_template` | `"{title}"` | Template tiêu đề |

### Split & Auto-Render (mới)

SplitModal cho phép:
1. Chọn số video (1-3)
2. Nhập title riêng từng video
3. Chọn resolution/FPS/speed riêng (mặc định từ settings)
4. Bật/tắt auto-render sau split

Backend `workspace:split` nhận:
- `parts[i].title` — title riêng từng part
- `autoRender` — bool
- `renderResolution`, `renderFPS`, `renderSpeed` — override settings

---

## 7. Common Bugs

### Bug 1: `scalescale` trong filter graph
**Format string sai**: `{}scale=-2:{}` → biến tên `scale` trùng với literal.
**Fix**: Dùng `{}=-2:{}` hoặc đặt tên biến khác (`scale_algo`).

### Bug 2: Thiếu `-t duration`
Không có `-t` → audio stream dài nhất quyết định output duration (ví dụ 120s).

### Bug 3: Dùng solid color thay vì real assets
Placeholder solid colors → video nhìn "thiếu". Cần 4 inputs riêng:
`source + blur bg + thumbnail header + bottom bar PNG`.

### Bug 4: `scale_flags` bị tách thành filter riêng
`:flags=lanczos` sau `-2:1344,` → bị hiểu là filter mới.
**Fix**: `scale=-2:1344:flags=lanczos` (dùng `:` không phải `,`).

### Bug 5: Z-order sai (header đè lên bottom bar)
Electron reference: `vh → bb` overlay (bottom bar cuối cùng).
Nếu header overlay cuối → header đè lên bottom bar → bar bị che.

---

## 8. Rust Code Mapping

| Rust function | Electron equivalent | Tham số |
|--------------|--------------------|---------|
| `build_short_filter()` | `buildFilterComplex(isShort=true)` | trim, speed, canvas, header_h, bottom_bar_h |
| `build_short_filter_cuda()` | `buildFilterComplex(useCuda=true)` | Same + CUDA suffix |
| `spawn_render_async()` | `renderVideo()` | Options → FFmpeg command |
| `preRenderOverlays()` | `preRenderOverlays()` | PowerShell PNG (chưa port sang Rust) |
| WorkerPool | Semaphore | Max concurrent renders |

### Z-order hiện tại trong Rust vs Electron

```
Rust (build_short_filter):     bg → video → bottom_bar → header
Electron (buildFilterComplex):  bg → video → header → bottom_bar
```

⚠️ **Khác nhau:** Rust đặt bottom_bar trước header. Trong hầu hết trường hợp bottom_bar che header zone (y=0 → headerH) nên không thấy sự khác biệt. Nhưng nếu bottom bar có vùng transparent ở top, header sẽ lộ ra — lúc đó Electron đúng hơn.
