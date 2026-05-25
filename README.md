# HyperClip

Auto-render vertical video app cho YouTube creators.

## Cai dat (1 lenh)

### Windows

```powershell
irm https://bit.ly/hyperclip-install | iex
```

Hoac tai script ve chay truc tiep:
```powershell
irm https://raw.githubusercontent.com/loopcompany/hyperclip/main/install.ps1 -OutFile install.ps1
.\install.ps1
```

### Linux

```bash
curl -fsSL https://bit.ly/hyperclip-install-linux | bash
```

## E2E Demo Flow

Sau khi cai dat xong:

```
1. Mo app: release\win-unpacked\HyperClip.exe
2. Settings → API Keys (30 projects da co san)
3. Settings → Sessions → Add Chrome session
4. Quay lai Dashboard → Add channel (URL YouTube channel)
5. Video tu dong detect (5s interval) → download → render
```

**Khong can tao Google Cloud project, khong can OAuth credentials, khong can license key.**

### Demo data

- **30 GCP projects** — da duoc copy vao `D:\HyperClip-Data\projects\`
  (credentials: clientId + clientSecret + apiKey cua 30 Google Cloud projects)
- **Detection**: Innertube API (Chrome sessions) + 30 GCP projects fallback
- **Download**: yt-dlp voi `tv_embedded` client → 1080p60 H.264

### Gia han demo projects

Neu quota het (moi project 10,000 units/ngay):
1. Chay script `scripts/export-demo-projects.mjs` tren may co HyperClip-Data
2. Commit `demo-data/projects/` moi len repo
3. Khach pull → projects moi

## Build tu source

```bash
git clone https://github.com/loopcompany/hyperclip.git
cd hyperclip
npm run electron:build
```

Output: `release/HyperClip-Setup-0.0.1.exe`

## Cong cu

| Cong cu | Version |
|---|---|
| Electron | 41.5.0 |
| Next.js | 14.2.35 |
| FFmpeg | 7.1 (CUDA/NVENC) |
| yt-dlp | latest |

## Yeu cau he thong

| | Windows | Linux |
|---|---|---|
| OS | Windows 10+ | Ubuntu 20.04+ |
| RAM | 8GB+ | 8GB+ |
| GPU | NVIDIA RTX (NVENC) | NVIDIA RTX (NVENC) |
| Storage | 2GB+ | 2GB+ |
