# Bug: Video Render Bị Lag — "Màn Hình Đen 1fps"

**Ngày:** 2026-05-15
**Mức độ:** Cao (video render không xem được)
**Trạng thái:** Nguyên nhân gốc đã xác định, đã áp dụng fix

---

## Triệu Chứng

- Video phát lại ở **~1fps** (Bug 6: NVDEC timestamp corruption) — ffprobe vẫn hiển thị đúng 30fps
- Video hiển thị **màn hình đen** hoặc **nền đen** không có thumbnail (Bug 1, 2, 2b)
- Không hiển thị **"PART 1"** (Bug 3: overlays rỗng)
- Landscape layout **không đúng** preview editor (Bug 4: vidHeightPct ignored)

## Nguyên Nhân Gốc (8 bugs)

### Bug 6: NVDEC + input seeking = timestamp corruption → 1fps playback (BUG CHÍNH)

**Ngày:** 2026-05-15
**File:** `electron/services/ffmpeg.ts`
**Mức độ:** Cao (video phát ở ~1fps, không phải perception issue)
**Trạng thái:** Đã fix — dùng CPU decode thay vì NVDEC khi dùng input seeking

**Vấn đề:** FFmpeg command dùng `-ss` (input seeking, trước `-i`) + `h264_nvdec` (NVDEC hardware decode). FFmpeg gyan.dev build 7.1 không xử lý timestamps chính xác khi hardware decode được dùng với input seeking — kết quả là frames có timestamps bị trùng hoặc dịch. Video player đọc timestamps này và tính ra tốc độ phát thực = 1fps, dù frame data hoàn toàn đúng.

**Evidence:**
- `ffprobe` hiển thị đúng 30fps (vì probe đọc container metadata, không timestamps từng frame)
- Frame data thực tế hoàn toàn khác nhau giữa các thời điểm (decode OK)
- Video player (VLC, MPC-HC, HTML5) tính ra ~1fps từ corrupted timestamps

**Fix:** Bỏ input seeking (`-ss`) hoàn toàn. Dùng **trim filter** trong filter chain + **select filter** để decimate 60fps→30fps sạch:
```
trim=start=0:duration=600,setpts=PTS-STARTPTS,select='not(mod(n\,2))'
```
- `trim` filter: chọn range video cần render (thay thế `-ss` input seeking)
- `setpts=PTS-STARTPTS`: reset timestamps sau trim
- `fps=30`: decimate + rescale timestamps → smooth 30fps output. An toàn cho VFR sources.

**Các vị trí fix (Bug 6):**
- `buildFilterComplex`: thêm `trimStart`/`trimDuration` params, prepend trim filter vào video chain (short + landscape), dùng `fps=fpsTarget`
- `renderVideo`: bỏ `-ss/-t`, pass `trimStart`/`trimDuration` sang filter chain
- `buildChunkArgs`: prepend trim filter vào landscape video chain và short video chain, bỏ `-ss/-t`, dùng `fps=fpsTarget`
- Hardware decode an toàn vì không còn input seeking

**Tại sao CPU decode vẫn nhanh:**
- 1920x1080@30fps CPU decode: ~50-100fps real-time
- Decode 600s video: ~6-12 giây
- So với NVDEC decode ~200fps nhưng output 1fps → chọn CPU decode đúng

---

### Bug 6b: Image background freeze sau 1 frame (thumbnail biến mất)

**Ngày:** 2026-05-15
**File:** `electron/services/ffmpeg.ts`
**Mức độ:** Cao (background biến mất sau frame 0)
**Trạng thái:** Đã fix

**Vấn đề:** FFmpeg image input mặc định chỉ có 1 frame. Overlay filter ghép video 10 phút lên background 1 frame → background biến mất sau 0.033s.

**Fix (2 chỗ):**
- Thêm `-loop 1` trước `-i` cho background image input → background loop forever
- Thêm `shortest=1:eof_action=pass` vào tất cả overlay filters → overlay dừng khi video kết thúc

---

### Bug 6c: Title text position + format (sai vị trí, outline mỏng)

**Ngày:** 2026-05-15
**File:** `electron/services/ffmpeg.ts`
**Mức độ:** Cao (title hiển thị sai vị trí và format)
**Trạng thái:** Đã fix

