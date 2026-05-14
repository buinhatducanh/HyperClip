# HyperClip — Cơ Chế Hoạt Động
## Tài liệu dành cho Product Owner

> **Mục tiêu:** Giải thích cách HyperClip hoạt động bằng ngôn ngữ dễ hiểu, không cần kiến thức kỹ thuật.
> **Audience:** Product Owner, stakeholder, người không có nền tảng lập trình.
> **Source of truth kỹ thuật:** `HYPERCLIP_RULES.md`

---

## 1. Tổng Quan Sản Phẩm

### HyperClip là gì?

HyperClip là một ứng dụng **tự động bắt video YouTube mới** và **render thành video dọc (9:16)** cho TikTok, Reels, YouTube Shorts — trong vòng **dưới 20 giây** từ lúc video được đăng tải.

### User persona

**Minh** — một creator chạy một kênh YouTube về review công nghệ. Minh muốn:

- **Không bỏ lỡ bất kỳ video mới** nào từ 50 kênh mà Minh theo dõi
- Video tải về tự động, chỉnh sửa nhanh, render ra vertical video
- App chạy 24/7 mà không cần can thiệp

### Kết quả mong đợi

| Thời gian | Điều gì xảy ra |
|-----------|----------------|
| +0s | YouTuber đăng video mới |
| +5s | HyperClip phát hiện video |
| +15s | Video tải về hoàn chỉnh |
| +17s | Workspace hiển thị trên dashboard |
| +2 phút | Video render xong, sẵn sàng đăng TikTok |

---

## 2. Kiến Trúc Hệ Thống — Tổng Quan

HyperClip hoạt động như một **"chó săn"** liên tục dò video mới và một **"nhà máy"** tự động xử lý video.

```
┌─────────────────────────────────────────────────────────────┐
│  CHÓ SĂN (Detection Engine)                                │
│  ────────────────────────────────────────────────────────  │
│  Duy trì 30 "mắt" Chrome → quét YouTube mỗi 5 giây      │
│  Không tốn quota → hoàn toàn miễn phí                     │
│  Phát hiện video mới trong < 5 giây                        │
└──────────────────────────┬──────────────────────────────────┘
                           │ Video mới được phát hiện
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  BĂNG TẢI TỰ ĐỘNG (Auto-Download Pipeline)                │
│  ────────────────────────────────────────────────────────  │
│  yt-dlp tải video → chỉ phần cần thiết (trim N phút)       │
│  Tốc độ: 720p trong 10-15 giây                            │
│  Đa số video chỉ cần tải 10 phút đầu                       │
└──────────────────────────┬──────────────────────────────────┘
                           │ Video đã tải
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  NHÀ MÁY RENDER (GPU Pipeline)                             │
│  ────────────────────────────────────────────────────────  │
│  FFmpeg + NVIDIA NVENC → chuyển 16:9 → 9:16                │
│  Blur background tĩnh (gen 1 lần, cache mãi mãi)          │
│  RTX 5080 encode ~2 phút cho video 10 phút                 │
└──────────────────────────┬──────────────────────────────────┘
                           │ Video đã render
                           ▼
                    📁 archived/ (thư mục đầu ra)
```

---

## 3. Chi Tiết Từng Tầng

### Tầng 1: Detection — "Chó săn" dò video mới

#### Nguyên tắc cốt lõi

**Mỗi 5 giây, HyperClip quét TẤT CẢ kênh** để tìm video mới.

Không giống công cụ tìm kiếm thông thường (YouTube Data API có giới hạn 10.000 request/ngày), HyperClip dùng **Innertube API** — API nội bộ của YouTube mà trình duyệt Chrome sử dụng. API này **không có giới hạn quota**.

#### Cơ chế "30 mắt Chrome"

Để truy cập Innertube API, mỗi "mắt" cần đăng nhập YouTube. HyperClip sử dụng **30 Chrome profiles** — giống như 30 người dùng Chrome thường, mỗi người đã đăng nhập tài khoản Google riêng.

