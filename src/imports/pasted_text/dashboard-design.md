Design a **high-performance, minimalist web application dashboard** for a **Real-Time Auto-Render Vertical Video System (YouTube → TikTok/Reels)**.

This is NOT a simple editor.
This is a **real-time automation pipeline + workspace editing system** for a **single power user**.

The UI must strongly reflect:

* Speed
* Automation
* Zero friction
* System transparency
* Real-time feedback

The experience should feel like:
👉 A mix of a **CI/CD developer dashboard**, a **video editor**, and a **high-performance internal tool**

---

# 🎨 THEME & STYLE

* Dark Mode:

  * Background: #121212
  * Surfaces: #1E1E1E
* Accent Color: Electric Blue OR Neon Green (ONLY for primary/active elements)
* Typography: Inter or Roboto
* Flat design only:

  * NO heavy shadows
  * NO gradients
  * NO decorative UI
* High data density, clean spacing
* Prioritize readability and speed

---

# 🧩 GLOBAL LAYOUT (3-PANE SPLIT)

1. Left Sidebar → Navigation + System Monitor
2. Center Area → Workspace Pipeline (CORE SYSTEM)
3. Right Panel → Editor Workspace

---

# 📌 1. LEFT SIDEBAR (Navigation + System Monitor)

## Top: Navigation (Icon-only)

* Dashboard (Active)
* Workspaces
* Settings

Minimal, evenly spaced icons.

---

## Bottom: SYSTEM MONITOR (CRITICAL – MUST FEEL REAL)

Display real hardware/system state:

* RAM Disk: "12GB / 32GB" + subtle progress bar
* GPU: "NVENC Ready" / "Rendering"
* Network: "Direct Route IP (Bypass VPN)"
* Workers: "3 Active"

### Behavior:

* When rendering → GPU indicator glows subtly
* Worker count updates dynamically
* System should feel like a **live machine dashboard**

---

# 🧠 2. CENTER AREA – WORKSPACE PIPELINE (CORE UX)

## 🔝 TOP INPUT BAR

* Large input:
  "Paste YouTube URL / Channel..."
* Dropdown:
  "Auto-Trim: Max 10 Min"
  Options: 5 Min / 10 Min / Full
* Primary Button:
  "+ Add Tracker"

---

## 📦 WORKSPACE QUEUE PANEL

Display **video workspaces (NOT channels)**

---

## 🧩 WORKSPACE GROUPING (IMPORTANT)

Group by status:

* 🟢 Ready (highlighted)
* 🔴 Rendering
* 🔵 Downloading
* 🟡 Waiting
* ✅ Done (collapsible)

---

## 🧱 WORKSPACE CARD DESIGN

Each card includes:

* Thumbnail (optional)
* Video Title
* Channel Name
* Duration
* Trim Limit (e.g., 10 min)

### Status Badge (color-coded):

* 🟡 Waiting
* 🔵 Downloading (with subtle progress)
* 🟢 Ready (glow highlight)
* 🟣 Editing
* 🔴 Rendering (progress bar %)
* ✅ Done

---

## ⚡ CARD INTERACTIONS (VERY IMPORTANT)

* Click card → instantly open in Editor (no page reload)
* Hover:

  * Show quick actions (Open / Settings)
* New video:

  * Show "NEW" badge
  * Auto-highlight
  * Optionally auto-scroll into view

---

## 🔄 REAL-TIME BEHAVIOR

* Status updates automatically (no refresh)
* Smooth transitions between states
* Progress bars update live
* UI must feel “alive”

---

# 🎬 3. RIGHT PANEL – EDITOR WORKSPACE

---

## 🎥 TOP: VIDEO CANVAS

* Large vertical 9:16 frame
* Inside:

  * Centered 16:9 video
  * Blurred static background (top & bottom)

Ultra clean:

* No heavy controls overlaying video

---

## 🎛 BOTTOM: EDIT CONTROLS (STRICT ORDER)

---

### 1. Trim Video

* Dual-handle slider
* Show start/end timestamps

---

### 2. Background Panel

* Button: "Regenerate Blur"
* Option: "Upload Custom Image"

---

### 3. Speed Modifier

Segmented buttons:
[1.0x] [1.1x] [1.2x] [1.5x]

---

### 4. Text & Overlays

* Text input
* Minimal font selector
* Color picker
* Add Text button

---

### 5. Image / Thumbnail Overlay (IMPORTANT)

* Upload image
* Position (top / bottom)
* Toggle visibility

---

### 6. Export Settings

* Radio buttons:
  [1080p] [720p]

---

## ⚡ PRIMARY ACTION (BOTTOM)

FULL-WIDTH BUTTON:

"⚡ RENDER VIDEO"

* Bright accent color
* Highest visual priority
* Slight glow

---

# 🔁 4. FLOATING RENDER QUEUE (BOTTOM BAR)

Collapsible floating bar showing active renders:

Each item:

* Video Title
* Progress bar (%)
* Status

---

## 🔥 ADVANCED:

* Show multi-worker execution:

  * Worker 1: Rendering (45%)
  * Worker 2: Queued

* Real-time progress updates

---

# 🔔 5. NOTIFICATION SYSTEM

Minimal toast notifications:

* New video detected
* Workspace ready
* Render complete
* Error occurred

### Behavior:

* Appear top-right
* Auto dismiss
* Click → focus related workspace

---

# ❗ 6. ERROR STATES (MANDATORY)

Handle failures clearly:

---

### Download Fail:

"⚠ Failed to fetch video"
[Retry]

---

### Render Fail:

"❌ Render failed"
[Re-render]

---

### Network Issue:

"⚠ Network unstable"

---

# 🧘 7. EMPTY STATES

When no data:

" No videos yet
Add a channel to start automation "

---

# ⚙️ 8. UX PRINCIPLES

* Zero clutter
* Everything is actionable
* No unnecessary clicks
* Instant feedback
* Real-time system feel

---

# 🎯 FINAL GOAL

The user should feel:

"I am operating a real-time automated video factory powered by my machine."