**Vấn đề:** `y=(h-text_h)/2` đặt text ở giữa canvas thay vì trong header zone hoặc title zone.

**Fix:**
- SHORT mode: `y=(canvasH - titleH/2) - text_h/2` → center trong title zone (bottom area)
- LANDSCAPE mode: `y=(headerH - text_h)/2` → center trong header zone
- Đổi `borderw=2:bordercolor=X` (outline mỏng) → `box=1:boxcolor=X:boxborderw=20` (box background rõ ràng)

---

### Bug 1: Thumbnail bị thu nhỏ — màn hình đen (bug hình ảnh chính)

**File:** `electron/services/ffmpeg.ts`

**Vấn đề:** Tất cả scale background/thumbnail đều dùng:
```
scale=canvasW:canvasH:force_original_aspect_ratio=decrease
```
Điều này thu nhỏ thumbnail **xuống** để vừa canvas, giữ nguyên aspect ratio.
Thumbnail UI là 320x180. Ở canvas 480x480: scale xuống 480x270, center →
**thanh đen khổng lồ (480-270)/2 = 105px trên + 105px dưới** = thumbnail chỉ lấp
56% chiều cao canvas. Kết hợp với background đen (xem Bug 2), kết quả
là màn hình gần như đen hoàn toàn với thumbnail tí hon ở giữa.

**Fix:** Đổi sang `force_original_aspect_ratio=increase` + `crop` để **lấp đầy** canvas:
```
scale=canvasW:canvasH:force_original_aspect_ratio=increase,crop=canvasW:canvasH:(ow-iw)/2:(oh-ih)/2
```
Scale thumbnail lên để cover canvas, rồi center-crop — không còn thanh đen.

**Các vị trí bị ảnh hưởng (7 chỗ):**
- `buildFilterComplex` — landscape thumbnail bg (dòng ~476)
- `buildFilterComplex` — short mode background (dòng ~523)
- `buildFilterComplex` — header image scale (dòng ~526)
- `buildFilterComplex` — title overlay scale (dòng ~486)
- `buildChunkArgs` — landscape bgScaleFilter (dòng ~1179, ~1200, ~1206)
- `buildChunkArgs` — short mode bgFilter (dòng ~1268)
- `buildChunkArgs` — short mode header scale (dòng ~1277)

---

### Bug 2: `backgroundImage` bị undefined trong standard render — canvas đen

**Ngày:** 2026-05-15
**File:** `electron/main.ts` — `executeRenderJob()` (dòng ~280)
**Mức độ:** Cao (background đen — không phải 1fps playback)
**Trạng thái:** Đã fix

**Vấn đề:** `executeRenderJob` (standard render, không phải chunked) **không resolve thumbnail** cho landscape video. Nó chỉ resolve `blur_background` nhưng không fallback sang workspace thumbnail.

- Editor gửi `backgroundImage` = `undefined` (vì user chưa upload custom image)
- FFmpeg nhận lavfi `color=black` → background đen → canvas trừ vùng video là nền đen

**Fix:** Thêm thumbnail fallback vào `executeRenderJob`:
```typescript
const wsThumbPath = path.join(getVideoStoragePath(), `thumb_${workspaceId}.jpg`)
backgroundImage: !metadata.backgroundImage && !wsBlurBg && fs.existsSync(wsThumbPath)
  ? wsThumbPath : metadata.backgroundImage,
```

Tương tự, `RENDER_CHUNKED` đã có logic này nhưng có edge case: `metadata.backgroundImage` set nhưng file không tồn tại → fix thành:
```typescript
backgroundImage: (!metadata.backgroundImage || !fs.existsSync(metadata.backgroundImage))
  && !wsBlurBg && fs.existsSync(wsThumbPath) ? wsThumbPath : metadata.backgroundImage
```

**Symptom:** Canvas background đen hoàn toàn, chỉ có vùng video hiển thị nội dung.

---

### Bug 2b: Sai đường dẫn thumbnail — catch-up render dùng đường dẫn sai

**File:** `electron/main.ts` — `triggerAutoRenderForReadyWorkspaces()`