```
30 Chrome Profiles = 30 "Người dùng" đang theo dõi YouTube
       │
       ├── Profile 1: user1@gmail.com ✅
       ├── Profile 2: user2@gmail.com ✅
       ├── Profile 3: user3@gmail.com ⚠️ (hết phiên)
       └── ...
       └── Profile 30: user30@gmail.com ✅

Round-robin: HyperClip luân phiên dùng các profile
```

**Tại sao 30 profiles?**
- YouTube giới hạn số request trên mỗi tài khoản
- 30 profiles = 30 tài khoản = đủ "sức mạnh" để quét 100 kênh mà không bị chặn
- Nếu 1 profile lỗi → tự động chuyển sang profile khác trong 10 giây

#### Filter — Ai được bắt, ai bị bỏ qua?

Khi phát hiện video mới, HyperClip kiểm tra **4 điều kiện**:

| Filter | Quy tắc | Lý do |
|--------|---------|-------|
| **Độ tuổi** | < 10 phút | Chỉ tải video mới nhất |
| **Thời lượng** | > 60 giây | Loại bỏ YouTube Shorts |
| **Tỷ lệ khung hình** | Không phải 9:16 | Loại bỏ video dọc |
| **Trùng lặp** | Chưa từng thấy | Không tải lại video cũ |

**Ví dụ thực tế:**
- Video MrBeast đăng lúc 10:00:00
- 10:00:05 → HyperClip quét thấy video mới ✓ → Tải
- 10:01:30 → HyperClip quét lại → video đã nằm trong bộ nhớ → Bỏ qua
- Một video Short 45 giây → Không tải (bị filter loại)

#### Chuỗi dự phòng (Fallback Chain)

Nếu "30 mắt Chrome" đều bị lỗi, HyperClip có **3 lớp dự phòng**:

```
Lớp 1 — Innertube (30 Chrome sessions)     ← Dùng chính (0 quota)
       ↓ Nếu tất cả 30 sessions lỗi
Lớp 2 — OAuth (200 Google Cloud Projects) ← Dự phòng tầng 2 (~3% quota/ngày)
       ↓ Nếu OAuth cũng hết quota
Lớp 3 — RSS Feed                          ← Dự phòng cuối cùng (~2 phút delay)
```

**Lớp 1 — Innertube (chính):**
- 30 Chrome profiles, mỗi profile = 1 "đại diện" đã đăng nhập YouTube
- Không tốn quota → quét thoải mái
- Thời gian phản hồi: ~200ms

**Lớp 2 — OAuth (dự phòng):**
- 200 Google Cloud projects, mỗi project có 10.000 quota units/ngày
- Tổng cộng: **2 triệu units/ngày** — gần như vô hạn
- Chỉ dùng khi Innertube die hoàn toàn
- Chi phí thực tế: ~3.5% quota/ngày (vì Innertube xử lý 99%)

**Lớp 3 — RSS Feed:**
- Feed XML thuần túy, không cần đăng nhập
- Không tốn quota nhưng có độ trễ ~2 phút
- Chỉ dùng khi cả Innertube + OAuth đều chết

---

### Tầng 2: Download — "Băng tải" tải video

#### Nguyên tắc: Tải ít nhất có thể

**Không tải toàn bộ video.** HyperClip chỉ tải **N phút đầu** (mặc định: 10 phút), dựa trên giả định rằng nội dung quan trọng nhất nằm ở đầu video.

```
Toàn bộ video: 45 phút
Tải về:       10 phút đầu (chỉ 22% dung lượng)

Kỹ thuật: yt-dlp --download-sections *00:00:00-00:10:00
```

#### Tốc độ tải

| Chất lượng | Dung lượng (10 phút) | Thời gian tải | Tốc độ |
|------------|----------------------|--------------|---------|
| 360p | ~150 MB | ~8s | 18 MB/s |
| 720p | ~400 MB | ~20s | 20 MB/s |
| 1080p | ~800 MB | ~40s | 20 MB/s |

**Mặc định khuyến nghị: 720p** — balance tốt giữa tốc độ và chất lượng.

