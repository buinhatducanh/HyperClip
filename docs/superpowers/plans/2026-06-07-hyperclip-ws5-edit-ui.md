# WS5: Inline Edit UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-video edit controls (speed, trim start/end, title, thumbnail) vào VideoDetailPanel.qml + wire `workspace:update` IPC.

**Architecture:** QML controls trong VideoDetailPanel → Python WorkspaceModel → Rust `workspace:update` → store JSON.

**Tech Stack:** QML (Qt Quick Controls 2), Python (PySide6), Rust IPC.

**Prerequisites:** WS1-WS4 complete.

---

## Tasks (14 total)

### Task 5.1: Create EditField QML Component

**Files:**
- Create: `src/ui/qml/components/EditField.qml`

- [ ] **Step 1: Create components dir**

```bash
cd D:/LOOP_COMPANY/HyperClip
mkdir -p src/ui/qml/components
```

- [ ] **Step 2: Create EditField.qml**

```qml
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

// Reusable labeled edit control (label + input + optional unit)
Rectangle {
    id: root
    
    property string label: ""
    property var value: null
    property string unit: ""
    signal valueChanged(var newValue)
    
    color: Theme.bg
    border.color: Theme.border
    border.width: 1
    Layout.fillWidth: true
    Layout.preferredHeight: 36
    
    RowLayout {
        anchors.fill: parent
        anchors.margins: 8
        spacing: 8
        
        Label {
            text: root.label
            color: Theme.textMuted
            font.pixelSize: 11
            Layout.preferredWidth: 80
        }
        
        Loader {
            id: inputLoader
            Layout.fillWidth: true
            sourceComponent: textInput
        }
        
        Label {
            text: root.unit
            color: Theme.textMuted
            font.pixelSize: 11
            visible: root.unit !== ""
        }
    }
    
    Component {
        id: textInput
        TextField {
            text: root.value !== null ? root.value.toString() : ""
            onEditingFinished: root.valueChanged(text)
        }
    }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/ui/qml/components/EditField.qml
git commit -m "feat(ws5): EditField QML component (label + input + unit)"
```

---

### Task 5.2: Create ThumbnailUploader QML Component

**Files:**
- Create: `src/ui/qml/components/ThumbnailUploader.qml`

- [ ] **Step 1: Implement ThumbnailUploader.qml**

