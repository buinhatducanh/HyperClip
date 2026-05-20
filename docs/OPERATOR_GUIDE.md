# HyperClip — Operator Guide

> **Audience:** System operators who prepare and deliver HyperClip to customers.
> **Goal:** Set up 30 Chrome profiles, 200 GCP projects, build the installer, and package for delivery.

---

## Table of Contents

1. [Pre-Delivery Checklist](#1-pre-delivery-checklist)
2. [Chrome Profiles Setup](#2-chrome-profiles-setup)
3. [GCP Projects Setup](#3-gcp-projects-setup)
4. [Bulk Import Projects](#4-bulk-import-projects)
5. [Cookie Extraction](#5-cookie-extraction)
6. [Building the Installer](#6-building-the-installer)
7. [Customer Package](#7-customer-package)
8. [Post-Delivery Support](#8-post-delivery-support)
9. [Performance Benchmarks](#9-performance-benchmarks)

---

## 1. Pre-Delivery Checklist

Before delivering HyperClip to a customer, verify:

| Check | Status |
|-------|--------|
| 30 Chrome profiles created and logged in | ☐ |
| All 30 sessions show "Ready" in Settings | ☐ |
| 200 GCP projects imported and authorized | ☐ |
| At least 10 test channels added and detected | ☐ |
| Test render completed successfully | ☐ |
| NSIS installer built (`HyperClip-Setup-x.x.x.exe`) | ☐ |
| Customer package ZIP verified | ☐ |
| Customer machine has NVIDIA GPU with drivers | ☐ |

---

## 2. Chrome Profiles Setup

### 2.1 Understanding Chrome Sessions

HyperClip uses **30 Chrome browser profiles** as the authentication source for YouTube detection.

Each profile provides cookies to `youtubei.js` (Innertube API) — **zero YouTube API quota consumed**.

### 2.2 Create Chrome Profiles

Run this PowerShell script on the operator machine:

```powershell
# Create 30 Chrome profiles for HyperClip
# Run ONCE on the operator machine

$chromePath = "$env:PROGRAMFILES\Google\Chrome\Application\chrome.exe"
if (-not (Test-Path $chromePath)) {
    $chromePath = "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe"
}

for ($i = 1; $i -le 30; $i++) {
    $profileNum = $i + 1  # Profile 2-31 (profile 1 is default)
    $profileName = "HyperClip-Chrome-Profile-$i"
    $profilePath = "$env:LOCALAPPDATA\Google\Chrome\User Data\Profile.$profileNum"

    Write-Host "Creating profile $i ($profileName) at $profilePath" -ForegroundColor Cyan

    # Launch Chrome with profile to create it
    Start-Process $chromePath -ArgumentList `
        "--profile-directory=Profile.$profileNum", `
        "--user-data-dir=`"$env:LOCALAPPDATA\Google\Chrome\User Data`"", `
        "https://www.youtube.com"

    Start-Sleep -Seconds 3
}

Write-Host ""
Write-Host "30 Chrome profiles created. Please log in to YouTube on each profile." -ForegroundColor Yellow
Write-Host "Tip: Open each profile in a separate window for faster login." -ForegroundColor Yellow
```

### 2.3 Log In to YouTube on Each Profile

**Important:** Each profile needs a **separate Google account** logged into YouTube.

**Why separate accounts?**
- YouTube enforces session limits per account
- 30 sessions with the same account = rate limiting
- Each session must have SOCS cookie = CAI (advertising consent)

**Login steps per profile:**

1. Click profile number (top-right of Chrome) → **"Add"** or **"Manage another account"**
2. Sign in with a Gmail account
3. Go to **youtube.com** — verify the account shows in the header
4. Close the YouTube tab (NOT Chrome itself)
5. Repeat for all 30 profiles

> **Tip:** Use Google **Chrome Profiles** feature (`Settings` → `You and Google` → `Sync`) — each profile syncs its own YouTube login.

### 2.4 Verify Cookie Quality

After logging in to all profiles:

1. Start HyperClip in dev mode: `npm run electron:dev`
2. Open Settings → Chrome Sessions tab
3. Verify the count shows **30/30 ready**
4. Green = ready, Yellow = no consent, Red = dead

Expected result: **30 sessions, all green**

---

## 3. GCP Projects Setup

### 3.1 Why 200 GCP Projects?

YouTube Data API v3 has a **10,000 units/day** quota per project.

| Scenario | Quota needed |
|----------|-------------|
| 1 GCP project | 10,000 units/day |
| 200 GCP projects | 2,000,000 units/day |
| Innertube (Chrome sessions) | 0 units/day (PRIMARY) |

**The architecture:** 200 projects provide OAuth as a **fallback** when Chrome sessions fail. Innertube (Chrome sessions) handles 99.9% of detection. OAuth costs ~3.5% of quota daily.

### 3.2 Create a Google Cloud Project

Repeat this 200 times (or use the bulk creation script in section 4).

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Click **"Select a project"** → **"New Project"**
3. Name: `HyperClip-001` through `HyperClip-200`
4. Enable **YouTube Data API v3:**
   - APIs & Services → Library → search "YouTube Data API v3" → Enable
5. Create OAuth credentials:
   - APIs & Services → Credentials → **Create Credentials** → OAuth client ID
   - Application type: **Desktop app**
   - Name: `HyperClip Client`
   - Download JSON → save as `client_secret_001.json`

### 3.3 Create the CSV Template

Use the provided `templates/projects-template.csv` as the starting point.

Each row needs:

| Column | Example | Notes |
|--------|---------|-------|
| `projectId` | `proj-001` | Unique identifier |
| `projectName` | `Gmail1-ProjectA` | Human-readable name |
| `gmailAccount` | `user1@gmail.com` | Gmail for this project |
| `clientId` | `xxx.apps.googleusercontent.com` | From OAuth JSON |
| `clientSecret` | `GOCSPX-xxx` | From OAuth JSON |
| `apiKey` | `AIzaSy-xxx` | From Google Cloud Console |

Organize by **20 Gmail accounts × 10 projects each** to manage credentials easily.

### 3.4 Authorize All Projects

Use the batch authorization script:

```bash
node scripts/batch-authorize.cjs
```

This opens OAuth flows for all 200 projects in sequence.

**Alternative — Single authorization flow:**

1. Open Settings → Projects tab in HyperClip
2. Click **"Add Project"** for each project
3. Paste client ID, client secret, API key
4. Click **"Authorize"** → browser opens → log in → Allow

### 3.5 Verify Quota Distribution

After authorization, Settings → Projects should show:

```
Total quota: 2,000,000 units/day
Active: 200 / 200
Healthiest project: proj-001 (0 used today)
Most-used: proj-003 (345 units used)
```

---

## 4. Bulk Import Projects

### 4.1 Import from CSV

Use the bulk import script:

```bash
# Import 200 projects from CSV
node scripts/bulk-import-projects.cjs templates/projects-template.csv
```

**What it does:**

1. Creates folder `HyperClip-Data/projects/proj-001/` through `proj-200/`
2. Writes `config.json` in each folder (credentials)
3. Writes `stats.json` in each folder (quota tracking)
4. Updates the channel assignment map

### 4.2 Verify Import

```bash
# Check project count
(Get-ChildItem HyperClip-Data/projects -Directory).Count
# Should output: 200
```

Open HyperClip Settings → Projects tab. All 200 projects should appear.

### 4.3 Batch Authorize

```bash
# Authorize all 200 projects
node scripts/batch-authorize.cjs
```

**Manual authorization:**

1. For each project in Settings → Projects:
2. Click **"Authorize"** next to each
3. Browser opens → log in → Allow → token saved

> **Note:** Batch authorization requires the user to log in once per Gmail account (20 logins for 200 projects, 10 projects each).

---

## 5. Cookie Extraction

### 5.1 How It Works

HyperClip extracts cookies from Chrome profiles using:

- **Windows DPAPI** — decrypts Chrome's encrypted SQLite database
- **sql.js** — reads the SQLite cookie database
- **SOCS injection** — forces CAI consent cookie when missing

### 5.2 Cookie Files

Extracted cookies are stored in:

```
HyperClip-Data/chrome-profiles/
  profile-1/
    cookies.json       ← All cookies (DPAPI-decrypted)
  profile-2/
    cookies.json
  ...
  profile-30/
    cookies.json
```

### 5.3 Required Cookies

| Cookie | Purpose | Must be CAI? |
|--------|---------|-------------|
| `SAPISID` | SAPISIDHASH auth header | No |
| `__Secure-1PSID` | Session ID | No |
| `__Secure-1PSIDCC` | Certificate | No |
| `__Secure-1PSIDTS` | Timestamp | No |
| `SOCS` | Consent cookie | **YES** (`CAI`) |

### 5.4 SOCS = CAI Force-Injection

If SOCS is missing or not CAI, HyperClip **automatically injects** `SOCS=CAI` into the cookie string at 4 places:

1. `InnertubeClientPool._init()` — initial session creation
2. `InnertubeClientPool._refreshBatch()` — batch refresh
3. `InnertubeClient.refreshSession()` — per-session refresh
4. `openLoginWindow()` — when user opens Chrome login window

**This means customers do NOT need to accept the Google consent banner** — HyperClip handles it automatically.

### 5.5 Transfer Cookies to Customer Machine

The cookie extraction script packages cookies for transfer:

```powershell
# Run on operator machine to extract and package cookies
node scripts/extract-cookies.js
```

This creates `_hyperclip_cookies.zip` containing all 30 `cookies.json` files.

**On customer machine:**

```powershell
# Extract cookies into HyperClip data folder
Expand-Archive _hyperclip_cookies.zip -DestinationPath "$env:APPDATA\HyperClip\HyperClip-Data\chrome-profiles"
```

---

## 6. Building the Installer

### 6.1 Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | 18+ | Build tooling |
| npm | 9+ | Package management |
| electron-builder | Latest | NSIS installer builder |

Install prerequisites:

```bash
npm install
```

### 6.2 Build Commands

```bash
# Development build (no installer)
npm run electron:dev

# Production build (creates .exe installer)
npm run electron:build

# TypeScript verification only
npm run typecheck

# Quick rebuild (skip typecheck)
node scripts/build.mjs
```

### 6.3 Build Script Walkthrough

`npm run electron:build` runs:

1. `npx tsc --noEmit -p electron/tsconfig.main.json` — verify main process
2. `npx tsc --noEmit -p electron/tsconfig.preload.json` — verify preload
3. `node scripts/build.mjs` — Next.js build + electron-builder

`scripts/build.mjs`:

```
1. next build                    → .next/ folder (Next.js app)
2. esbuild electron/main.ts      → dist/main.js
3. esbuild electron/preload.ts  → dist/preload.js
4. electron-builder              → dist/HyperClip-Setup-x.x.x.exe
```

### 6.4 Installer Configuration

`electron-builder.yml` configures the NSIS installer:

```yaml
appId: com.hyperclip.app
productName: HyperClip
directories:
  output: dist
  buildResources: build
files:
  - .next/**/*
  - dist-electron/**/*
  - node_modules/**/*
  - package.json
asar: true
nsis:
  oneClick: false              # Allow customer to choose install dir
  allowToChangeInstallationDirectory: true
  createDesktopShortcut: true
  createStartMenuShortcut: true
  runAfterFinish: true
  installerIcon: build/icon.ico
  uninstallerIcon: build/icon.ico
  include: installer.nsh        # Post-install script
```

### 6.5 Post-Install Script (installer.nsh)

The NSIS post-install script (`installer.nsh`) creates:

```
%APPDATA%\HyperClip\           ← App data folder
  HyperClip-Data\
    projects\                   ← 200 GCP project configs
    channels\                   ← Channel data
    downloads\                  ← Video files
    blur\                       ← Background images
    output\                     ← Rendered videos
    archived\                   ← Final output
    chrome-profiles\            ← 30 Chrome cookie sets
    logs\                       ← App logs
  app.log                       ← Application log
```

### 6.6 Build Output

After build, the installer is at:

```
dist/
  HyperClip-Setup-2.0.0.exe    ← Customer installer (NSIS)
  win-unpacked/
    HyperClip.exe               ← Portable exe (no install needed)
    resources/
      app.asar                  ← Bundled application
```

---

## 7. Customer Package

### 7.1 Package Contents

Use the automated build script:

```powershell
.\scripts\build-customer-package.ps1
```

This creates a ZIP with:

```
HyperClip-Customer-Package-v2.0.0/
  HyperClip-Setup-2.0.0.exe    ← Installer (primary)
  Portable/
    HyperClip.exe               ← Portable executable
    resources/
  hyperclip-cookies.zip         ← Pre-extracted Chrome cookies
  _hyperclip_cookies.json       ← Legacy cookie format
  docs/
    CUSTOMER_SETUP_GUIDE.pdf    ← Setup guide for customer
    CUSTOMER_SETUP_GUIDE.md     ← Markdown version
  README.txt                    ← Quick start instructions
```

### 7.2 Build Script Details

`scripts/build-customer-package.ps1` performs:

1. **Prerequisites check** — verify Node.js, npm, electron-builder installed
2. **Clean** — remove old build artifacts
3. **TypeScript verify** — `npm run typecheck`
4. **Next.js build** — `next build`
5. **Electron compile** — `tsc` for main + preload
6. **electron-builder** — create NSIS installer
7. **Verify output** — check `.exe` exists and size > 100MB
8. **Package ZIP** — bundle everything + cookies + docs

### 7.3 Delivery Options

| Method | Pros | Cons |
|--------|------|------|
| USB drive | Fast transfer, no internet needed | Physical delivery |
| Cloud download (ZIP) | Instant, scannable URL | Large file (~2GB) |
| Operator install (remote) | Guaranteed correct setup | Requires remote access |
| Self-install (ZIP) | Customer autonomy | Customer needs technical skill |

**Recommended:** USB drive with auto-run instructions + PDF guide.

### 7.4 First-Run on Customer Machine

Run the first-run script on the customer machine:

```powershell
.\customer-first-run.ps1
```

This:
1. Verifies NVIDIA GPU + drivers
2. Checks disk space (requires 50GB+)
3. Runs the installer silently
4. Extracts cookies
5. Launches HyperClip
6. Opens Onboarding Wizard

---

## 8. Post-Delivery Support

### 8.1 Health Alert System

HyperClip monitors 5 critical conditions and sends notifications:

| Alert | Severity | Condition | Action |
|-------|----------|-----------|--------|
| Innertube Dead | Critical | 0/30 sessions ready | Notify: "All Chrome sessions failed — check cookie status" |
| OAuth Quota Low | Warning | All projects < 10% remaining | Notify: "OAuth quota running low" |
| OAuth Quota Exhausted | Critical | All projects exhausted | Notify: "OAuth quota exhausted — switching to Chrome-only" |
| Disk Space Low | Critical | Free space < 5GB | Notify: "Low disk space — free up space to continue" |
| No New Videos 24h | Warning | No detection for 24h | Notify: "No new videos detected in 24h — check channels" |

### 8.2 Log Collection

When customer reports an issue, collect:

```powershell
# Collect all logs for debugging
$logs = @(
    "$env:APPDATA\HyperClip\HyperClip-Data\logs\app.log",
    "$env:APPDATA\HyperClip\HyperClip-Data\logs\detection.log",
    "$env:APPDATA\HyperClip\HyperClip-Data\logs\render.log",
    "$env:APPDATA\HyperClip\HyperClip-Data\app.log"
)
Compress-Archive $logs -DestinationPath "hyperclip-logs-$(Get-Date -Format 'yyyyMMdd-HHmmss').zip"
```

### 8.3 Common Operator Fixes

| Issue | Fix |
|-------|-----|
| Sessions not ready after cookie transfer | Re-extract cookies with `extract-cookies.js` |
| OAuth quota exhausted for all projects | Wait for midnight UTC reset OR add more projects |
| Customer GPU not detected | Install NVIDIA driver 550+, verify CUDA in `nvidia-smi` |
| FFmpeg crashes during render | Update FFmpeg binary, check GPU temps |
| HyperClip crashes on startup | Delete `%APPDATA%\HyperClip\app.log`, restart |

---

## 9. Performance Benchmarks

These are typical values on the reference hardware:

| Hardware | Metric | Value |
|----------|--------|-------|
| RTX 5080 | 1080p render (10 min video, 1.1x speed) | **~2 min** |
| RTX 5080 | 1080p render (full 1h video, 1.1x speed) | **~12 min** |
| RTX 5080 | Detection latency (Innertube) | **< 5 sec** |
| RTX 5080 | Download speed (YT-DLP, 720p) | **~50 Mbps** |
| RTX 5080 | GPU memory per render worker | **~1.5 GB** |
| RTX 5080 | Max concurrent render workers | **8** |
| 64 GB RAM | Idle RAM usage | **~800 MB** |
| 64 GB RAM | Per-render-worker RAM | **~2 GB** |
| RAM disk | Temp video read speed | **~10 GB/s** |

### Detection Latency Breakdown

```
YouTube uploads video
  ↓ +0s          YouTube's CDN propagates
  ↓ +5s          Innertube poll (5s interval)
  ↓ +200ms       Innertube API response (round-robin session)
  ↓ +100ms       Parse + dedup check
  ↓ +1s          yt-dlp download (720p, first 10 min)
  ↓ +2s          FFmpeg pre-process (static blur)
  ↓ +1s          Workspace created, notification sent
─────────────────────────────────────────────────
Total            ~10 seconds from upload to notification
```

---

## Appendix A — Quick Reference

### Commands

```bash
# Start in dev mode
npm run electron:dev

# Build installer
npm run electron:build

# TypeScript check
npm run typecheck

# Import projects
node scripts/bulk-import-projects.cjs templates/projects.csv

# Extract cookies
node scripts/extract-cookies.js

# Build customer package
.\scripts\build-customer-package.ps1
```

### File Locations

| Path | Purpose |
|------|---------|
| `%APPDATA%\HyperClip\` | All app data |
| `%APPDATA%\HyperClip\HyperClip-Data\projects\` | 200 GCP project configs |
| `%APPDATA%\HyperClip\HyperClip-Data\channels\` | Channel + seen-videos data |
| `%APPDATA%\HyperClip\HyperClip-Data\chrome-profiles\` | 30 Chrome cookie sets |
| `%APPDATA%\HyperClip\HyperClip-Data\logs\` | App, detection, render logs |
| `%APPDATA%\HyperClip\HyperClip-Data\archived\` | Final rendered videos |
| `C:\Program Files\HyperClip\` | Default install location |

### Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `DEV_LOG=1` | Off | Enable verbose dev logging |
| `HYPERCLIP_DATA_DIR` | `%APPDATA%\HyperClip\HyperClip-Data` | Override data folder |

---

*Operator Guide v1.0 — For HyperClip v2.x*
