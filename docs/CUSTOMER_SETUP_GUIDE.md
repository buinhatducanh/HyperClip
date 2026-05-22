# HyperClip — Customer Setup Guide

> **Audience:** End customers receiving a pre-configured HyperClip package.
> **Goal:** Get HyperClip running in under 30 minutes with zero technical knowledge.
>
> If you received a `.zip` package from your operator, start at **Step 1**.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Step 1 — Install HyperClip](#2-step-1--install-hyperclip)
3. [Step 2 — First Launch & Onboarding Wizard](#3-step-2--first-launch--onboarding-wizard)
4. [Step 3 — Configure Settings](#4-step-3--configure-settings)
5. [Step 4 — Verify Detection](#5-step-4--verify-detection)
6. [Usage — Day-to-Day](#6-usage--day-to-day)
7. [Render Pipeline](#7-render-pipeline)
8. [Troubleshooting](#8-troubleshooting)
9. [Uninstall](#9-uninstall)

---

## 1. Prerequisites

| Item | Requirement |
|------|------------|
| OS | Windows 10/11 (64-bit) |
| RAM | 16 GB minimum, 32 GB recommended |
| GPU | NVIDIA GPU with NVENC (RTX series) for hardware encoding |
| Disk | 50 GB free space for video storage |
| Internet | Stable connection, 50+ Mbps recommended |
| Google Account | For YouTube cookie authentication (optional — app works without it) |

### GPU Check

Open **Task Manager** → **Performance** tab → look for **NVIDIA GPU** with **NVENC** support.

- RTX 4060, 4070, 4080, 4090, 5050, 5060, 5070, 5080, 5090 → Full NVENC support
- GTX series → Software encoding only (slower)
- No NVIDIA GPU → Software encoding (very slow, not recommended)

---

## 2. Step 1 — Install HyperClip

### Option A — Installer (Recommended)

1. Download `HyperClip-Setup-x.x.x.exe` from your operator
2. Double-click to run the installer
3. If Windows SmartScreen blocks it, click **"More info"** → **"Run anyway"**
4. Choose installation directory (default: `C:\Program Files\HyperClip`)
5. Click **Install** → wait for completion
6. Click **Finish** — HyperClip launches automatically

### Option B — Portable ZIP

1. Extract the `.zip` file to any folder (e.g., `D:\HyperClip`)
2. Double-click `HyperClip.exe` to launch
3. Data is stored in `%APPDATA%\HyperClip`

### Data Location

All data is stored in:
```
%APPDATA%\HyperClip\
  HyperClip-Data\        ← All videos, workspaces, cache
  app.log               ← Application logs
```

---

## 3. Step 2 — First Launch & Onboarding Wizard

On first launch, HyperClip shows the **Onboarding Wizard** — a 5-step setup guide.

### Step 1 — Chrome Setup

This step connects HyperClip to your YouTube account via Chrome browser sessions.

**If you see "X / 30 sessions ready":**

- Your operator has pre-configured Chrome sessions
- Click **"Next"** to proceed

**If you see "0 sessions ready":**

1. Click **"Open Chrome to login"**
2. A Chrome browser window opens with a HyperClip profile
3. Log in to your YouTube account (google.com/youtube)
4. Return to HyperClip and click **"Refresh sessions"**
5. You should see sessions become ready
6. Click **"Next"**

> **Important:** Close Chrome before starting HyperClip. Chrome locks the cookie database while running.

### Step 2 — Add Channels

Add YouTube channels you want to monitor.

1. Enter a YouTube channel URL or handle in the input box
   - Example: `https://www.youtube.com/@MrBeast`
   - Example: `https://www.youtube.com/channel/UCX6OQ3DkcsbYNE6H8uQQuVA`
2. Click **"Add Channel"** — HyperClip fetches the channel info
3. Repeat for all channels you want to track
4. Click **"Next"**

> You can add more channels later from Settings → Channels tab.

### Step 3 — GCP Projects (OAuth Backup)

GCP projects provide OAuth quota as a backup when Chrome sessions fail.

- If your operator pre-configured projects, you'll see them listed here
- Green = healthy, Yellow = low quota, Red = exhausted
- Click **"Next"** to proceed

> **Note:** GCP projects are optional. HyperClip runs fine on Chrome sessions alone, but OAuth provides redundancy.

### Step 4 — Detection Quality

Configure how fast and thorough HyperClip should detect new videos.

| Setting | Options | Recommendation |
|---------|---------|---------------|
| Poll Interval | 3s / 5s / 10s / 30s | **5s** (balance speed vs. server load) |
| Download Quality | 360p / 480p / 720p / 1080p | **720p** (fast download, good quality) |
| Render Quality | 720p / 1080p | **1080p** (best quality) |
| Auto-render | On / Off | **Off** initially, enable later |
| Trim Limit | 1–30 min or Full | **10 minutes** |

Click **"Next"** when done.

### Step 5 — Complete

Congratulations! HyperClip is configured.

- Review the summary of your setup (channels, sessions, projects)
- Click **"Launch Dashboard"** to open the main screen

---

## 4. Step 3 — Configure Settings

Click the **gear icon** in the sidebar or press `Ctrl+,` to open Settings.

### 4a. Channels Tab

| Action | How |
|--------|-----|
| Add channel | Paste URL → click Add |
| Remove channel | Click X on the channel card |
| Sync subscriptions | Click "Sync from YouTube" (uses OAuth, 1-time) |
| Verify tracking | Column "Last Detected" shows recent activity |

### 4b. Projects Tab (OAuth)

| Status | Meaning |
|--------|---------|
| Healthy (green) | Project working, quota available |
| Low quota (yellow) | < 10% remaining today |
| Exhausted (red) | Daily quota reached — resets at midnight UTC |
| Unauthorized (orange) | OAuth token expired — needs re-authorization |

**To re-authorize an expired project:**

1. Click **"Authorize"** next to the project
2. Browser opens — log in with the Gmail account
3. Click **"Allow"** on the Google consent screen
4. Return to HyperClip — status should turn green

### 4c. Chrome Sessions Tab

| Status | Meaning |
|--------|---------|
| Ready (green) | Session authenticated, can detect |
| No consent (yellow) | SOCS cookie missing — open Chrome and log in |
| Dead (red) | Session cookies expired — re-login |

**To refresh sessions:**

1. Click **"Refresh all sessions"**
2. HyperClip re-extracts cookies from Chrome profiles

### 4d. Poller Tab

| Metric | Description |
|--------|-------------|
| Status | Active / Paused / Error |
| Poll interval | Current detection frequency |
| Channels monitored | Total channel count |
| Consecutive errors | Errors since last success |
| Innertube health | Ready sessions / total sessions |

**To pause detection:** Click the pause button in the sidebar.

---

## 5. Step 4 — Verify Detection

### Watch the Dashboard

After setup, the main dashboard shows:

```
┌─────────────────────────────────────────────────┐
│ Sidebar (220px) │ Center (workspaces) │ Editor  │
└─────────────────────────────────────────────────┘
```

New videos auto-download and appear in the **Workspace Queue** with status:

| Status | Color | Meaning |
|--------|-------|---------|
| `downloading` | Blue | yt-dlp downloading the video |
| `ready` | Green | Download complete, ready to edit |
| `rendering` | Yellow | FFmpeg rendering in progress |
| `done` | White | Output ready in `archived/` folder |
| `error` | Red | Download or render failed |

### Check the System Monitor (Sidebar)

At the bottom of the sidebar:

- **Poll** indicator: flashes green on each detection cycle
- **Download** indicator: shows active download speed
- **GPU** indicator: shows GPU temperature and memory
- **RAM** indicator: shows memory usage

### Verify Logs

To confirm detection is working:

1. Open `%APPDATA%\HyperClip\HyperClip-Data\logs\`
2. Open `app.log` in a text editor
3. Search for `New video detected` — each occurrence = successful detection

---

## 6. Usage — Day-to-Day

### Auto-Download

Once configured, HyperClip runs **24/7** in the background:

1. Detects new video within **5 seconds** of upload
2. Auto-downloads first **N minutes** (your trim limit setting)
3. Creates a workspace — appears in the queue
4. Sends a desktop notification: "New video from [Channel Name]"

### Editing a Video

1. Click a **ready** workspace card in the center pane
2. The editor opens on the right
3. Adjust trim, speed, background, overlays
4. Click **"Preview"** to watch
5. Click **"Render"** when done

### Rendering

1. Click **"Render"** on a workspace — encoding starts immediately
2. Watch progress in the **Render Queue Bar** (bottom of screen)
3. When done, the output appears in:
   ```
   %APPDATA%\HyperClip\HyperClip-Data\archived\
     2026-05\
       [ChannelName]_[VideoTitle]_[Date].mp4
   ```

### Keyboard Shortcuts (Editor)

| Key | Action |
|-----|--------|
| `Space` | Play / Pause preview |
| `←` / `→` | Seek ±5 seconds |
| `Shift + ←` / `→` | Seek ±1 second |
| `Ctrl + S` | Save workspace |
| `Ctrl + Z` | Undo |
| `Ctrl + Shift + Z` | Redo |

---

## 7. Render Pipeline

### How It Works

HyperClip uses **NVIDIA NVENC** hardware encoding — your GPU does the heavy lifting.

```
Source Video (MP4)
      ↓
yt-dlp (download trimmed section)
      ↓
Static blur background (1 frame, cached)
      ↓
React-Konva Canvas (edit preview, 60fps)
      ↓
FFmpeg + NVENC → Output MP4
```

### Render Settings

| Setting | Recommended | Notes |
|---------|-------------|-------|
| Resolution | 1080×1920 (9:16) | Vertical for TikTok/Reels/Shorts |
| Speed | 1.1x | Slightly faster, still natural |
| Codec | H.265 (HEVC) | Best quality/size ratio |
| GPU | RTX series | Hardware NVENC |
| Worker chunks | 8 | Parallel GPU workers |

### Chunked Rendering

For videos > 5 minutes, HyperClip splits rendering into **120-second chunks** processed in parallel:

1. GPU processes 8 chunks simultaneously
2. Chunks are stitched together
3. Total render time ≈ `duration / (workers × speed)`

---

## 8. Troubleshooting

### "No sessions ready"

**Cause:** Chrome is running and locking the cookie database.

**Fix:**
1. Close Chrome completely (check system tray)
2. Click **"Refresh all sessions"** in Settings → Chrome Sessions tab

### "Videos not auto-downloading"

**Check in order:**

1. **Poller active?** — Sidebar shows "Active" status
2. **Channels added?** — Settings → Channels shows your channels
3. **Sessions ready?** — Settings → Chrome Sessions shows green status
4. **Log check:** Open `%APPDATA%\HyperClip\HyperClip-Data\logs\app.log` and search for errors

### "Render stuck at 0%"

**Cause:** GPU driver issue or FFmpeg crash.

**Fix:**
1. Cancel the render (click X on the progress bar)
2. Restart HyperClip
3. Update NVIDIA drivers: `nvidia-smi` → Driver version should be 550+
4. Try again — if it fails again, report to your operator

### "Low disk space"

**Fix:** Move the `archived\` folder to a larger drive.

1. Open Settings → Storage
2. Change "Output folder" to a new location
3. Old files remain in the old location

### "OAuth quota exhausted"

**Normal behavior:** Each GCP project has 10,000 units/day. If exhausted, the project shows red status. **It auto-recovers at midnight UTC.**

**To avoid exhaustion:**
- Add more GCP projects in Settings → Projects
- Each project = +10,000 units/day

### "YouTube 403 / 429 errors"

**Cause:** Too many concurrent requests or rate limiting.

**Fix:**
1. Wait 5-10 minutes — rate limits auto-clear
2. If persistent, restart HyperClip
3. Report to operator if > 30 minutes

### "Claude or Riot Games Connection Timeout"

**Cause:** Local ISP (like Viettel, FPT, VNPT in Vietnam) routing issues or blocking international Cloudflare CDN/Anthropic IP ranges. Alternatively, Cloudflare WARP is running but using the MASQUE (HTTP/3) protocol, which is blocked by the ISP.

**Fix:**
1. **Enable Cloudflare WARP** or a reliable VPN.
2. If WARP is stuck in `Connecting` status forever, open Command Prompt or PowerShell and switch the WARP tunnel protocol to WireGuard:
   ```powershell
   warp-cli tunnel protocol set WireGuard
   warp-cli connect
   ```
3. Run `warp-cli status` to verify it shows `Connected` and `Network: healthy`.

### HyperClip won't start

**Fix:**
1. Press `Win + R` → type `%APPDATA%\HyperClip`
2. Delete `app.log` and `crash.log` (if any)
3. Restart HyperClip
4. If still failing, check Windows Event Viewer → Application logs

---

## 9. Uninstall

### Option A — From Control Panel

1. Open **Control Panel** → **Programs and Features**
2. Find **HyperClip** in the list
3. Click **Uninstall**
4. Choose whether to keep or delete data

### Option B — From Settings

1. Open HyperClip Settings → **About** tab
2. Click **"Uninstall HyperClip"**

### Manual Uninstall

1. Stop HyperClip (right-click tray icon → Quit)
2. Delete the installation folder (default: `C:\Program Files\HyperClip`)
3. Delete data folder: `%APPDATA%\HyperClip\`
4. Delete Start Menu shortcut (if created)

---

## Keyboard Shortcuts Reference

| Shortcut | Action |
|----------|--------|
| `Ctrl + ,` | Open Settings |
| `Ctrl + N` | New workspace (manual URL input) |
| `Ctrl + R` | Start render |
| `Space` | Play / Pause (in editor) |
| `← / →` | Seek ±5s (Shift = ±1s) |
| `Ctrl + Q` | Toggle render queue panel |
| `Ctrl + Shift + D` | Toggle dark mode |

---

*Customer Setup Guide v1.0 — For HyperClip v2.x*