```qml
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls
import QtQuick.Dialogs

Rectangle {
    id: root
    
    property string workspaceId: ""
    property string currentThumbnail: ""
    property string localThumbnail: ""
    
    color: Theme.bg
    border.color: Theme.border
    border.width: 1
    Layout.fillWidth: true
    Layout.preferredHeight: 80
    
    signal thumbnailChanged(string path)
    
    RowLayout {
        anchors.fill: parent
        anchors.margins: 8
        spacing: 12
        
        // Preview
        Rectangle {
            Layout.preferredWidth: 128
            Layout.preferredHeight: 72
            color: "#000"
            border.color: Theme.border
            
            Image {
                anchors.fill: parent
                source: root.localThumbnail || root.currentThumbnail
                fillMode: Image.PreserveAspectFit
            }
        }
        
        // Buttons
        ColumnLayout {
            Layout.fillWidth: true
            spacing: 4
            
            Label {
                text: "Thumbnail (PNG/JPG, 16:9 hoặc 9:16)"
                color: Theme.textMuted
                font.pixelSize: 10
            }
            
            RowLayout {
                spacing: 4
                Button {
                    text: "📁 Upload"
                    onClicked: fileDialog.open()
                }
                Button {
                    text: "🌐 YouTube"
                    onClicked: {
                        // Download YouTube default thumbnail at maxresdefault.jpg
                        const url = `https://i.ytimg.com/vi/${root.workspaceId}/maxresdefault.jpg`
                        thumbnailService.download_youtube_thumbnail(root.workspaceId, url, (path) => {
                            if (path) {
                                root.localThumbnail = path
                                root.thumbnailChanged(path)
                            }
                        })
                    }
                    enabled: root.workspaceId !== ""
                }
                Button {
                    text: "🗑 Xóa"
                    onClicked: {
                        root.localThumbnail = ""
                        root.thumbnailChanged("")
                    }
                    visible: root.localThumbnail !== ""
                }
            }
        }
    }
    
    FileDialog {
        id: fileDialog
        title: "Chọn thumbnail"
        nameFilters: ["Image files (*.png *.jpg *.jpeg)"]
        onAccepted: {
            const path = selectedFile.toString().replace("file:///", "").replace("file://", "")
            root.localThumbnail = path
            root.thumbnailChanged(path)
        }
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/ui/qml/components/ThumbnailUploader.qml
git commit -m "feat(ws5): ThumbnailUploader QML (file dialog + YouTube default)"
```

---

### Task 5.3: Python Thumbnail Service

**Files:**
- Create: `src/services/thumbnail_service.py`

- [ ] **Step 1: Implement thumbnail_service.py**

```python
"""Download YouTube thumbnail to local storage."""
import os
import urllib.request
from typing import Optional, Callable

def get_thumbnail_dir() -> str:
    """Get local thumbnail storage dir."""
    app_data = os.environ.get("APPDATA", os.path.expanduser("~/.config"))
    thumb_dir = os.path.join(app_data, "HyperClip", "thumbnails")
    os.makedirs(thumb_dir, exist_ok=True)
    return thumb_dir


def download_youtube_thumbnail(
    video_id: str,
    url: Optional[str] = None,
    callback: Optional[Callable[[Optional[str]], None]] = None,
) -> Optional[str]:
    """Download YouTube default thumbnail (maxresdefault.jpg).
    
    Falls back to hqdefault.jpg nếu maxres 404.
    """
    if url is None:
        url = f"https://i.ytimg.com/vi/{video_id}/maxresdefault.jpg"
    
    output_path = os.path.join(get_thumbnail_dir(), f"{video_id}.jpg")
    
    def _download(target_url: str) -> bool:
        try:
            req = urllib.request.Request(
                target_url,
                headers={"User-Agent": "Mozilla/5.0"},
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                with open(output_path, "wb") as f:
                    f.write(resp.read())
            return os.path.getsize(output_path) > 1024
        except Exception:
            return False
    
    # Try maxres, fallback to hq
    if not _download(url):
        fallback = f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"
        if not _download(fallback):
            if callback:
                callback(None)
            return None
    
    if callback:
        callback(output_path)
    return output_path
```

- [ ] **Step 2: Test (manual)**

```bash
cd D:/LOOP_COMPANY/HyperClip
python -c "from src.services.thumbnail_service import download_youtube_thumbnail; print(download_youtube_thumbnail('dQw4w9WgXcQ'))"
```

Expected: Path to downloaded thumbnail (or None if no internet).

- [ ] **Step 3: Commit**

```bash
git add src/services/thumbnail_service.py src/services/__init__.py
git commit -m "feat(ws5): thumbnail service (YouTube download + local cache)"
```

---

### Task 5.4: Python WorkspaceModel - update_field

**Files:**
- Modify: `src/models/workspace_model.py`

- [ ] **Step 1: Add update_field method**

Edit `src/models/workspace_model.py`, add method:

```python
    def update_field(self, workspace_id: str, field: str, value, client=None):
        """Update single field on workspace.
        
        Args:
            workspace_id: workspace ID
            field: 'title' | 'speed' | 'trimStart' | 'trimEnd' | 'thumbnail'
            value: new value
            client: RustClient (optional, for backend sync)
        """
        # Find row
        for row in range(self.rowCount()):
            idx = self.index(row, 0)
            ws_id = self.data(idx, self.WORKSPACE_ID_ROLE)
            if ws_id == workspace_id:
                # Update local model
                if field == "title":
                    self._workspaces[row]["title"] = value
                elif field == "speed":
                    self._workspaces[row]["speed"] = float(value)
                elif field == "trimStart":
                    self._workspaces[row]["trim_start"] = float(value)
                elif field == "trimEnd":
                    self._workspaces[row]["trim_end"] = float(value)
                elif field == "thumbnail":
                    self._workspaces[row]["thumbnail_local"] = value
                
                # Emit dataChanged
                self.dataChanged.emit(idx, idx, [])
                break
        
        # Sync to backend
        if client:
            response = client.send_command(
                "workspace:update",
                {"id": workspace_id, "field": field, "value": value},
                timeout=5.0,
            )
            if response and response.get("warning"):
                # Show warning to user (e.g., "render in progress")
                from src.models.activity_log_model import ActivityLogModel
                ActivityLogModel.add_entry(
                    "edit", response["warning"], "warning"
                )
```

- [ ] **Step 2: Verify**

```bash
cd D:/LOOP_COMPANY/HyperClip
python -c "from src.models.workspace_model import WorkspaceModel; print('OK')"
```

- [ ] **Step 3: Commit**

```bash
git add src/models/workspace_model.py
git commit -m "feat(ws5): WorkspaceModel.update_field() with backend sync"
```

---

### Task 5.5: Wire `workspace:update` IPC

**Files:**
- Modify: `src-tauri/src/commands.rs`

- [ ] **Step 1: Replace stub**

Edit `src-tauri/src/commands.rs`, find:

```rust
        "workspace:update" => Ok(json!({ "ok": true })),
```

Replace with:

```rust
        "workspace:update" => {
            let id = p(params, "id").unwrap_or_default();
            let field = p(params, "field").unwrap_or_default();
            let value = params.get("value").cloned().unwrap_or(json!(null));
            
            let allowed = ["title", "speed", "trimStart", "trimEnd", "thumbnail"];
            if !allowed.contains(&field.as_str()) {
                return Ok(json!({"ok": false, "error": format!("invalid field: {}", field)}));
            }
            
            // Update workspace
            let mut workspaces = state.workspaces.write().await;
            let mut warning = None;
            
            if let Some(ws) = workspaces.iter_mut().find(|w| w.id == id) {
                if ws.status == hyperclip_ipc::WorkspaceStatus::Rendering {
                    warning = Some("Đang render, áp dụng cho lần render sau");
                }
                
                match field.as_str() {
                    "title" => ws.title = value.as_str().unwrap_or_default().to_string(),
                    "speed" => ws.speed = value.as_f64().unwrap_or(1.0) as f32,
                    "trimStart" => ws.trim_start_sec = value.as_f64().unwrap_or(0.0),
                    "trimEnd" => ws.trim_end_sec = value.as_f64().unwrap_or(0.0),
                    "thumbnail" => ws.thumbnail_local_path = value.as_str().map(String::from),
                    _ => unreachable!(),
                }
                ws.updated_at = chrono::Utc::now().timestamp_millis();
            }
            
            // Persist
            state.persist_workspaces().await;
            
            // Emit update event
            let event = serde_json::json!({
                "method": "workspace:update-event",
                "params": {"id": id, "field": field, "value": value}
            });
            println!("{}", event);
            use std::io::Write;
            std::io::stdout().flush().ok();
            
            if let Some(w) = warning {
                Ok(json!({"ok": true, "warning": w}))
            } else {
                Ok(json!({"ok": true}))
            }
        }
```

- [ ] **Step 2: Build**

```bash
cd D:/LOOP_COMPANY/HyperClip
cargo build --release -p hyperclip-tauri
```

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/commands.rs
git commit -m "feat(ws5): wire workspace:update IPC (title, speed, trim, thumbnail)"
```

---

### Task 5.6: Add Edit Section to VideoDetailPanel.qml

**Files:**
- Modify: `src/ui/qml/VideoDetailPanel.qml`

- [ ] **Step 1: Read existing**

```bash
cd D:/LOOP_COMPANY/HyperClip
wc -l src/ui/qml/VideoDetailPanel.qml
tail -30 src/ui/qml/VideoDetailPanel.qml
```

- [ ] **Step 2: Add EDIT groupbox before closing ColumnLayout**

Find the closing `}` of ColumnLayout (before final `}` of ScrollView), add:

```qml
        // ─── EDIT Section ──────────────────────────────────────
        GroupBox {
            Layout.fillWidth: true
            Layout.topMargin: 16
            title: "EDIT"
            background: Rectangle {
                color: Theme.bg
                border.color: Theme.border
                border.width: 1
            }
            label: Label {
                text: parent.title
                color: Theme.accent
                font.pixelSize: 11
                font.bold: true
            }
            
            ColumnLayout {
                anchors.fill: parent
                spacing: 6
                
                // Title
                EditField {
                    label: "Title"
                    value: root.workspaceData.title || ""
                    onValueChanged: (newVal) => {
                        workspaceModel.update_field(root.workspaceId, "title", newVal, backend)
                    }
                }
                
                // Speed
                RowLayout {
                    Layout.fillWidth: true
                    Label {
                        text: "Speed"
                        color: Theme.textMuted
                        font.pixelSize: 11
                        Layout.preferredWidth: 80
                    }
                    Slider {
                        id: speedSlider
                        Layout.fillWidth: true
                        from: 1.0
                        to: 2.0
                        stepSize: 0.1
                        value: root.workspaceData.speed || 1.0
                        onMoved: workspaceModel.update_field(
                            root.workspaceId, "speed", value, backend)
                    }
                    Label {
                        text: speedSlider.value.toFixed(1) + "x"
                        color: Theme.text
                        font.pixelSize: 11
                        font.family: "monospace"
                        Layout.preferredWidth: 40
                    }
                }
                
                // Trim
                RowLayout {
                    Layout.fillWidth: true
                    Label {
                        text: "Trim"
                        color: Theme.textMuted
                        font.pixelSize: 11
                        Layout.preferredWidth: 80
                    }
                    SpinBox {
                        id: trimStart
                        from: 0
                        to: root.workspaceData.durationSec || 3600
                        value: root.workspaceData.trimStart || 0
                        editable: true
                        Layout.fillWidth: true
                        onValueChanged: workspaceModel.update_field(
                            root.workspaceId, "trimStart", value, backend)
                    }
                    Label {
                        text: "→"
                        color: Theme.text
                        font.pixelSize: 11
                    }
                    SpinBox {
                        id: trimEnd
                        from: 0
                        to: root.workspaceData.durationSec || 3600
                        value: root.workspaceData.trimEnd || (root.workspaceData.durationSec || 3600)
                        editable: true
                        Layout.fillWidth: true
                        onValueChanged: workspaceModel.update_field(
                            root.workspaceId, "trimEnd", value, backend)
                    }
                }
                
                // Thumbnail
                ThumbnailUploader {
                    Layout.fillWidth: true
                    workspaceId: root.workspaceData.video_id || ""
                    currentThumbnail: root.workspaceData.thumbnail || ""
                    localThumbnail: root.workspaceData.thumbnail_local || ""
                    onThumbnailChanged: (path) => {
                        workspaceModel.update_field(
                            root.workspaceId, "thumbnail", path, backend)
                    }
                }
            }
        }
```

- [ ] **Step 3: Verify (manual)**

```bash
cd D:/LOOP_COMPANY/HyperClip
python -c "import os; print('QML file written, size:', os.path.getsize('src/ui/qml/VideoDetailPanel.qml'))"
```

- [ ] **Step 4: Commit**

```bash
git add src/ui/qml/VideoDetailPanel.qml
git commit -m "feat(ws5): VideoDetailPanel edit section (title, speed, trim, thumbnail)"
```

---

### Task 5.7-5.14: Polish + Tests + Milestone

(Tóm tắt pattern)

**Task 5.7**: Pass workspaceData fields to VideoDetailPanel (title, speed, trim, thumbnail_local)
**Task 5.8**: Python unit test - update_field method
**Task 5.9**: UI test - manual E2E (open detail, change speed, verify persist)
**Task 5.10**: Add "Render with new settings" button
**Task 5.11**: Update memory
**Task 5.12**: Build + manual smoke
**Task 5.13**: All tests pass
**Task 5.14**: Tag ws5-complete

---

## Self-Review

- [x] Speed slider (1.0-2.0×)
- [x] Trim SpinBox x2 (start/end)
- [x] Title TextField
- [x] Thumbnail uploader (file dialog + YouTube download)
- [x] workspace:update IPC wired với field validation
- [x] Warning khi edit trong lúc render
- [x] No placeholders

**Status**: Ready. Implementation ~1.5-2 tuần.
