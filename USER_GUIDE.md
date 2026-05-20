# HyperClip — Hướng Dẫn Sử Dụng

> Đọc kỹ toàn bộ trước khi chạy hệ thống 24/7.

---

## 1. Yêu cầu hệ thống

### Phần mềm bắt buộc

| Công cụ | Mục đích | Cách kiểm tra |
|---------|----------|---------------|
| **Python 3.8+** | Chạy polling script + cookie extraction | `python --version` |
| **`requests` library** | HTTP requests với Keep-Alive | `python -c "import requests; print(requests.__version__)"` |
| **`yt-dlp`** | Download YouTube video | `yt-dlp --version` |
| **FFmpeg** (có trong PATH) | Video processing + NVENC | `ffmpeg -version` |
| **Chrome hoặc Edge** | Đã login YouTube (free hoặc Premium) | Mở youtube.com, đăng nhập |

### Cài đặt Python dependencies

```bash
pip install requests win32crypt  # win32crypt cho DPAPI cookie decryption
```

---

## 2. Thiết lập Cookie (QUAN TRỌNG NHẤT)

Cookie là **duy nhất** thứ cho phép hệ thống poll YouTube mà không bị block. Không có cookie = không có auto-ingestion.

### Bước 1: Thiết lập tài khoản YouTube

**KHÔNG cần YouTube Premium** — chỉ cần tài khoản YouTube thường (miễn phí).

1. **Tạo 1 tài khoản YouTube mới** (hoặc dùng tài khoản hiện có)
2. **Subscribe đủ 100 kênh** cần theo dõi vào tài khoản này
3. **KHÔNG đăng xuất** — cookie sẽ hết hiệu lực nếu đăng xuất

### Bước 2: Đảm bảo Chrome/Edge đã login tài khoản đó

1. Mở **Chrome** hoặc **Edge**
2. Vào youtube.com → đăng nhập tài khoản đã subscribe đủ 100 kênh
3. Kiểm tra: vào **youtube.com/feed/subscriptions** → thấy video mới nhất từ các kênh đã subscribe

### Bước 3: Hệ thống tự trích cookie

HyperClip tự động trích cookie từ trình duyệt mỗi **15 phút**:

```
Chrome/Edge (đã login) → Cookie Manager (Python + DPAPI) → Netscape format
                                                    ↓
                                   YouTubePoller GET /feed/subscriptions
                                                    ↓
                           ← 1 request = video mới từ TẤT CẢ 100 kênh
```

### Bước 4: Nếu cookie bị hết (dấu hiệu)

Log sẽ hiện:
```
[CookieManager] Cookie init failed: No Chrome or Edge cookie database found
[CookieManager] Auto-refreshing cookies...
[Poll] Poll failed (code 1): 403 Forbidden
```

**Cách khắc phục:**
1. Mở Chrome/Edge → vào youtube.com → đảm bảo đã đăng nhập
2. Khởi động lại HyperClip
3. Cookie tự refresh sau 15 phút

---

## 3. Thêm kênh theo dõi

### Cách đúng

1. Mở HyperClip → Sidebar → click **"+ Add Tracker"**
2. Paste URL YouTube channel:
   - `https://www.youtube.com/@username`
   - `https://www.youtube.com/channel/UCxxxxxx`
3. Channel được thêm → đăng ký với YouTubePoller

### Cách kiểm tra kênh đã hoạt động

Trong log console:
```
[YouTubePoller] Starting (interval: 3s)
[YouTubePoller] Detected 1 new video(s): "Video Title" (abc123xyz)
[Poll] Workspace already exists for abc123xyz (status: ready) — skipping
```

Nếu không thấy log nào sau 30 giây → kiểm tra:
1. Tài khoản YouTube có subscribe kênh đó chưa
2. Cookie có đang valid không (mở youtube.com thử)

---

## 4. Cấu hình per-channel (Go-Live Optimization)

Mỗi kênh có **trimLimit** riêng — quyết định đoạn video được tải về:

| TrimLimit | Download | Auto-render | Dùng khi |
|-----------|----------|-------------|-----------|
| `5min` | Tải tối đa 5 phút đầu | Trim end = 300s | Kênh tin tức, video dài |
| `10min` | Tải tối đa 10 phút đầu | Trim end = 600s | Kênh phim, tutorial |
| `full` | Tải toàn bộ video | Trim end = duration | Kênh nhạc, MV |

### Cách đặt trimLimit cho channel

1. Click **✎** (edit) trên channel trong Sidebar
2. Nhập giá trị `trimLimit` (hiện tại UI chưa có field — edit trực tiếp trong `channels.json`)

File cấu hình: `%APPDATA%/HyperClip/channels.json`

```json
[
  {
    "id": "ch1",
    "name": "TechViet Daily",
    "handle": "@techvietdaily",
    "avatarColor": "#00B4FF",
    "channelId": "UCxxxxxxx",
    "trimLimit": "10min",
    "createdAt": "2026-04-24T00:00:00.000Z"
  }
]
```

---

## 5. Auto-Render (Go-Live Tự động)

### Bật auto-render

File: `%APPDATA%/HyperClip/settings.json`

```json
{
  "autoRender": true,
  "defaultQuality": 1080,
  "defaultTrimLimit": "10min"
}
```

### Khi nào dùng auto-render

| Mode | Trigger | Kết quả |
|------|---------|---------|
| **Auto-render ON** | Video ready → tự render | Output .mp4 trong `/output/` ngay |
| **Auto-render OFF** | Video ready → notification | User mở app → chỉnh → render manual |

**Mặc định: OFF** — để user kiểm soát trước khi render.

### Để bật auto-render

1. Tạo file `%APPDATA%/HyperClip/settings.json`
2. Thêm `"autoRender": true`
3. Khởi động lại HyperClip

---

## 6. Các lỗi thường gặp & cách xử lý

### Lỗi 1: Cookie hết hiệu lực

**Symptom:**
```
[Poll] Poll failed (code 1): 403 Forbidden
[CookieManager] Cookie init failed
```

**Fix:**
1. Đảm bảo Chrome/Edge đã login YouTube
2. Đợi 15 phút (cookie auto refresh)
3. Hoặc restart HyperClip để force refresh

---

### Lỗi 2: yt-dlp không tìm thấy

**Symptom:**
```
Error: Command failed: yt-dlp --version
'yt-dlp' is not recognized as an internal or external command
```

**Fix:**
```bash
pip install yt-dlp
# Hoặc download .exe từ https://github.com/yt-dlp/yt-dlp/releases
# Đặt vào PATH hoặc cùng thư mục với HyperClip
```

---

### Lỗi 3: FFmpeg không nhận NVENC

**Symptom:**
```
Error: No NVENC encoder available
```

**Fix:**
1. Cài NVIDIA drivers mới nhất
2. Kiểm tra: `ffmpeg -encoders | grep nvenc`
3. Nếu không có → GPU không support NVENC → dùng software encode (chậm hơn)

---

### Lỗi 4: Duplicate workspace không tạo

**Symptom:**
```
[Poll] Workspace already exists for abc123xyz (status: ready) — skipping
```

**Đây là hành vi ĐÚNG** — hệ thống tránh re-download video đã có.
Muốn re-download → xóa workspace trong UI trước.

---

### Lỗi 5: Download bị giới hạn age (video quá cũ)

**Symptom:**
```
[Auto] Download success: title → path
[Auto] Video permanently unavailable: title (abc123xyz) — skipped
```

**Fix:** Không có — video đã bị xóa khỏi YouTube. Hệ thống tự mark as seen.

---

### Lỗi 6: Poller không chạy

**Symptom:** Không có log `[YouTubePoller] Starting` khi khởi động.

**Kiểm tra:**
1. Chrome/Edge có đang chạy không?
2. Cookie DB có tồn tại không?
3. Python `requests` library có cài chưa?
4. Kiểm tra log `[HyperClip] Auto-ingestion active`

---

## 7. Tối ưu cho 100 kênh

### Nguyên tắc

- **1 tài khoản YouTube thường (free)** subscribe đủ 100 kênh — Premium KHÔNG cần
- **1 request** mỗi 3-6s (jitter) → poll /feed/subscriptions → tất cả 100 kênh cùng lúc
- 12-20 request/phút → ngưỡng an toàn cho 1 IP
- Cookie refresh mỗi 15 phút → KHÔNG cần tài khoản mới