#### Đa luồng tải

HyperClip có thể tải video thành nhiều "mảnh" song song:

```
Mảnh 1: 00:00 – 02:30  ┐
Mảnh 2: 02:30 – 05:00  ├─ yt-dlp tải song song
Mảnh 3: 05:00 – 07:30  │
Mảnh 4: 07:30 – 10:00  ┘
```

→ **Gấp đôi tốc độ** nếu server YouTube cho phép. HyperClip tự động quyết định có dùng tính năng này không.

#### Chuỗi sự kiện sau khi tải xong

```
Video tải về
    │
    ├─ ffprobe kiểm tra thực tế:
    │    ├── Duration thực < 60s? → Đánh dấu Short, không xử lý
    │    ├── Aspect ratio = 9:16? → Bỏ qua (đã là video dọc)
    │    └── OK → Tiếp tục
    │
    ├─ Tạo thumbnail (1 frame)
    │
    ├─ Tạo blur background (1 frame → gaussian blur → cache)
    │
    └─ Workspace xuất hiện trên dashboard với trạng thái "ready"
```

---

### Tầng 3: Edit — Canvas chỉnh sửa

Sau khi video tải xong, người dùng mở workspace trên dashboard để chỉnh sửa.

#### Editor gì?

```
┌─────────────────────────────────────────┐
│  React-Konva Canvas (60fps)            │
│  - Preview video real-time              │
│  - Vẽ overlay (text, hình ảnh)         │
│  - Thay đổi tốc độ phát               │
│  - Chọn trim (đoạn cắt)                │
│  - Chọn background (blur/solid/image) │
└─────────────────────────────────────────┘
```

**Không render preview.** Canvas chỉ hiển thị trước — việc xử lý thực sự xảy ra ở tầng render.

#### Các tùy chọn chỉnh sửa

| Tùy chọn | Giá trị | Ý nghĩa |
|-----------|---------|---------|
| **Trim start** | 0 – N phút | Bắt đầu video từ đâu |
| **Trim end** | 0 – N phút | Kết thúc video ở đâu |
| **Speed** | 1.0x – 2.0x | Tăng tốc phát (loại bỏ khoảng lặng) |
| **Background** | Blur / Solid / Image | Nền video dọc |
| **Overlay** | Text / Image | Lớp phủ lên video |
| **Quality** | 720p / 1080p | Độ phân giải đầu ra |

---

### Tầng 4: Render — "Nhà máy" xuất video

#### GPU Rendering — Tại sao nhanh?

Render là quá trình chuyển video 16:9 gốc thành video 9:16. Thay vì dùng **CPU (não)**, HyperClip dùng **GPU (bộ xử lý đồ họa)** — chip chuyên xử lý hình ảnh, nhanh gấp 10-20 lần CPU.

```
CPU Render (x264):     Video 10 phút → 15-20 phút render
GPU Render (NVENC):    Video 10 phút → 2-3 phút render
```

**NVIDIA NVENC** là bộ mã hóa phần cứng trên card đồ họa NVIDIA. RTX 5080 có 16GB VRAM → encode nhanh, không nóng máy.

#### Quy trình render

```
1. Nguồn vào: Video MP4 16:9 (720p-1080p)
       │
2. Tách frame đầu → Gaussian Blur → background 9:16
   (Gen 1 lần → cache mãi mãi → 0 cost cho lần sau)
       │
3. Canvas ghép: Video 16:9 thu nhỏ + đặt vào giữa blur background 9:16
       │
4. FFmpeg NVENC encode → Video MP4 9:16
       │
5. Lưu vào thư mục archived/YYYY-MM/
```

#### Chunked Rendering — Chia nhỏ để tăng tốc

Với video dài (> 5 phút), HyperClip chia render thành **nhiều "mảnh" song song**:

