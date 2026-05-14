# HyperClip — Error Code Reference

> **Source of truth:** This document lists all error codes, symptoms, root causes, and fixes for HyperClip.
> **Audience:** Operators and advanced users diagnosing issues.
>
> Error codes use the format: `HC-XXX-CATEGORY` where `XXX` is a 3-digit number and `CATEGORY` describes the system.

---

## Table of Contents

1. [Detection Errors (HC-100)](#1-detection-errors-hc-100)
2. [Download Errors (HC-200)](#2-download-errors-hc-200)
3. [Render Errors (HC-300)](#3-render-errors-hc-300)
4. [Authentication Errors (HC-400)](#4-authentication-errors-hc-400)
5. [Storage Errors (HC-500)](#5-storage-errors-hc-500)
6. [System Errors (HC-600)](#6-system-errors-hc-600)
7. [Network Errors (HC-700)](#7-network-errors-hc-700)
8. [Health Alerts (HC-800)](#8-health-alerts-hc-800)
9. [Quick Diagnosis Guide](#9-quick-diagnosis-guide)

---

## 1. Detection Errors (HC-100)

### HC-101-INNERTUBE

**Symptom:** "No sessions ready — Innertube pool empty"

**Root Cause:**
- Chrome is running and locking the cookie SQLite database
- All 30 Chrome profiles are logged out
- Chrome profile data directory is corrupted

**Fix:**
1. Close Chrome completely (check system tray)
2. In HyperClip Settings → Chrome Sessions → click **"Refresh all sessions"**
3. If still failing: re-extract cookies: `node scripts/extract-cookies.js`

**Log location:** `app.log` — search for `InnertubeClientPool._init`

---

### HC-102-INNERTUBE

**Symptom:** "Session N: SAPISID missing — skipping"

**Root Cause:** Chrome profile N doesn't have the SAPISID cookie (incomplete login or cookie cleared)

**Fix:**
1. Open Chrome profile N: `chrome.exe --profile-directory=Profile.N`
2. Log in to `youtube.com` with a Google account
3. Refresh sessions in HyperClip

---

### HC-103-INNERTUBE

**Symptom:** "Session N: SOCS missing or not CAI"

**Root Cause:** The SOCS consent cookie is missing or not set to `CAI` (advertising consent)

**Fix:**
- **Automatic:** HyperClip automatically injects `SOCS=CAI` at 4 places in the code. If you see this warning, update to the latest version.
- **Manual:** Open Chrome profile N → visit `youtube.com` → accept cookies if prompted

---

### HC-104-INNERTUBE

**Symptom:** "Innertube API returned 401 — session unauthorized"

**Root Cause:** The Google session has expired (PSID or SAPISID no longer valid)

**Fix:**
1. Open Chrome profile → go to `youtube.com`
2. If logged out, re-log in
3. Refresh sessions in HyperClip

---

### HC-105-INNERTUBE

**Symptom:** "Innertube API returned 403 — forbidden"

**Root Cause:** YouTube is blocking this session's IP or the account has a restriction

**Fix:**
1. Check if the Google account is restricted or age-restricted
2. Try a different Google account
3. Check if VPN is active and causing IP blocks

---

### HC-106-INNERTUBE

**Symptom:** "Innertube parse error: unexpected response format"

**Root Cause:** YouTube changed the API response structure (breaking change in youtubei.js)

**Fix:**
1. Update HyperClip: `npm run electron:build`
2. Check `app.log` for the exact parse error
3. Report to operator if latest version still fails

---

### HC-107-INNERTUBE

**Symptom:** "Innertube timeout after 10s — session dead"

**Root Cause:** Network latency, firewall blocking, or YouTube server issues

**Fix:**
1. Check internet connection
2. Check if YouTube is accessible: open `youtube.com` in browser
3. Session auto-recovers after 10s cooldown

---

### HC-108-INNERTUBE

**Symptom:** "Consecutive Innertube errors: X/3 — pool degraded"

**Root Cause:** Multiple sessions returning errors in succession

**Fix:**
- **Automatic:** Pool continues with remaining healthy sessions
- **If persistent:** Restart HyperClip to re-initialize the pool

---

### HC-109-OAUTH

**Symptom:** "OAuth API returned 401 — token expired"

**Root Cause:** The OAuth refresh token has expired or was revoked

**Fix:**
1. Settings → Projects tab
2. Find the project with this error
3. Click **"Re-authorize"** → log in → Allow
4. Token auto-refreshes for 7 days

---

### HC-110-OAUTH

**Symptom:** "OAuth API returned 403 — quota exceeded"

**Root Cause:** The GCP project has hit its 10,000 units/day quota limit

**Fix:**
1. Wait for midnight UTC (quota auto-resets)
2. Or add more GCP projects to distribute the load
3. Check Settings → Projects → quota bar for remaining units

---

### HC-111-OAUTH

**Symptom:** "OAuth API returned 429 — rate limited"

**Root Cause:** Too many API requests from this project

**Fix:**
1. Wait 5-10 minutes for rate limit to clear
2. Reduce poll frequency: Settings → Poller → set interval to 10s
3. Check if another process is consuming the same project's quota

---

### HC-112-OAUTH

**Symptom:** "OAuth: no healthy projects available"

**Root Cause:** All OAuth projects are either exhausted, unauthorized, or have errors

**Fix:**
1. Check Settings → Projects tab — all should be red or orange
2. Re-authorize all projects
3. If all projects are truly exhausted, wait for midnight UTC reset
4. Add new GCP projects as backup

---

### HC-113-CHANNEL

**Symptom:** "Channel X: could not resolve channel ID"

**Root Cause:** Invalid channel URL or handle format

**Fix:**
1. Verify the channel URL format:
   - Valid: `https://www.youtube.com/channel/UCxxxxxxx`
   - Valid: `https://www.youtube.com/@handle`
   - Invalid: `https://www.youtube.com/user/username` (deprecated by YouTube)
2. Try using the channel ID (UC... format) instead

---

### HC-114-CHANNEL

**Symptom:** "Channel X: uploads playlist not found"

**Root Cause:** The channel doesn't have an uploads playlist (rare — usually deleted channels)

**Fix:**
1. Verify the channel still exists on YouTube
2. Remove the channel from HyperClip if it was deleted
3. Check if the channel ID is correct

---

### HC-115-CHANNEL

**Symptom:** "Channel X: video detected but age > 10 minutes"

**Root Cause:** Video was already old when detected (detection delay or first poll)

**Root Cause (first poll):** The age filter allows up to 24h for first poll to capture backlog

**Fix:**
- This is **normal behavior** for first poll (backlog capture)
- After first poll, only videos < 10 minutes old are auto-downloaded
- If it happens repeatedly, check poll interval (should be 5s)

---

### HC-116-CHANNEL

**Symptom:** "Channel X: 0 videos returned — check channel ID"

**Root Cause:** Channel has no public uploads, or channel is private/restricted

**Fix:**
1. Verify the channel is public: open the channel URL in a browser
2. If the channel has no videos, it's expected behavior
3. Check if the channel was deleted or made private

---

### HC-117-DEDUP

**Symptom:** "Video X already in seen set — skipped"

**Root Cause:** Video was already detected and downloaded previously

**Fix:**
- **Normal behavior** — this is the dedup system working correctly
- If you need to re-download the same video:
  1. Open Settings → Channels → find the channel
  2. Click the video in seen-videos list
  3. Click "Forget video" to remove from seen set
  4. Wait for next poll to re-detect

---

### HC-118-POLLER

**Symptom:** "Poller paused — X consecutive errors"

**Root Cause:** The poller has hit the error threshold and paused to prevent spam

**Fix:**
1. Wait 60 seconds — poller auto-resumes
2. If persistent, check Settings → Poller → click **"Resume"**
3. Check `app.log` for the root cause error

---

## 2. Download Errors (HC-200)

### HC-201-YTDLP

**Symptom:** "yt-dlp: no video formats available"

**Root Cause:** YouTube blocking the download request (age-restricted, region-locked, or private video)

**Fix:**
1. Verify the video is public and not age-restricted
2. Try with Chrome cookies: `yt-dlp --cookies cookies.txt <url>`
3. If PO Token is needed, HyperClip automatically handles this

---

### HC-202-YTDLP

**Symptom:** "yt-dlp: HTTP Error 403 — forbidden"

**Root Cause:** Invalid or expired cookies, or YouTube blocking the request

**Fix:**
1. Refresh Chrome sessions: Settings → Chrome Sessions → "Refresh all"
2. Verify at least one session is showing "Ready" (green)
3. If persistent, re-login to YouTube on the Chrome profile

---

### HC-203-YTDLP

**Symptom:** "yt-dlp: HTTP Error 429 — too many requests"

**Root Cause:** IP or account rate limited by YouTube

**Fix:**
1. Wait 5-10 minutes
2. Reduce concurrent downloads: Settings → Quality → set max concurrent to 1
3. Use Direct IP Binding if VPN is causing rate limits

---

### HC-204-YTDLP

**Symptom:** "yt-dlp: video unavailable (removed/private/deleted)"

**Root Cause:** Video was removed by the creator, set to private, or deleted by YouTube

**Fix:**
- **No fix needed** — this is expected for removed content
- The workspace is marked `error` — click **"Retry"** or delete it

---

### HC-205-YTDLP

**Symptom:** "yt-dlp: requested format not available"

**Root Cause:** The requested quality (e.g., 1080p) is not available for this video

**Fix:**
1. Lower download quality: Settings → Quality → set to 720p
2. HyperClip falls back to the highest available quality automatically

---

### HC-206-YTDLP

**Symptom:** "yt-dlp: subprocess crashed with exit code 1"

**Root Cause:** yt-dlp crashed due to memory issues, corrupted video, or bug

**Fix:**
1. Retry the download: click **"Retry"** on the workspace
2. Check RAM usage — close other applications if memory is high
3. Try with lower quality: 720p instead of 1080p

---

### HC-207-YTDLP

**Symptom:** "yt-dlp: could not extract video ID"

**Root Cause:** Malformed video URL passed to yt-dlp

**Fix:**
1. Verify the video URL is correct
2. Check if the URL contains a valid video ID (11 characters)
3. Try with the direct video ID instead of the full URL

---

### HC-208-YTDLP

**Symptom:** "yt-dlp: write failed — disk full"

**Root Cause:** No space left on disk

**Fix:**
1. Free up disk space: delete old videos in `archived/`
2. Move the downloads folder to a larger drive: Settings → Storage
3. Run Disk Cleanup: `cleanmgr /d C`

---

### HC-209-YTDLP

**Symptom:** "yt-dlp: download stalled for 60s"

**Root Cause:** Network interruption, YouTube CDN issue, or VPN blocking

**Fix:**
1. Check internet connection
2. Retry the download
3. If using VPN, try disabling it temporarily
4. Check if YouTube is accessible in a browser

---

### HC-210-YTDLP

**Symptom:** "yt-dlp: post-processing: None — format not supported"

**Root Cause:** The downloaded video format is not supported by FFmpeg

**Fix:**
1. Re-download with `--format bestvideo+bestaudio/best`
2. Lower quality setting
3. Report to operator if persistent

---

### HC-211-PO-TOKEN

**Symptom:** "PO Token: navigation loop detected — aborting"

**Root Cause:** The PO Token refresh is stuck in a redirect loop (CDP navigation issue)

**Fix:**
- **Automatic:** HyperClip automatically falls back to `player_client=web` (no PO Token) when this happens
- Download quality: VP9 DASH 720p-1080p (no PO Token needed)
- No user action needed — this is by design

---

### HC-212-PO-TOKEN

**Symptom:** "PO Token: cache empty after warmup"

**Root Cause:** PO Token warmup failed to populate the cache

**Fix:**
- **Automatic:** Falls back to `player_client=web` without PO Token
- Download quality: VP9 720p-1080p
- This is expected in some environments — no fix needed

---

### HC-213-IP-BINDING

**Symptom:** "yt-dlp: binding to IP X failed"

**Root Cause:** Direct IP Binding requested an unavailable network interface

**Fix:**
1. Check available network interfaces: `ipconfig`
2. Verify the correct IP is configured in Settings
3. Disable Direct IP Binding if not needed: Settings → Quality → uncheck

---

## 3. Render Errors (HC-300)

### HC-301-FFMPEG

**Symptom:** "FFmpeg: encoder not found — h264_nvenc"

**Root Cause:** NVIDIA driver not installed, or GPU doesn't support NVENC

**Fix:**
1. Verify GPU: `nvidia-smi` in command prompt
2. Update NVIDIA driver: download from nvidia.com/drivers
3. Check GPU model: RTX 20/30/40/50 series → full NVENC; GTX series → software only
4. If no NVIDIA GPU: render uses CPU (slow, not recommended)

---

### HC-302-FFMPEG

**Symptom:** "FFmpeg: GPU out of memory"

**Root Cause:** Too many concurrent render workers exhausting GPU VRAM

**Fix:**
1. Settings → Quality → reduce workers from 8 to 4
2. Close other GPU applications (games, other renderers)
3. Check GPU memory: `nvidia-smi` → Memory-Usage column
4. RTX 5080 16GB: max 8 workers; RTX 4060 8GB: max 4 workers

---

### HC-303-FFMPEG

**Symptom:** "FFmpeg: CUDA error — no CUDA-capable device"

**Root Cause:** CUDA toolkit or driver version mismatch

**Fix:**
1. Update NVIDIA driver to latest version
2. Verify CUDA: `nvidia-smi` → should show CUDA version
3. If using laptop with NVIDIA Optimus: ensure NVENC is on the dedicated GPU

---

### HC-304-FFMPEG

**Symptom:** "FFmpeg: encode failed with exit code 1"

**Root Cause:** Generic FFmpeg failure — could be corrupted source, bad parameters, or GPU crash

**Fix:**
1. Cancel the render
2. Try re-downloading the source video
3. Check `app.log` for the specific FFmpeg error message
4. If GPU-related, restart HyperClip and try again

---

### HC-305-FFMPEG

**Symptom:** "FFmpeg: seek failed — invalid seeking"

**Root Cause:** The source video is corrupted or in an unsupported format

**Fix:**
1. Delete the workspace and re-download the video
2. Try with 480p quality (more tolerant of format issues)
3. Verify the video plays in a standard media player (VLC)

---

### HC-306-FFMPEG

**Symptom:** "FFmpeg: output file exists — not overwriting"

**Root Cause:** A file with the same name already exists in the output location

**Fix:**
1. Change the output filename in the editor
2. Or manually delete the existing file in `archived/`
3. Enable "Overwrite" in render settings if preferred

---

### HC-307-FFMPEG

**Symptom:** "FFmpeg: output directory not writable"

**Root Cause:** Permission denied on the output folder

**Fix:**
1. Check folder permissions: right-click `archived/` → Properties → Security
2. Ensure HyperClip has write permission
3. Run HyperClip as Administrator if needed
4. Change output folder to a user-writable location

---

### HC-308-FFMPEG

**Symptom:** "FFmpeg: codec not supported — hevc_nvenc"

**Root Cause:** GPU doesn't support HEVC NVENC encoding

**Fix:**
1. Settings → Quality → change codec to H.264
2. H.264 NVENC is supported on all RTX/GTX GPUs
3. HEVC NVENC requires Maxwell (GTX 950+) or newer

---

### HC-309-WORKER

**Symptom:** "Worker pool: all workers dead — no render available"

**Root Cause:** All FFmpeg worker processes crashed simultaneously

**Fix:**
1. Restart HyperClip
2. Check GPU temperatures: `nvidia-smi` → Temperature column (should be < 85°C)
3. Reduce worker count to prevent overheating
4. Check if GPU is throttling due to heat

---

### HC-310-BLUR

**Symptom:** "Blur: could not generate blur background"

**Root Cause:** Source video frame extraction failed

**Fix:**
1. Verify the source video file exists and is readable
2. Try with a different source video
3. Disable blur background: Editor → Background → "None"

---

### HC-311-OVERLAY

**Symptom:** "Overlay: image file not found"

**Root Cause:** The overlay image path is broken or the file was deleted

**Fix:**
1. Re-add the overlay image in the editor
2. Check if the image file still exists on disk
3. Use absolute paths for overlay images if moving files

---

### HC-312-CHUNK

**Symptom:** "Chunked render: chunk N failed — stitch may be incomplete"

**Root Cause:** One chunk of a chunked render failed

**Fix:**
1. Cancel the render
2. Retry — chunked rendering re-renders failed chunks automatically
3. If persistent, disable chunked rendering: Settings → Quality → uncheck

---

## 4. Authentication Errors (HC-400)

### HC-401-OAUTH

**Symptom:** "OAuth: client ID not found in request"

**Root Cause:** Incorrect or malformed OAuth client ID in project config

**Fix:**
1. Settings → Projects → find the project
2. Re-enter the client ID from the Google Cloud Console
3. Verify the client ID ends with `.apps.googleusercontent.com`

---

### HC-402-OAUTH

**Symptom:** "OAuth: invalid_client — no client secret"

**Root Cause:** Client secret not provided or incorrect

**Fix:**
1. Settings → Projects → edit the project
2. Re-enter the client secret from the OAuth JSON file
3. Download fresh credentials from Google Cloud Console

---

### HC-403-OAUTH

**Symptom:** "OAuth: redirect_uri_mismatch"

**Root Cause:** The redirect URI configured in Google Cloud Console doesn't match HyperClip's callback URL

**Fix:**
1. Go to Google Cloud Console → APIs & Services → Credentials
2. Edit the OAuth client
3. Add redirect URI: `http://localhost:8080/callback`
4. Save and re-authorize the project

---

### HC-404-OAUTH

**Symptom:** "OAuth: access_denied — user cancelled"

**Root Cause:** User clicked "Cancel" during the OAuth authorization flow

**Fix:**
1. Retry authorization: Settings → Projects → "Authorize"
2. Ensure you're logging in with the correct Gmail account

---

### HC-405-OAUTH

**Symptom:** "OAuth: token refresh failed — invalid_grant"

**Root Cause:** The refresh token was revoked (password changed, account deleted, or token manually revoked)

**Fix:**
1. Settings → Projects → find the project
2. Click **"Re-authorize"** to get a new refresh token
3. Log in with the same Gmail account as before

---

### HC-406-CHROME

**Symptom:** "Chrome profile N: database locked"

**Root Cause:** Chrome is currently running and locking the cookie database

**Fix:**
1. **Close Chrome completely** (all instances)
2. Check system tray (bottom-right) for Chrome icons
3. Run `taskkill /IM chrome.exe /F` to force-close
4. Refresh sessions in HyperClip

---

### HC-407-CHROME

**Symptom:** "Chrome profile N: cookies.json not found"

**Root Cause:** The cookie extraction failed or was never run for this profile

**Fix:**
1. Run cookie extraction: `node scripts/extract-cookies.js`
2. Verify profile exists: check `HyperClip-Data/chrome-profiles/profile-N/`
3. If missing, re-login to Chrome and re-extract

---

### HC-408-CHROME

**Symptom:** "Chrome profile N: DPAPI decryption failed"

**Root Cause:** Windows DPAPI encryption issue (usually after system restore or user profile change)

**Fix:**
1. Close Chrome
2. Re-login to YouTube on Chrome profile N
3. Re-run cookie extraction: `node scripts/extract-cookies.js`
4. If persistent, the Windows user profile may need recreation

---

### HC-409-SOCS

**Symptom:** "SOCS cookie is not CAI — consent injection may have failed"

**Root Cause:** SOCS injection didn't work (edge case)

**Fix:**
1. Update to the latest HyperClip version (SOCS injection is built-in)
2. Manually accept cookies on YouTube: open `youtube.com` → accept the consent banner
3. Re-extract cookies after accepting consent

---

## 5. Storage Errors (HC-500)

### HC-501-STORAGE

**Symptom:** "Storage: free space < 5GB — pausing downloads"

**Root Cause:** Disk is nearly full

**Fix:**
1. Free up disk space immediately:
   - Delete old videos in `archived/`
   - Clear browser cache
   - Run `cleanmgr /d C`
2. Move HyperClip data to a larger drive: Settings → Storage → change paths
3. After freeing space, downloads auto-resume

---

### HC-502-STORAGE

**Symptom:** "Storage: workspace file not found"

**Root Cause:** The video file was manually deleted, or the path changed

**Fix:**
1. Check if the file exists at the stored path
2. If file was moved, update the workspace path manually
3. If file was deleted, re-download: click **"Retry"** on the workspace

---

### HC-503-STORAGE

**Symptom:** "Storage: could not create directory"

**Root Cause:** Permission denied or path too long

**Fix:**
1. Run HyperClip as Administrator
2. Check the parent directory exists and is writable
3. Verify the path length < 260 characters (Windows path limit)

---

### HC-504-STORAGE

**Symptom:** "Storage: JSON parse error in workspace.json"

**Root Cause:** The workspaces store file is corrupted

**Fix:**
1. **Backup first:** copy `workspaces.json` to a safe location
2. Try to open the JSON in a text editor to find the error location
3. If corrupted beyond repair, HyperClip will create a fresh file
4. Some workspace history may be lost

---

### HC-505-STORAGE

**Symptom:** "Storage: seen-videos.json too large (> 10,000 entries)"

**Root Cause:** The seen-videos deduplication file has grown too large

**Fix:**
- **Automatic:** HyperClip caps seen-videos at 10,000 entries
- Older entries are pruned automatically (FIFO)
- No user action needed — this is self-managing

---

### HC-506-STORAGE

**Symptom:** "Storage: RAM disk not available — falling back to disk"

**Root Cause:** RAM disk software not installed or RAM disk failed

**Fix:**
- **No action needed** — HyperClip falls back to disk automatically
- Download/render will be slower without RAM disk
- To enable RAM disk: install imdisk or similar software

---

## 6. System Errors (HC-600)

### HC-601-SYSTEM

**Symptom:** "GPU not detected — using software encoding"

**Root Cause:** NVIDIA GPU not found, driver not installed, or CUDA not available

**Fix:**
1. Check GPU: `nvidia-smi` — if not found, install NVIDIA driver
2. If using laptop with Optimus: ensure the dedicated GPU is set as default
3. If no NVIDIA GPU: software encoding (x264) is used but **much slower**
4. Minimum recommendation: GTX 1650 or RTX 3050 for hardware encoding

---

### HC-602-SYSTEM

**Symptom:** "GPU temperature critical — throttling render"

**Root Cause:** GPU temperature exceeded safe threshold (> 90°C)

**Fix:**
1. Stop rendering immediately
2. Improve case airflow: add fans, clean dust
3. Undervolt GPU if possible: MSI Afterburner
4. Monitor temperature: `nvidia-smi -l 1` → watch Temperature column
5. **Do not render** until temperature is below 85°C

---

### HC-603-SYSTEM

**Symptom:** "Out of memory — render cancelled"

**Root Cause:** System RAM exhausted by multiple render workers + other apps

**Fix:**
1. Close other applications to free RAM
2. Reduce render worker count: Settings → Quality → workers from 8 to 4
3. Check RAM usage: Task Manager → Memory column
4. Minimum 16 GB RAM recommended; 32 GB for 8 workers

---

### HC-604-SYSTEM

**Symptom:** "HyperClip crashed — exit code X"

**Root Cause:** Unhandled exception in the Electron main process

**Fix:**
1. Check `%APPDATA%\HyperClip\crash.log` for the crash details
2. Restart HyperClip
3. If crashes repeatedly, run `npm run electron:dev` to see verbose error output
4. Report crash details to operator with `app.log` attached

---

### HC-605-SYSTEM

**Symptom:** "Window failed to load — blank screen"

**Root Cause:** Next.js app failed to load (port 3000 blocked, build issue, or missing files)

**Fix:**
1. Check if port 3000 is in use: `netstat -ano | findstr :3000`
2. Kill conflicting process or change HyperClip's port
3. Rebuild: `npm run electron:build`
4. Delete `.next` cache: `Remove-Item -Recurse -Force .next` and rebuild

---

### HC-606-SYSTEM

**Symptom:** "IPC: channel not found — renderer cannot communicate with main"

**Root Cause:** Incompatibility between renderer and main process versions

**Fix:**
1. Ensure HyperClip is fully updated
2. Rebuild: `npm run electron:build`
3. If developing: run `npm run electron:dev` to sync versions

---

## 7. Network Errors (HC-700)

### HC-701-NETWORK

**Symptom:** "Network: connection lost — pausing poller"

**Root Cause:** No internet connection detected

**Fix:**
1. Check internet: open `youtube.com` in browser
2. Re-enable network adapter if disabled
3. HyperClip auto-resumes when connection is restored
4. No videos are missed during the outage (poller resumes)

---

### HC-702-NETWORK

**Symptom:** "Network: DNS resolution failed for youtube.com"

**Root Cause:** DNS server issue or YouTube's DNS blocked

**Fix:**
1. Try: `ipconfig /flushdns` in command prompt
2. Change DNS: use Google DNS (8.8.8.8, 8.8.4.4)
3. Check if YouTube is accessible in browser

---

### HC-703-NETWORK

**Symptom:** "Network: SSL certificate error — secure connection failed"

**Root Cause:** Corporate firewall, antivirus, or proxy interfering with HTTPS

**Fix:**
1. Check if a corporate proxy is active
2. Try disabling VPN temporarily
3. Temporarily disable SSL inspection in antivirus (not recommended for security in general, but necessary for some corporate environments)
4. Report to IT if this is a corporate environment

---

### HC-704-NETWORK

**Symptom:** "Network: proxy authentication required"

**Root Cause:** Corporate proxy needs login credentials

**Fix:**
1. Configure proxy in Windows: Settings → Network → Proxy
2. Or set environment variables:
   ```powershell
   $env:HTTP_PROXY = "http://proxy:8080"
   $env:HTTPS_PROXY = "http://proxy:8080"
   ```
3. Report to IT for corporate proxy credentials

---

### HC-705-NETWORK

**Symptom:** "Innertube: proxy blocked — session N dead"

**Root Cause:** VPN or proxy is blocking YouTube Innertube requests

**Fix:**
1. If using VPN, try a different VPN server or disable VPN
2. Some VPN providers block YouTube Innertube
3. Ensure the VPN supports Google/YouTube services

---

## 8. Health Alerts (HC-800)

These are informational alerts, not errors. HyperClip monitors these conditions and notifies you.

### HC-801-ALERT

**Symptom:** "Health Alert: Innertube pool empty — all sessions dead"

**Severity:** Critical

**Condition:** 0/30 sessions show "Ready" status for 3+ consecutive polls

**Fix:** See [HC-101-INNERTUBE](#hc-101-innertube)

---

### HC-802-ALERT

**Symptom:** "Health Alert: OAuth quota running low — all projects < 10%"

**Severity:** Warning

**Condition:** All OAuth projects have < 10% quota remaining

**Fix:**
1. Wait for midnight UTC reset (automatic)
2. Add more GCP projects as backup
3. Monitor usage in Settings → Projects

---

### HC-803-ALERT

**Symptom:** "Health Alert: OAuth quota exhausted — switching to Chrome-only"

**Severity:** Critical

**Condition:** All OAuth projects are exhausted (0 units remaining)

**Fix:**
1. Wait for midnight UTC reset (automatic)
2. Detection continues via Chrome sessions (Innertube)
3. OAuth is backup-only — no detection loss expected

---

### HC-804-ALERT

**Symptom:** "Health Alert: Low disk space — < 5GB free"

**Severity:** Critical

**Condition:** Free disk space < 5GB

**Fix:** See [HC-501-STORAGE](#hc-501-storage)

---

### HC-805-ALERT

**Symptom:** "Health Alert: Download failures — 3+ consecutive errors"

**Severity:** Warning

**Condition:** 3+ consecutive download failures

**Fix:**
1. Check internet connection
2. Check YouTube accessibility
3. Review `app.log` for specific download errors
4. After 3 successes, this alert clears automatically

---

### HC-806-ALERT

**Symptom:** "Health Alert: No new videos detected in 24 hours"

**Severity:** Warning

**Condition:** Zero videos detected in the past 24 hours

**Fix:**
1. Verify channels are still active (post videos regularly)
2. Check Settings → Channels — ensure channels are added
3. Check Settings → Chrome Sessions — sessions should be green
4. This alert clears when a new video is detected

---

## 9. Quick Diagnosis Guide

### Detection Not Working

```
1. Are sessions ready?     → Settings → Chrome Sessions → 30/30 green?
   └─ NO  → HC-101, HC-406, HC-407
   └─ YES → continue
2. Is poller active?      → Sidebar shows "Active"?
   └─ NO  → HC-118
   └─ YES → continue
3. Are channels added?    → Settings → Channels → channels listed?
   └─ NO  → Add channels
   └─ YES → continue
4. Check app.log          → search for "detect" or "poll"
```

### Download Not Working

```
1. Is video public?       → Open URL in browser
   └─ NO  → HC-204
   └─ YES → continue
2. Are sessions ready?    → HC-101 check
   └─ NO  → Fix sessions first
   └─ YES → continue
3. Is quota exhausted?     → Settings → Projects → all red?
   └─ YES → Wait for midnight UTC
   └─ NO  → HC-201, HC-202, HC-203, HC-209
```

### Render Not Working

```
1. Is GPU detected?       → Settings → System → GPU: "NVIDIA RTX..."
   └─ NO  → HC-601
   └─ YES → continue
2. Is GPU temp OK?        → nvidia-smi → temp < 85°C
   └─ NO  → HC-602
   └─ YES → continue
3. Is RAM sufficient?     → Task Manager → Memory < 90%
   └─ NO  → HC-603
   └─ YES → continue
4. Check app.log          → search for "FFmpeg" or "render"
```

### Collect Logs for Support

```powershell
$date = Get-Date -Format 'yyyyMMdd-HHmmss'
$logs = @(
    "$env:APPDATA\HyperClip\HyperClip-Data\logs\app.log",
    "$env:APPDATA\HyperClip\HyperClip-Data\logs\detection.log",
    "$env:APPDATA\HyperClip\HyperClip-Data\logs\render.log",
    "$env:APPDATA\HyperClip\app.log",
    "$env:APPDATA\HyperClip\crash.log"
)
$out = "$env:TEMP\hyperclip-debug-$date.zip"
Compress-Archive $logs -DestinationPath $out -ErrorAction SilentlyContinue
Write-Host "Logs saved to: $out"
```

---

## Error Code Quick Reference

| Code | Category | Severity | Description |
|------|----------|----------|-------------|
| HC-101 | INNERTUBE | Critical | No sessions ready |
| HC-102 | INNERTUBE | Warning | SAPISID missing |
| HC-103 | INNERTUBE | Warning | SOCS missing |
| HC-104 | INNERTUBE | Error | 401 unauthorized |
| HC-105 | INNERTUBE | Error | 403 forbidden |
| HC-106 | INNERTUBE | Error | Parse error |
| HC-107 | INNERTUBE | Warning | Timeout |
| HC-108 | INNERTUBE | Warning | Pool degraded |
| HC-109 | OAUTH | Error | Token expired (401) |
| HC-110 | OAUTH | Error | Quota exceeded (403) |
| HC-111 | OAUTH | Warning | Rate limited (429) |
| HC-112 | OAUTH | Critical | No healthy projects |
| HC-113 | CHANNEL | Error | Invalid channel ID |
| HC-114 | CHANNEL | Warning | No uploads playlist |
| HC-115 | CHANNEL | Info | Video too old |
| HC-116 | CHANNEL | Warning | 0 videos returned |
| HC-117 | DEDUP | Info | Already seen |
| HC-118 | POLLER | Warning | Poller paused |
| HC-201 | YTDLP | Error | No formats |
| HC-202 | YTDLP | Error | 403 forbidden |
| HC-203 | YTDLP | Warning | 429 rate limited |
| HC-204 | YTDLP | Error | Video unavailable |
| HC-205 | YTDLP | Warning | Format unavailable |
| HC-206 | YTDLP | Error | Subprocess crashed |
| HC-207 | YTDLP | Error | Could not extract ID |
| HC-208 | YTDLP | Critical | Disk full |
| HC-209 | YTDLP | Warning | Download stalled |
| HC-210 | YTDLP | Warning | Format not supported |
| HC-211 | PO-TOKEN | Info | Navigation loop |
| HC-212 | PO-TOKEN | Info | Cache empty |
| HC-213 | IP-BINDING | Warning | Bind failed |
| HC-301 | FFMPEG | Error | Encoder not found |
| HC-302 | FFMPEG | Error | GPU OOM |
| HC-303 | FFMPEG | Error | CUDA not available |
| HC-304 | FFMPEG | Error | Encode failed |
| HC-305 | FFMPEG | Error | Seek failed |
| HC-306 | FFMPEG | Warning | File exists |
| HC-307 | FFMPEG | Error | Not writable |
| HC-308 | FFMPEG | Warning | Codec not supported |
| HC-309 | WORKER | Critical | All workers dead |
| HC-310 | BLUR | Error | Generate failed |
| HC-311 | OVERLAY | Error | Image not found |
| HC-312 | CHUNK | Warning | Chunk failed |
| HC-401 | OAUTH | Error | Client ID not found |
| HC-402 | OAUTH | Error | No client secret |
| HC-403 | OAUTH | Error | URI mismatch |
| HC-404 | OAUTH | Warning | Access denied |
| HC-405 | OAUTH | Error | Invalid grant |
| HC-406 | CHROME | Error | DB locked |
| HC-407 | CHROME | Error | Cookies not found |
| HC-408 | CHROME | Error | DPAPI failed |
| HC-409 | SOCS | Warning | Not CAI |
| HC-501 | STORAGE | Critical | Disk full |
| HC-502 | STORAGE | Error | File not found |
| HC-503 | STORAGE | Error | Cannot create dir |
| HC-504 | STORAGE | Error | JSON parse error |
| HC-505 | STORAGE | Warning | Seen-videos too large |
| HC-506 | STORAGE | Warning | RAM disk unavailable |
| HC-601 | SYSTEM | Warning | GPU not detected |
| HC-602 | SYSTEM | Critical | GPU overheating |
| HC-603 | SYSTEM | Error | Out of memory |
| HC-604 | SYSTEM | Critical | Crash |
| HC-605 | SYSTEM | Error | Blank screen |
| HC-606 | SYSTEM | Error | IPC channel missing |
| HC-701 | NETWORK | Warning | Connection lost |
| HC-702 | NETWORK | Warning | DNS failed |
| HC-703 | NETWORK | Warning | SSL error |
| HC-704 | NETWORK | Warning | Proxy auth |
| HC-705 | NETWORK | Warning | VPN blocked |
| HC-801 | ALERT | Critical | Innertube dead |
| HC-802 | ALERT | Warning | Quota low |
| HC-803 | ALERT | Critical | Quota exhausted |
| HC-804 | ALERT | Critical | Disk low |
| HC-805 | ALERT | Warning | Download fails |
| HC-806 | ALERT | Warning | No videos 24h |

---

*Error Code Reference v1.0 — For HyperClip v2.x*