### KHÔNG cần
- Proxy (không tốn quota)
- Cloudflare Tunnel (đã xóa)
- Google Data API key (không dùng quota)
- WebSub subscription (đã xóa)

### Tốc độ đáp ứng

| Sự kiện | Thời gian |
|---------|-----------|
| Kênh upload video | Poller phát hiện trong **3-6s** |
| Cookie refresh | Mỗi **15 phút** |
| Video download | **< 30s** (10 phút video, 1080p) |
| Blur background gen | **< 3s** |
| Render 10 phút video | **< 2 phút** (RTX 5080 + NVENC) |


### Giới hạn thực tế: Feed scrolloff

Bottleneck không phải số lượng subscribe mà là **Feed scrolloff**: trang  chỉ giữ ~50-100 video gần nhất. Khi kênh upload video mới, video cũ bị đẩy xuống và biến mất khỏi feed.

Với 100 kênh upload trung bình 1 video/ngày → Feed luôn đủ video mới → **không vấn đề gì cả**. Nhưng nếu muốn mở rộng:

### Các tier mở rộng quy mô

| Tier | Kênh | Account | Cách hoạt động |
|------|-----|---------|------------|
| Hiện tại | ~100 | 1 account | 1 poll /feed/subscriptions |
| Tier 1 (miễn code mới) | ~200 | 1 account | Subscribe thêm kênh — feed vẫn đủ video mới |
| Tier 2 | ~500 | 2 accounts | Round-robin poll 2 feed song song |
| Tier 3 | 1000+ | Nhiều accounts | Multi-account parallel polling |

**Tier 2 cần thêm:**
- Cookie Manager đa account: quản nhiều cookies từ nhiều tài khoản
- YouTube Poller đa instance: poll song song nhiều feed
- Gộp kết quả trước khi deduplicate videoId

Chưa implement trong code hiện tại. Ghi lại kế hoạch khi cần.


---

## 8. Cleanup & Maintenance

### Xóa workspace cũ

Trong UI → click ❌ trên workspace card. File video không xóa tự động.

### Xóa video đã download thủ công

Xóa trong `%APPDATA%/HyperClip/videos/` — workspace sẽ chuyển status = 'error', không re-download.

### Reset trạng thái seen-videos

Xóa file `%APPDATA%/HyperClip/seen-videos.json` → hệ thống sẽ quét lại tất cả video từ đầu.

---

## 9. Monitor real-time

### Log locations

| Mục đích | Cách xem |
|----------|---------|
| Console output | Chạy `npm run electron:dev` |
| Workspace status | Mở HyperClip UI |
| Poller status | IPC: `ipc.getPollerStatus()` |
| Render progress | Live trong UI + console |
| Cookie status | Log `[CookieManager]` |

### Key log patterns

```
[YouTubePoller] Starting (interval: 3s)        ← Poller đang chạy
[CookieManager] Extracted N cookies           ← Cookie valid
[Poll] Detected N new video(s)               ← Có video mới
[Auto] Starting download                     ← Bắt đầu tải
[Auto] Download success                      ← Tải xong
[Auto] Ready: title                          ← Video sẵn sàng chỉnh sửa
```

---

## Checklist trước khi bật 24/7

- [ ] Chrome/Edge đã login tài khoản YouTube (free) đã subscribe đủ 100 kênh
- [ ] Python `requests` library đã cài
- [ ] `yt-dlp` đã cài và trong PATH
- [ ] FFmpeg đã cài, NVENC nhận diện được
- [ ] NVIDIA drivers updated
- [ ] RAM ≥ 32GB (cho video temp storage)
- [ ] `%APPDATA%/HyperClip/` folder tồn tại và có quyền ghi

---

## Liên hệ hỗ trợ

Nếu gặp lỗi không trong danh sách trên:
1. Kiểm tra log console đầy đủ
2. Check `%APPDATA%/HyperClip/` directory
3. Restart HyperClip
4. Force cookie refresh: xóa `%APPDATA%/HyperClip/cookies/` rồi restart

---

**Cập nhật: 2026-04-24**