```
RTX 5080 (8 workers):

Mảnh 1: 00:00 – 02:00  ← Worker 1 ─┐
Mảnh 2: 02:00 – 04:00  ← Worker 2 ─┤
Mảnh 3: 04:00 – 06:00  ← Worker 3 ─┼─ FFmpeg NVENC song song
Mảnh 4: 06:00 – 08:00  ← Worker 4 ─┤
...                        ...       │
Mảnh N: 08:00 – 10:00  ← Worker 8 ─┘

→ Tất cả worker encode CÙNG LÚC
→ Thời gian = 10 phút / 8 workers ≈ 1.25 phút
```

**Hardware tối thiểu:**
- RTX 4060 (8GB VRAM): 4 workers
- RTX 5080 (16GB VRAM): 8 workers

---

## 4. Cơ Chế Dự Phòng & Tự Khắc Phục

### Khi Chrome session chết

```
Session 15 lỗi (PSID hết hạn)
    │
    ↓ HyperClip tự động
Chuyển sang Session 16 (trong 10 giây)
    │
    ↓ Nếu tất cả 30 sessions die
Kích hoạt OAuth (Lớp 2 dự phòng)
    │
    ↓ Nếu OAuth hết quota (hiếm khi xảy ra)
Kích hoạt RSS Feed (Lớp 3 dự phòng)
```

### Khi video không tải được

```
Video bị private sau khi phát hiện
    │
    ↓
Workspace đánh dấu "error"
    │
    ↓ Người dùng click "Retry"
Workspace quay lại trạng thái "waiting"
    │
    ↓ HyperClip thử lại
Video vẫn private → Workspace xóa sau 24h
```

### Khi GPU quá nóng / crash

```
FFmpeg crash
    │
    ↓
Workspace đánh dấu "error"
    │
    ↓ User click "Retry"
Render lại từ đầu
    │
    ↓ GPU temp > 90°C
HyperClip tạm dừng render → gửi cảnh báo → tự động resume khi nguội
```

### Khi mất internet

```
Network disconnect
    │
    ↓
Download tạm dừng
    │
    ↓ Internet khôi phục
HyperClip tự động resume download
    │
    ↓ Poller vẫn chạy (không ảnh hưởng detection)
Video được phát hiện sau network restore
```

---

## 5. Hệ Thống Giám Sát — Health Alerts

HyperClip tự giám sát **5 tình trạng nguy hiểm** và gửi thông báo cho người dùng:

| Tình trạng | Mức độ | Hành vi |
|-----------|---------|---------|
| Innertube chết hết (0/30 sessions) | 🔴 Nguy hiểm | "Tất cả Chrome sessions thất bại" |
| OAuth quota < 10% | 🟡 Cảnh báo | "OAuth quota sắp hết" |
| OAuth quota hết | 🔴 Nguy hiểm | "OAuth quota đã hết" |
| Ổ đĩa < 5GB trống | 🔴 Nguy hiểm | "Dung lượng thấp" |
| Không phát hiện video 24h | 🟡 Cảnh báo | "Không có video mới 24 giờ" |

Kiểm tra: **mỗi 60 giây**. Thông báo có cooldown 5 phút (không spam).

---

## 6. Số Liệu Hiệu Suất

| Metric | Giá trị | Ghi chú |
|--------|---------|---------|
| Detection latency | < 5 giây | Từ lúc upload đến khi phát hiện |
| Download (720p, 10 phút) | ~15 giây | với mạng 50 Mbps |
| Render (1080p, 10 phút) | ~2 phút | RTX 5080, 8 workers |
| Total pipeline | < 3 phút | Detection → Download → Render |
| RAM khi idle | ~800 MB | Không render |
| RAM khi render | ~2 GB mỗi worker | 8 workers = 16 GB |
| GPU VRAM khi render | ~1.5 GB mỗi worker | 8 workers = 12 GB |
| Disk I/O (RAM disk) | ~10 GB/s | Nếu dùng RAM disk |

---

## 7. Quyết Định Thiết Kế Quan Trọng

### Tại sao Innertube là detection chính?

