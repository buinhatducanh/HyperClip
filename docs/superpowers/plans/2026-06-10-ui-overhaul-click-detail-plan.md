# HyperClip — UI Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 4 interconnected UI problems — broken click-to-detail, missing Slot decorator, card/sidebar visual noise, storage detail placeholder.

**Architecture:** Add 2 Rust IPC handlers (`workspace:get`, `rendered:get`) + populate extra Workspace fields. Fix QML signal chain from WorkspaceCard → main.qml. Add `@Slot` to Python model. Clean up QML visuals.

**Tech Stack:** Rust (commands.rs, store.rs), Python (workspace_model.py), QML (7 files)

---

### Task 1: Add `workspace:get` and `rendered:get` IPC handlers (Rust)

**Files:**
- Modify: `crates/hyperclip_ipc/src/store.rs`
- Modify: `src-tauri/src/commands.rs`

- [ ] **Step 1: Add `get` to WorkspaceStore**

In `crates/hyperclip_ipc/src/store.rs`, insert after the `remove` method (~line 120):

```rust
    pub fn get(&self, id: &str) -> Option<&Workspace> {
        self.workspaces.iter().find(|w| w.id == id)
    }
```

- [ ] **Step 2: Add `get` to RenderedStore**

In the same file, insert after `update` (~line 388):

```rust
    pub fn get(&self, id: &str) -> Option<&RenderedVideo> {
        self.videos.iter().find(|v| v.id == id)
    }
```

- [ ] **Step 3: Add extra optional fields to `Workspace` struct**

In the same file, add after `thumbnail_local` (~line 46):

```rust
    #[serde(rename = "fileSize", default)]
    pub file_size: Option<u64>,
    #[serde(rename = "downloadSpeed", default)]
    pub download_speed: Option<String>,
    #[serde(rename = "downloadTime", default)]
    pub download_time: Option<String>,
    #[serde(rename = "durationSec", default)]
    pub duration_sec: Option<u64>,
    #[serde(rename = "quality", default)]
    pub quality: Option<u32>,
    #[serde(rename = "renderFps", default)]
    pub render_fps: Option<f64>,
    #[serde(rename = "renderWorkers", default)]
    pub render_workers: Option<u32>,
    #[serde(rename = "renderPreset", default)]
    pub render_preset: Option<String>,
    #[serde(rename = "renderCodec", default)]
    pub render_codec: Option<String>,
```

- [ ] **Step 4: Add `workspace:get` handler in commands.rs**

In `src-tauri/src/commands.rs`, after the `"workspace:list"` branch (~line 1140):

```rust
        "workspace:get" => {
            let id = p(params, "id").unwrap_or_default();
            let store = WorkspaceStore::load(&get_workspaces_path());
            match store.get(&id) {
                Some(ws) => Ok(json!(ws)),
                None => Ok(json!({"ok": false, "error": "not found", "id": id})),
            }
        }
```

- [ ] **Step 5: Add `rendered:get` handler in commands.rs**

Insert after `"rendered:list"` (~line 1904):

```rust
        "rendered:get" => {
            let id = p(params, "id").unwrap_or_default();
            let store = RenderedStore::load(&get_rendered_videos_path());
            match store.get(&id) {
                Some(v) => Ok(json!(v)),
                None => Ok(json!({"ok": false, "error": "not found", "id": id})),
            }
        }
```

- [ ] **Step 6: Verify Rust build**

Run: `cargo build -p hyperclip-tauri 2>&1 | tail -30`
Expected: Compilation succeeds, no errors or warnings.

---

### Task 2: Fix `update_field` Slot decorator (Python)

**Files:**
- Modify: `src/models/workspace_model.py`

- [ ] **Step 1: Add `Slot` import**

Line 1, add `Slot` to the PySide6 import:

```python
from PySide6.QtCore import QAbstractListModel, QModelIndex, Qt, QByteArray, Slot
```

- [ ] **Step 2: Add decorator to `update_field`**

Before the method at ~line 121, add:

```python
    @Slot(str, str, str, object)
    def update_field(self, workspace_id: str, field: str, value, client=None):
```

The method body stays unchanged.

- [ ] **Step 3: Verify Python syntax**

Run: `python -c "from src.models.workspace_model import WorkspaceModel; print('OK')"`
Expected: Prints "OK"

---