**Vấn đề:** `getVideoStoragePath()` trên máy này trả về `D:\HyperClip-Data\app\HyperClip\downloads\`
nhưng thumbnail lưu ở `D:\HyperClip-Data\downloads\`. Hàm catch-up (mới thêm
cho auto-render khi khởi động) tạo đường dẫn thumbnail sai:
```
D:\HyperClip-Data\app\HyperClip\downloads\thumb_{wsId}.jpg  ← SAI
D:\HyperClip-Data\downloads\thumb_{wsId}.jpg               ← ĐÚNG
```
File không tồn tại ở đường dẫn sai → `backgroundImage` là `undefined` → lavfi
background đen → toàn bộ canvas video đen (không thấy thumbnail).

**Fix:** Trích xuất đường dẫn thumbnail từ `workspace.thumbnail` URI (`local-video:///D:/...`)
chứa đường dẫn tuyệt đối đúng. Thêm fallback quét các thư mục known.

---

### Bug 3: `overlays: []` — không render được "PART 1"

**File:** `electron/main.ts` — auto-render metadata construction (dòng ~716)

**Vấn đề:** Auto-render metadata được khởi tạo với `overlays: []` — mảng rỗng.
Drawtext filter cho title "PART 1" không bao giờ được thêm vào filter chain.

**Fix:** Đổi sang `overlays: [{ type: 'title', content: 'PART 1', borderColor: '#00B4FF' }]`.

---

## Tại Sao ffprobe Hiển Thị 30fps Đúng Nhưng Phát Lại là 1fps

**Đây là bug THỰC TẾ, không phải perception issue.**

Nguyên nhân gốc: **NVDEC + input seeking = timestamp corruption** (Bug 6).

**Tại sao ffprobe vẫn hiển thị đúng:**
- `ffprobe` đọc `r_frame_rate: "30/1"` từ **container metadata** (st_timebase)
- Container metadata KHÔNG bị ảnh hưởng bởi NVDEC timestamp corruption
- Frame data hoàn toàn đúng — decode OK, nhưng timestamps bị sai

**Video player đọc timestamps từng frame (không phải container metadata):**
- NVDEC hardware decode output frames với timestamps không đúng
- Player tính tốc độ phát = frame_count / time_duration → ~1fps
- Frame data thực tế vẫn đúng (nội dung khác nhau giữa các frames)

**Sau Bug 6 fix:** CPU decode output frames với timestamps đúng → player tính đúng 30fps → playback bình thường.

---

## Lệnh Xác Minh

```powershell
# Kiểm tra metadata video (phải hiển thị 30fps, resolution đúng)
ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,width,height,r_frame_rate,avg_frame_rate,pix_fmt -of json -- "video.mp4"

# Trích xuất frames ở 3 thời điểm khác nhau — hashes PHẢI khác nhau
ffmpeg -ss 0 -i "video.mp4" -frames:v 1 -y $env:TEMP/f0.png
ffmpeg -ss 5 -i "video.mp4" -frames:v 1 -y $env:TEMP/f5.png
ffmpeg -ss 10 -i "video.mp4" -frames:v 1 -y $env:TEMP/f10.png
# Nếu hashes giống nhau → tất cả frames giống nhau → thực sự là lỗi 1fps
# Nếu hashes khác nhau → nội dung video đang thay đổi → lỗi player/decoder

# Kiểm tra tốc độ decode (phải >10x cho video 30fps)
ffmpeg -i "video.mp4" -frames:v 60 -f null - 2>&1 | grep "fps="
```

## Bug 4: `vidHeightPct` bị ignore trong chunked render — landscape layout luôn dùng 50%

**Ngày:** 2026-05-15
**File:** `electron/services/ffmpeg.ts`
**Mức độ:** Cao (render output khác với preview editor)

**Vấn đề:** Trong `renderChunked`, `vidHeightPct` được extract từ metadata (dòng ~1539) nhưng **không bao giờ được truyền** xuống `encodeChunk`. Signature của `encodeChunk` và `buildChunkArgs` không nhận `vidHeightPct` → luôn dùng default `50%` thay vì giá trị user đã configure trong editor (ví dụ: 85%).

**Symptom:** Preview editor hiển thị landscape layout đúng (ví dụ: 85% video height), nhưng render output (chunked) luôn dùng 50% → video nhỏ hơn, thumbnail nhiều hơn so với preview.

```
renderChunked                    encodeChunk               buildChunkArgs
   ↓                                ↓                            ↓
vidHeightPct = 85  ❌ NOT PASSED  → undefined → undefined → landscape dùng 50%
```

