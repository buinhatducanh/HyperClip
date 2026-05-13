# HyperClip - Customer Package

**Customer:** {{CUSTOMER_NAME}}
**Created:** {{CREATED_DATE}}
**By:** {{OPERATOR_USER}} on {{OPERATOR_PC}}

## What's Inside

```
HyperClip-Data/
  app/
    workspaces.json      (empty -- will store your projects)
    channels.json       (your tracked channels)
    seen-videos.json    (dedup cache)
    rendered.json       (render history)
    oauth_tokens.json   (your OAuth tokens)
    oauth_config.json   (OAuth configuration)
    token_stats.json    (quota tracking)
  chrome-profiles/      (30 Chrome sessions -- pre-loaded)
    profile-1/          Session 1 (Chrome Default)
    profile-2/
    ...
    profile-30/
  downloads/           (source videos -- auto-cleaned)
  blur/                (background images -- cached)
  output/              (rendered output during processing)
  archived/           (final rendered videos)
```

All data lives under one root folder -- easy to back up or move.

## Quick Start (Customer)

### 1. Extract the ZIP
Right-click - Extract All - choose any location.

### 2. Set Data Directory

**Option A -- Batch file** (recommended):
Create `HyperClip-Launcher.bat` next to HyperClip.exe:

```
@echo off
set HYPERCLIP_DATA_DIR=<path-to-extracted>\HyperClip-Data
start "" "<path-to-extracted>\HyperClip.exe"
```

**Option B -- Environment variable:**
- Press Win+R - sysdm.cpl - Advanced - Environment Variables - New (User)
- Name: `HYPERCLIP_DATA_DIR`
- Value: `<path-to-extracted>\HyperClip-Data`
- Restart any running apps.

### 3. OAuth Setup (First Time)
1. Open HyperClip - Settings - Google Projects tab
2. Click **Add Project**
3. Enter your Google Cloud project credentials:
   - Client ID
   - Client Secret
   - API Key
4. Click **Connect** - browser opens - sign in with YouTube account
5. Done! Tokens saved automatically.

### 4. Add Channels
Settings - Channels tab - Add YouTube channels to track.

### 5. You're Done!
HyperClip auto-detects new videos every 5 seconds.

## Cookie Expiry

Chrome session cookies are pre-loaded from the operator's Chrome.
Typical lifetime: **2 weeks to 3 months** depending on your Google account activity.

**If detection stops working:**
1. Open your Chrome normally - go to youtube.com - ensure logged in
2. Close Chrome completely
3. In HyperClip - Settings - Chrome Sessions tab - **Clone Session 1**

## Cookie Health

Pre-loaded sessions use SOCS=CAI (auto-consent injection).
All 30 profiles are cloned from Session 1 -- detection works as long as
your YouTube account is active in Chrome.

## Support

Full documentation: `HYPERCLIP_RULES.md` in the project root.