### Task 3: Fix click-to-detail signal chain (QML)

**Files:**
- Modify: `src/ui/qml/WorkspaceCard.qml`
- Modify: `src/ui/qml/WorkspaceQueue.qml`
- Modify: `src/ui/qml/main.qml`
- Modify: `src/ui/qml/DetailEditor.qml`

- [ ] **Step 1: Add signal to WorkspaceCard**

In `src/ui/qml/WorkspaceCard.qml`, add a signal after the property declarations (~line 12):

```qml
    signal workspaceClicked(string ws_id)
```

Replace the `onClicked` handler at line 44-48 with:

```qml
            onClicked: {
                card.workspaceClicked(card.ws_id)
            }
```

- [ ] **Step 2: Wire signal in WorkspaceQueue**

In `src/ui/qml/WorkspaceQueue.qml`, add a signal at line 17:

```qml
    signal openWorkspace(string ws_id)
```

In the delegate section (line 56-67), add `onWorkspaceClicked` handler inside the `WorkspaceCard`:

```qml
                delegate: WorkspaceCard {
                    width: queueList.width
                    ws_id: model.id
                    status: root.passFilter(model.status || "pending", model.title, model.channel_name) ? model.status || "pending" : "hidden"
                    visible: status !== "hidden"
                    height: status === "hidden" ? 0 : 76
                    title: model.title
                    progress: model.progress || 0
                    channel_name: model.channel_name
                    thumbnail: model.thumbnail
                    isShort: model.isShort
                    onWorkspaceClicked: function(id) {
                        root.openWorkspace(id)
                    }
                }
```

- [ ] **Step 3: Handle openWorkspace in main.qml**

In `src/ui/qml/main.qml`, replace the `WorkspaceQueue` block (~line 227-233) with:

```qml
                    WorkspaceQueue {
                        id: queue
                        Layout.fillWidth: true
                        Layout.fillHeight: true
                        globalSearchText: root.globalSearchText
                        channelFilter: root.filterChannelId
                        onOpenWorkspace: function(ws_id) {
                            // Immediate: show detail from model data
                            detailEditor.loadWorkspace(ws_id)
                            root.centerView = "workspace"
                            // Async: fetch full workspace data from Rust backend
                            var resp = backend.send_command("workspace:get", {"id": ws_id})
                            if (resp && resp.ok !== false) {
                                detailEditor.currentWorkspaceData = resp.result
                            }
                        }
                    }
```

Also fix the same pattern for rendered mini list click. Replace the `onClicked` handler at line 208-211 with:

```qml
                                        onClicked: {
                                            detailEditor.loadRendered(model.id)
                                            root.centerView = "rendered"
                                            // Fetch full rendered data
                                            var resp = backend.send_command("rendered:get", {"id": model.id})
                                            if (resp && resp.ok !== false) {
                                                detailEditor.currentRenderedData = resp.result
                                            }
                                        }
```

- [ ] **Step 4: Enhance `loadWorkspace` in DetailEditor**

In `src/ui/qml/DetailEditor.qml`, replace the `loadWorkspace` method (line 28-51) to read more model fields:

```qml
    function loadWorkspace(id) {
        currentWorkspaceId = id
        currentView = "workspace"
        for (let i = 0; i < workspaceModel.rowCount(); i++) {
            const idx = workspaceModel.index(i, 0)
            if (workspaceModel.data(idx, root._roleId) === id) {
                currentWorkspaceData = {
                    "id": id,
                    "title": workspaceModel.data(idx, root._roleTitle) || "",
                    "channel_name": workspaceModel.data(idx, root._roleChannel) || "",
                    "progress": workspaceModel.data(idx, root._roleProgress) || 0,
                    "thumbnail": workspaceModel.data(idx, root._roleThumbnail) || "",
                    "video_id": id,
                }
                return
            }
        }
    }
```

---

### Task 4: Remove 9:16 badge from card (QML)

**Files:**
- Modify: `src/ui/qml/WorkspaceCardDisplay.qml`

- [ ] **Step 1: Delete the Short indicator badge**

In `src/ui/qml/WorkspaceCardDisplay.qml`, remove lines 83-91 (the entire `// Short indicator` Rectangle block). The code to remove:

```qml
            // Short indicator
            Rectangle {
                visible: isShort
                anchors.bottom: parent.bottom; anchors.right: parent.right
                width: 14; height: 14; color: Theme.accent
                Label {
                    anchors.centerIn: parent
                    text: "9:16"; color: "white"; font.pixelSize: 9
                }
            }
```

- [ ] **Step 2: Verify no orphaned references**

Run: `grep -n "isShort" src/ui/qml/WorkspaceCardDisplay.qml`
Expected: Only the `property bool isShort` declaration at line 13 remains, plus usage in the thumbnail width logic at line 64.

---

### Task 5: Fix sidebar text overlap (QML)

**Files:**
- Modify: `src/ui/qml/Sidebar.qml`

- [ ] **Step 1: Fix channel name label max width**

In `src/ui/qml/Sidebar.qml`, at the `Label` showing `model.name` (line 263-270), ensure `elide` is active and add `Layout.maximumWidth`:

```qml
                Label {
                    text: model.name
                    color: model.paused ? Theme.textMuted : Theme.text
                    font.pixelSize: 12
                    font.bold: sideRoot.activeChannelId === model.channelId
                    elide: Text.ElideRight
                    Layout.fillWidth: true
                    Layout.maximumWidth: 100
                }
```

- [ ] **Step 2: Give hover actions fixed width**

At the hover action buttons row (~line 298), add:

```qml
                RowLayout {
                    visible: sideRoot.expanded && rowMa.containsMouse
                    spacing: 2
                    Layout.preferredWidth: 44
```

---

### Task 6: Fix Icon font robustness (QML)

**Files:**
- Modify: `src/ui/qml/Icon.qml`

- [ ] **Step 1: Add font fallback chain**

In `src/ui/qml/Icon.qml`, line 14, change:

```qml
    font.family: "Segoe UI Symbol"
```

To:

```qml
    font.family: "Segoe UI Symbol, Segoe UI, Arial"
```

- [ ] **Step 2: Replace problematic search glyph**

Line 42, change:
```qml
    case "search":   return "⚲"   // ⚲
```
To:
```qml
    case "search":   return "⌕"   // ⌕
```

---

### Task 7: RenderedVideoDetail — real data display (QML)

**Files:**
- Modify: `src/ui/qml/RenderedVideoDetail.qml`

- [ ] **Step 1: Add real thumbnail display**

In `src/ui/qml/RenderedVideoDetail.qml`, replace the 300px black placeholder (lines 50-71) with:

```qml
        // Video preview
        Rectangle {
            Layout.fillWidth: true
            Layout.preferredHeight: 300
            color: "black"
            border.color: Theme.border
            border.width: 1
            clip: true

            Image {
                anchors.fill: parent
                fillMode: Image.PreserveAspectFit
                source: root.videoData.thumbnail || ""
                visible: root.videoData.thumbnail && root.videoData.thumbnail !== ""
            }
            Label {
                anchors.centerIn: parent
                text: root.videoData.thumbnail ? "" : (root.videoData.title || root.videoId || "Chọn video đã render")
                color: Theme.textMuted
                font.pixelSize: 14
                visible: !root.videoData.thumbnail
            }
        }
```

- [ ] **Step 2: Add thumbnail role to RenderedVideoListModel**

In `src/models/rendered_video_list_model.py`, note the `ThumbnailRole` already exists at line 15 and is exposed in `roleNames` at line 54. The `qml_thumbnail` property binding is already present in the mini list (just not used in properties). No change needed here.

- [ ] **Step 3: Wire rendered detail refresh in main.qml**

Already handled in Task 3 Step 3 — the `rendered:get` IPC call populates `currentRenderedData` which RenderedVideoDetail reads reactively.

---

### Task 8: Build and verify

- [ ] **Step 1: Run Rust tests**

Run: `cargo test -p hyperclip-ipc 2>&1 | tail -20`
Expected: 0 failures.

- [ ] **Step 2: Run Clippy**

Run: `cargo clippy -p hyperclip-ipc 2>&1 | tail -20`
Expected: No new warnings.

- [ ] **Step 3: Verify Python loads**

Run: `python -c "from src.models.workspace_model import WorkspaceModel; from src.backend.client import RustClient; print('OK')"`
Expected: "OK"

- [ ] **Step 4: Commit all changes**

```bash
git add -A
git commit -m "fix(ui): overhaul click-to-detail, fix Slot, clean up card/sidebar visuals"
```