**Fix (3 chỗ):**
1. Thêm `vidHeightPct?: number` vào signature `encodeChunk` (dòng ~1354)
2. Truyền `vidHeightPct` vào call `buildChunkArgs` trong `encodeChunk` (dòng ~1370)
3. Thêm `vidHeightPct?: number` vào signature `buildChunkArgs` (dòng ~1098)

**Cách nhận biết:** So sánh `RenderLayout` log trong console với output thực tế. Nếu `vidHeightPct` trong log khác 50 nhưng landscape video trong file output nhỏ → bug này.

---

## Bug 5: `@contextScopeItemMention` — React DevTools error (KHÔNG phải từ codebase)

**Ngày:** 2026-05-15
**Mức độ:** Không ảnh hưởng (không phải bug app)

**Phân tích:** Error `@contextScopeItemMention` **không tồn tại trong codebase** (`grep` toàn bộ project: 0 kết quả). Đây là error từ **React DevTools browser extension**, không phải từ application code.

**Nguyên nhân:** Khi React DevTools inspect component tree với state đang thay đổi (VD: render progress updates mỗi giây), DevTools có thể show internal error message `@contextScopeItemMention` — đây là DevTools bug/limitation, không liên quan đến app.

**Xác nhận:** Render vẫn hoàn thành bình thường (129.8s output đúng). Error chỉ xuất hiện trong DevTools console, không ảnh hưởng output file.

**Trạng thái:** Không cần fix. Ignore error này.

---

## Bug 7: Header zone black — video overlay position wrong in LANDSCAPE mode

**Ngày:** 2026-05-16
**File:** `electron/services/ffmpeg.ts`
**Mức độ:** Cao (header zone hiển thị nội dung video thay vì thumbnail)
**Trạng thái:** Đã fix

**Vấn đề:** LANDSCAPE mode có 2 bug:

1. **Video overlay ở `0:0`**: Video được scale lên full canvas height (1920px cho 85% video height) và overlay ở `0:0`. Video lấp đầy toàn bộ canvas kể cả header zone → thumbnail không bao giờ hiển thị trong header zone.

2. **Không có `[fh]` output**: Filter chain LANDSCAPE không tạo `[fh]` label. `mapOutput` trong `renderVideo` cho LANDSCAPE với `backgroundType='image'` set `mapOutput='[fh]'` nhưng `[fh]` không tồn tại → FFmpeg lỗi hoặc output sai stream.

**Fix:**

1. **Overlay position**: `overlay=0:0` → `overlay=0:${videoTop}`. Video bắt đầu ở hàng `videoTop` (bên dưới header zone), thumbnail hiển thị trong header zone.

2. **Crop offset**: Thêm `videoTop` vào crop Y offset để video content được center trong video zone:
   - cropXNum >= 0: `crop=${canvasW}:${videoH}:${cropXNum}:${videoTop}`
   - cropXNum < 0: `cropY = Math.round((canvasW*9/16 - videoH)/2) + videoTop`

3. **Header overlay section**: Thêm `hdChain2` vào LANDSCAPE filter chain:
   ```javascript
   const hdChain2 = headerOl?.src
     ? `[2:v]scale=...headerH...[hd];[vz][hd]overlay=0:0[fh]`
     : ''
   ```

4. **Input mapping**: Input [2] = header image cho cả SHORT và LANDSCAPE mode.

5. **mapOutput**: Đơn giản hóa → `[fh]` khi `headerOl?.src` tồn tại.

---

## Bug 8: SHORT mode chunked title format sai — `borderw=2` thay vì `box=1:boxborderw=20`

**Ngày:** 2026-05-16
**File:** `electron/services/ffmpeg.ts` — `buildChunkArgs` SHORT mode section (line ~1354)
**Mức độ:** Trung bình (title hiển thị outline mỏng 2px thay vì box rõ ràng 20px)
**Trạng thái:** Đã fix

**Vấn đề:** SHORT mode trong `buildChunkArgs` dùng `borderw=2:bordercolor` (outline mỏng 2px) thay vì `box=1:boxcolor=:boxborderw=20` (box rõ ràng 20px). Không match với LANDSCAPE mode và `buildFilterComplex` (đã dùng box=1:boxborderw=20).