| Phương án | Quota tiêu tốn | Tốc độ | Độ tin cậy |
|-----------|----------------|--------|------------|
| YouTube Data API (OAuth) | 10k units/ngày | ~500ms | Cao |
| **Innertube (Chrome cookies)** | **0** | **~200ms** | Cao |
| RSS Feed | 0 | ~2 phút delay | Thấp |

**Innertube thắng tuyệt đối** — nhanh gấp đôi, không tốn quota. OAuth chỉ là lớp dự phòng.

### Tại sao chỉ tải N phút đầu?

1. **Tốc độ:** Tải 10 phút nhanh hơn tải full 45 phút (4x nhanh)
2. **Dung lượng:** 10 phút 720p ≈ 400 MB thay vì 1.8 GB
3. **Use case:** Content creator thường chỉ cần đoạn đầu để tạo highlight/review

### Tại sao GPU render mà không CPU?

| Phương pháp | Thời gian render 10 phút | CPU/GPU usage |
|-------------|-------------------------|--------------|
| CPU (x264) | 15-20 phút | 100% CPU |
| **GPU (NVENC)** | **2-3 phút** | **20% GPU** |

GPU render nhanh hơn 7x và cooler.

### Tại sao 200 GCP projects?

```
100 kênh × 5 giây/poll × 17,280 polls/ngày = 8.6 triệu API calls/ngày
```

Mỗi Google Cloud project có **10,000 quota units/ngày**.
200 projects = **2 triệu units/ngày** — đủ cho Innertube die hoàn toàn trong ~1 ngày.

---

## 8. So Sánh Với Giải Pháp Khác

| Tính năng | HyperClip | Zapier / Make | IFTTT | Manual |
|-----------|-----------|--------------|-------|--------|
| Detection latency | **< 5 giây** | 15-60 phút | 15-60 phút | N/A |
| Tự động tải | ✅ | ❌ | ❌ | ❌ |
| Tự động render 9:16 | ✅ | ❌ | ❌ | ❌ |
| Không tốn quota | ✅ (Innertube) | ❌ | ❌ | N/A |
| RAM disk | ✅ | ❌ | ❌ | N/A |
| 24/7 không gián đoạn | ✅ | ✅ | ✅ | ❌ |
| Chi phí vận hành | Thấp | Cao | Cao | N/A |

---

## 9. Rủi Ro & Mitigation

| Rủi ro | Xác suất | Impact | Mitigation |
|--------|---------|--------|-----------|
| YouTube đổi Innertube API | Thấp | Cao | OAuth là backup hoàn chỉnh |
| Chrome cookies hết hạn | Trung bình | Trung bình | SOCS auto-inject; 30 sessions giảm thiểu |
| OAuth quota exhaustion | Rất thấp | Cao | 200 projects = 2 triệu units/ngày |
| GPU crash trong render | Thấp | Trung bình | Crash recovery; tự retry |
| Ổ đĩa đầy | Trung bình | Trung bình | Cảnh báo khi < 5GB; auto-cleanup |

---

## 10. Roadmap Tiềm Năng (PO POV)

### Ngắn hạn (1-3 tháng)

- **[ ] Multi-language support** — Thêm tiếng Anh, tiếng Trung
- **[ ] Team collaboration** — Chia sẻ workspaces giữa các user
- **[ ] Cloud storage** — Upload thẳng lên Google Drive, Dropbox
- **[ ] Scheduled posting** — Hẹn giờ đăng video

### Trung hạn (3-6 tháng)

- **[ ] Batch render** — Render 10 video cùng lúc (multi-GPU)
- **[ ] AI captioning** — Tự động tạo phụ đề bằng AI
- **[ ] Music library** — Thêm nhạc nền từ thư viện
- **[ ] Analytics** — Dashboard theo dõi hiệu suất kênh

### Dài hạn (6-12 tháng)

- **[ ] Multi-platform** — Twitter/X, Instagram, TikTok direct posting
- **[ ] Mobile companion** — App điều khiển từ điện thoại
- **[ ] AI clipping** — Tự động chọn khoảnh khắc hay nhất
- **[ ] White-label** — Bán cho creator khác như SaaS

---

*Document v1.0 — 2026-05-14*
