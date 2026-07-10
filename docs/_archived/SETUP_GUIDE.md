# HyperClip — Hướng Dẫn Cài Đặt Cho Máy Mới

## 1. Môi Trường Cần Thiết

### Node.js
- **Yêu cầu:** Node.js 20 LTS trở lên
- **Kiểm tra:**
  ```powershell
  node -v
  ```
- **Nếu chưa có:** https://nodejs.org → Tải bản LTS (20.x hoặc mới hơn)

### Python (cho yt-dlp)
- **Yêu cầu:** Python 3.8 trở lên
- **Kiểm tra:**
  ```powershell
  python --version
  ```
- **Nếu chưa có:** https://www.python.org → Tải bản mới nhất

### Git
- **Kiểm tra:**
  ```powershell
  git --version
  ```
- **Nếu chưa có:** https://git-scm.com → Tải Git for Windows

---

## 2. Cài Đặt HyperClip (Development)

### Clone Repository
```powershell
cd D:\LOOP_COMPANY
git clone https://github.com/buinhatducanh/HyperClip.git
cd HyperClip
```

### Cài Dependencies
```powershell
npm install
```

### Cài yt-dlp (BẮT BUỘC — cho phần lớn tính năng)
```powershell
npm install yt-dlp-exec
```
> **Tại sao cần yt-dlp:** Dùng để probe video (lấy thumbnail, duration, aspect ratio), download video, lấy available formats. Không có yt-dlp → preview không hiện, download thất bại.

---

## 3. FFmpeg

FFmpeg được bundle trong repo tại `resources/ffmpeg/bin/` (bản 7.x). App ưu tiên dùng FFmpeg bundle, sau đó fallback theo thứ tự:

1. `resources/ffmpeg/bin/` — có sẵn trong repo
2. **CapCut FFmpeg** — nếu đã cài CapCut (miễn phí, phổ biến trên máy VN)
3. **Chocolatey FFmpeg** — `choco install ffmpeg`
4. FFmpeg trong PATH hệ thống

### Cách 1: Dùng CapCut (Khuyến nghị — không cần cài thêm)
```powershell
# Tải CapCut: https://www.capcut.com/download
# App sẽ tự tìm FFmpeg trong thư mục CapCut
```

### Cách 2: Chocolatey
```powershell
# Mở PowerShell (Admin)
choco install ffmpeg -y
# Khởi động lại terminal
ffmpeg -version
```

### Cách 3: Tải trực tiếp (không cần cài đặt)
1. Tải bản **essentials** từ: https://www.gyan.dev/ffmpeg/builds/
2. Giải nén (cần **7-Zip**: https://www.7-zip.org)
3. Copy đường dẫn thư mục `bin\` (VD: `C:\ffmpeg\bin`)
4. Thêm vào PATH:
   ```powershell
   # PowerShell (Admin)
   [Environment]::SetEnvironmentVariable("Path", $env:Path + ";C:\ffmpeg\bin", "User")
   ```

### Kiểm tra FFmpeg
```powershell
D:\LOOP_COMPANY\HyperClip\resources\ffmpeg\bin\ffmpeg.exe -version
# Hoặc nếu đã thêm vào PATH:
ffmpeg -version
```

---

## 4. Chạy App

### Development Mode
```powershell
npm run electron:dev
```

### Build Production (.exe)
```powershell
npm run electron:build
```
- Output: `release/` chứa file cài đặt `.exe`
- FFmpeg, yt-dlp được bundle tự động trong installer

---

## 5. Kiểm Tra Lỗi Thường Gặp

### Lỗi: `yt-dlp not found`
```powershell
npm install yt-dlp-exec
```

### Lỗi: `'wmic' is not recognized`
- Lỗi này xuất hiện trên Windows 11 (wmic bị deprecated). Đã được fix trong code — chỉ cần build lại:
  ```powershell
  npm run electron:build
  ```

### Lỗi: Module not found khi build
```powershell
npm install
npm run electron:build
```

### Lỗi: Chrome/Edge không mở khi đăng nhập
- Đảm bảo Chrome hoặc Edge được cài đặt trên máy
- Thử đăng nhập bằng tài khoản Google trên trình duyệt trước

### Lỗi: Không nhận GPU (NVENC)
- Cài driver NVIDIA mới nhất cho card đồ họa
- Kiểm tra: `nvidia-smi` hoặc Task Manager → Performance → GPU

---

## 6. Cấu Hình Tùy Chọn

### OAuth Credentials (Optional — cho YouTube Data API fallback)
- Vào app → Settings → OAuth Credentials
- Nhập Client ID và Client Secret từ Google Cloud Console

### Số lượng Sessions
- Mặc định: 5 sessions (RAM < 32GB) hoặc 10 sessions (RAM ≥ 32GB)
- Sessions được chia theo hardware profile: desktop, laptop, server

### Download Quality
- Mặc định: 1080p
- Ưu tiên: `tv_embedded` client → 1080p60 H.264 (bypass EJS challenge)

---

## 7. Tổng Hợp Lệnh (Copy-Paste Nhanh)

```powershell
# 1. Clone repo (nếu chưa có)
# cd D:\LOOP_COMPANY
# git clone https://github.com/buinhatducanh/HyperClip.git
# cd HyperClip

# 2. Cài dependencies
npm install

# 3. Cài yt-dlp (BẮT BUỘC)
npm install yt-dlp-exec

# 4. Cài FFmpeg qua Chocolatey (nếu không dùng CapCut)
choco install ffmpeg -y

# 5. Chạy development
npm run electron:dev

# 6. Build production
npm run electron:build
```

---

## 8. Kiểm Tra Sau Khi Cài

Sau khi chạy `npm run electron:dev`, kiểm tra console log không có lỗi đỏ:

```
[DEV] [InnertubePool] Session 1: 5/5 sessions ready  # ✅ Sessions OK
[DEV] [FFmpeg] Binary: ffmpeg version ...            # ✅ FFmpeg OK
[DEV] [yt-dlp] FOUND                                 # ✅ yt-dlp OK
```

Nếu thấy banner đỏ `yt-dlp not found` → chạy `npm install yt-dlp-exec`.