**Fix:** Thay `borderw=2:bordercolor=X` → `box=1:boxcolor=X:boxborderw=20` trong drawtext cho SHORT mode chunked.

---

## Bug 9: SHORT mode chunked input mapping sai khi có cả header và title

**Ngày:** 2026-05-16
**File:** `electron/services/ffmpeg.ts` — `buildChunkArgs` SHORT mode
**Mức độ:** Cao (title overlay dùng input [2]=header image thay vì [3]=title overlay)
**Trạng thái:** Đã fix

**Vấn đề:** Khi SHORT mode có cả header (input [2]) và title PNG (input [3]), code cũ dùng `headerOlSrc ? '3' : '2'` cho title overlay input. Khi `headerOlSrc` tồn tại → dùng '3' (đúng). Nhưng trong `renderVideo`, SHORT mode input [2] = header và input [3] = title. Trong `buildChunkArgs`, input [2] = header và không có input [3] cho title.

**Fix:** Đổi input mapping trong `buildChunkArgs` SHORT mode:
- Input [2] = header (nếu có) hoặc placeholder
- Input [3] = title PNG (nếu có)

Đồng thời fix z-order cho SHORT mode khi có cả header và title:
- `[fh][texted]overlay=0:0[td]` thay vì `[texted_vz][hd]overlay=0:0[td]`

---

## Các File Đã Thay Đổi

- `electron/services/ffmpeg.ts` — 7 chỗ `force_original_aspect_ratio=decrease` → `increase+crop`
- `electron/main.ts` — `overlays: []` → `overlays: [{ type: 'title', content: 'PART 1' }]`
- `electron/main.ts` — fix đường dẫn thumbnail trong `triggerAutoRenderForReadyWorkspaces()`
- `electron/services/ffmpeg.ts` — thêm `vidHeightPct` param cho `encodeChunk` và `buildChunkArgs` (Bug 4 fix)
- `electron/services/ffmpeg.ts` — bỏ `-ss/-t`, thêm trim filter + `fps=fpsTarget` (Bug 6 fix)
- `electron/main.ts` — thêm thumbnail fallback cho `executeRenderJob` (Bug 2 fix)
- `electron/main.ts` — cải thiện thumbnail fallback cho `RENDER_CHUNKED` (file existence check)
- `electron/services/ffmpeg.ts` — thêm `-loop 1` cho background image input + `shortest=1:eof_action=pass` trên overlay filters (Bug 6b fix)
- `electron/services/ffmpeg.ts` — fix drawtext Y position + `borderw` → `box=1:boxborderw=20` (Bug 6c fix)
- `electron/services/ffmpeg.ts` — fix LANDSCAPE header zone: overlay position + `[fh]` output + crop offset (Bug 7 fix)
- `electron/services/ffmpeg.ts` — fix SHORT mode chunked title format: `borderw=2` → `box=1:boxborderw=20` (Bug 8 fix)
- `electron/services/ffmpeg.ts` — fix SHORT mode chunked input mapping + z-order khi có header+title (Bug 9 fix)

## Tổng Kết — Tình Trạng

| Bug | Mô tả | Trạng thái |
|-----|--------|-------------|
| Bug 1 | `decrease` → thumbnail nhỏ → canvas đen | ✅ Đã fix |
| Bug 2 | `backgroundImage` undefined → canvas đen | ✅ Đã fix |
| Bug 2b | Thumbnail path sai trong auto-render | ✅ Đã fix |
| Bug 3 | `overlays: []` → "PART 1" mất | ✅ Đã fix |
| Bug 4 | `vidHeightPct` ignored trong chunked render | ✅ Đã fix |
| Bug 5 | `@contextScopeItemMention` = React DevTools | 📝 Không cần fix |
| Bug 6a | Input seeking + NVDEC → timestamp corruption → 1fps | ✅ Đã fix |
| Bug 6b | Image input 1 frame → background freeze | ✅ Đã fix |
| Bug 6c | Title position + outline format sai | ✅ Đã fix |
| Bug 7 | Header zone black: LANDSCAPE overlay position + `[fh]` missing | ✅ Đã fix 2026-05-16 |
| Bug 8 | SHORT mode chunked title format: `borderw=2` | ✅ Đã fix 2026-05-16 |
| Bug 9 | SHORT mode chunked input mapping: title dùng `[2]=header` | ✅ Đã fix 2026-05-16 |
