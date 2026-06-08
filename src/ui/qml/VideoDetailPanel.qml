// src/ui/qml/VideoDetailPanel.qml
// Center pane: workspace detail (download/render/system metrics)
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

ScrollView {
    id: root
    clip: true
    property string workspaceId: ""
    property var workspaceData: ({})

    ColumnLayout {
        width: root.width - 24
        spacing: 8
        x: 12
        y: 12

        RowLayout {
            Layout.fillWidth: true
            Label {
                text: "Workspace Detail"
                color: Theme.text
                font.pixelSize: 18
                font.bold: true
                Layout.fillWidth: true
            }
            Label {
                text: root.workspaceId
                color: Theme.textMuted
                font.pixelSize: 9
                font.family: "monospace"
            }
        }

        // Download section
        GroupBox {
            Layout.fillWidth: true
            title: "DOWNLOAD METRICS"
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

            GridLayout {
                columns: 2
                columnSpacing: 16
                rowSpacing: 4
                anchors.fill: parent
                Label { text: "Time"; color: Theme.textMuted; font.pixelSize: 10 }
                Label { text: root.workspaceData.downloadTime || "—"; color: Theme.text; font.pixelSize: 10; font.family: "monospace" }
                Label { text: "Speed"; color: Theme.textMuted; font.pixelSize: 10 }
                Label { text: root.workspaceData.downloadSpeed || "—"; color: Theme.text; font.pixelSize: 10; font.family: "monospace" }
                Label { text: "Size"; color: Theme.textMuted; font.pixelSize: 10 }
                Label { text: root.workspaceData.fileSize || "—"; color: Theme.text; font.pixelSize: 10; font.family: "monospace" }
                Label { text: "Quality"; color: Theme.textMuted; font.pixelSize: 10 }
                Label { text: (root.workspaceData.quality || 1080) + "p"; color: Theme.text; font.pixelSize: 10; font.family: "monospace" }
                Label { text: "Source"; color: Theme.textMuted; font.pixelSize: 10 }
                Label { text: root.workspaceData.source || "yt-dlp"; color: Theme.text; font.pixelSize: 10; font.family: "monospace" }
            }
        }

        // Render section
        GroupBox {
            Layout.fillWidth: true
            title: "RENDER METRICS"
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
            GridLayout {
                columns: 2
                columnSpacing: 16
                rowSpacing: 4
                anchors.fill: parent
                Label { text: "FPS"; color: Theme.textMuted; font.pixelSize: 10 }
                Label { text: (root.workspaceData.renderFps || 0).toFixed(1); color: Theme.text; font.pixelSize: 10; font.family: "monospace" }
                Label { text: "Workers"; color: Theme.textMuted; font.pixelSize: 10 }
                Label { text: root.workspaceData.renderWorkers || 1; color: Theme.text; font.pixelSize: 10; font.family: "monospace" }
                Label { text: "Preset"; color: Theme.textMuted; font.pixelSize: 10 }
                Label { text: root.workspaceData.renderPreset || "p1"; color: Theme.text; font.pixelSize: 10; font.family: "monospace" }
                Label { text: "Codec"; color: Theme.textMuted; font.pixelSize: 10 }
                Label { text: root.workspaceData.renderCodec || "hevc_nvenc"; color: Theme.text; font.pixelSize: 10; font.family: "monospace" }
                Label { text: "Output"; color: Theme.textMuted; font.pixelSize: 10 }
                Label { text: root.workspaceData.outputPath || "—"; color: Theme.text; font.pixelSize: 9; font.family: "monospace"; elide: Text.ElideMiddle; Layout.fillWidth: true }
            }
        }

        // System section
        GroupBox {
            Layout.fillWidth: true
            title: "SYSTEM"
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
            GridLayout {
                columns: 2
                columnSpacing: 16
                rowSpacing: 4
                anchors.fill: parent
                Label { text: "GPU"; color: Theme.textMuted; font.pixelSize: 10 }
                Label { text: statsModel.gpu_name; color: Theme.text; font.pixelSize: 10; font.family: "monospace" }
                Label { text: "VRAM"; color: Theme.textMuted; font.pixelSize: 10 }
                Label { text: statsModel.ram_label; color: Theme.text; font.pixelSize: 10; font.family: "monospace" }
                Label { text: "Workers"; color: Theme.textMuted; font.pixelSize: 10 }
                Label { text: statsModel.active_workers + " / " + statsModel.max_workers; color: Theme.text; font.pixelSize: 10; font.family: "monospace" }
            }
        }

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

                EditField {
                    label: "Title"
                    value: root.workspaceData.title || ""
                    onValueChanged: (newVal) => {
                        workspaceModel.update_field(root.workspaceId, "title", newVal, backend)
                    }
                }

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
                        to: (root.workspaceData.durationSec || 3600)
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
                        to: (root.workspaceData.durationSec || 3600)
                        value: root.workspaceData.trimEnd || (root.workspaceData.durationSec || 60)
                        editable: true
                        Layout.fillWidth: true
                        onValueChanged: workspaceModel.update_field(
                            root.workspaceId, "trimEnd", value, backend)
                    }
                    Label {
                        text: "sec"
                        color: Theme.textMuted
                        font.pixelSize: 10
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

        // ─── Render with new settings ──────────────────────────
        Button {
            Layout.fillWidth: true
            Layout.topMargin: 8
            text: "Render with new settings"
            enabled: root.workspaceData.status === "ready" || root.workspaceData.status === "done"
            onClicked: {
                backend.send_command("render:start", {
                    "id": root.workspaceId,
                    "speed": speedSlider.value,
                    "trimStart": trimStart.value,
                    "trimEnd": trimEnd.value,
                })
            }
        }

        // Action buttons
        RowLayout {
            Layout.fillWidth: true
            Button {
                text: "Render"
                onClicked: backend.send_command("render:start", {"id": root.workspaceId})
            }
            Button {
                text: "Cancel"
                onClicked: backend.send_command("render:cancel", {"id": root.workspaceId})
            }
            Button {
                text: "Retry"
                onClicked: backend.send_command("workspace:retry", {"id": root.workspaceId})
            }
            Item { Layout.fillWidth: true }
            Button {
                text: "Xóa"
                onClicked: {
                    backend.send_command("workspace:delete", {"id": root.workspaceId})
                    activityModel.add_entry("ws", "Deleted " + root.workspaceId, "info")
                }
            }
        }
    }
}
