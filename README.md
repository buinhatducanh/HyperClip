# HyperClip

Auto-render vertical video app cho YouTube creators.

## Cài đặt (1 lệnh)

### Windows

```powershell
irm https://bit.ly/hyperclip-install | iex
```

Hoặc tải script về chạy trực tiếp:
```powershell
irm https://raw.githubusercontent.com/loopcompany/hyperclip/main/install.ps1 -OutFile install.ps1
.\install.ps1
```

### Linux

```bash
curl -fsSL https://bit.ly/hyperclip-install-linux | bash
```

## E2E Demo Flow

Sau khi cài đặt xong:

```
1. Mở app: release\win-unpacked\HyperClip.exe
2. Settings → API Keys (30 projects đã có sẵn)
3. Settings → Sessions → Add Chrome session
4. Quay lại Dashboard → Add channel (URL YouTube channel)
5. Video tự động detect (5s interval) → download → render
```

**Không cần tạo Google Cloud project, không cần OAuth credentials, không cần license key.**

### Demo data

- **30 GCP projects** — đã được copy vào `D:\HyperClip-Data\projects\`
  (credentials: clientId + clientSecret + apiKey của 30 Google Cloud projects)
- **Detection**: Innertube API (Chrome sessions) + 30 GCP projects fallback
- **Download**: yt-dlp với `tv_embedded` client → 1080p60 H.264

### Gia hạn demo projects

Nếu quota hết (mỗi project 10,000 units/ngày):
1. Chạy script `scripts/export-demo-projects.mjs` trên máy có HyperClip-Data
2. Commit `demo-data/projects/` mới lên repo
3. Khách pull → projects mới

## Build từ source

### Prerequisites
- Python 3.11+ (PySide6)
- Rust 1.75+ (cargo)
- FFmpeg (CUDA/NVENC build)
- yt-dlp

### Build
```bash
git clone https://github.com/loopcompany/hyperclip.git
cd hyperclip

# Build Rust backend
cargo build -p hyperclip-tauri --release

# Run QML app
python src/main.py
```

Output: `target/release/hyperclip-tauri.exe` (Rust binary) + QML frontend

## Công cụ

| Công cụ | Version |
|---|---|
| Python | 3.11+ (PySide6/QML) |
| Rust | 1.75+ |
| FFmpeg | 7.1 (CUDA/NVENC) |
| yt-dlp | latest |

## Yêu cầu hệ thống

| | Windows | Linux |
|---|---|---|
| OS | Windows 10+ | Ubuntu 20.04+ |
| RAM | 8GB+ (16GB recommended for multi-instance download) | 8GB+ |
| GPU | NVIDIA RTX (NVENC) | NVIDIA RTX (NVENC) |
| Storage | 2GB+ | 2GB+ |

## Kiến trúc

```
┌─────────────────┐     JSON-RPC (stdin/stdout)      ┌──────────────────┐
│  Python/QML     │ ◄─────────────────────────────► │  Rust Backend    │
│  (Frontend)     │                                  │  (hyperclip_ipc) │
└─────────────────┘                                  └──────────────────┘
        │                                                    │
        │                                                    │
        ▼                                                    ▼
┌─────────────────┐                              ┌──────────────────┐
│ QML Models      │                              │ • Innertube Pool │
│ Event Bus       │                              │ • Poller         │
│ UI Components   │                              │ • Downloader     │
│                 │                              │ • Renderer       │
└─────────────────┘                              │ • Cookie Manager │
                                                 │ • Token Manager  │
                                                 └──────────────────┘
```

### Pipeline

1. **YouTubePoller** (5s ± 20% jitter) → fetch subscription feed
2. **Innertube API** (30 Chrome sessions, SAPISIDHASH) — PRIMARY, NO QUOTA
3. **Filter**: age ≤ 10 min, unseen, not deleted, duration ≥ 60s, aspect ≠ 9:16
4. **Auto-download** (yt-dlp, `tv_embedded` client, 16 fragments parallel)
5. **Auto-render** (FFmpeg NVENC, filter chain, chunked)

## Tài liệu

- [HYPERCLIP_RULES.md](HYPERCLIP_RULES.md) — Source of truth nghiệp vụ + kỹ thuật
- [docs/TECHNOLOGY_OVERVIEW.md](docs/TECHNOLOGY_OVERVIEW.md) — Tổng quan kiến trúc
- [docs/YOUTUBE_DOWNLOAD_2026.md](docs/YOUTUBE_DOWNLOAD_2026.md) — Download strategy
- [docs/MIGRATION_NOTES.md](docs/MIGRATION_NOTES.md) — Migration notes từ Electron