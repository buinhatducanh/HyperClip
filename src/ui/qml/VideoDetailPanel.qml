// src/ui/qml/VideoDetailPanel.qml
// Center pane: workspace detail — composes WorkspaceMetrics + WorkspaceEditForm + actions
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
        x: 12; y: 12

        RowLayout {
            Layout.fillWidth: true
            Label {
                text: "Chi tiết video"
                color: Theme.text; font.pixelSize: Theme.textXl; font.bold: true
                Layout.fillWidth: true
            }
            Label {
                text: root.workspaceId
                color: Theme.textMuted; font.pixelSize: Theme.textXs; font.family: "monospace"
            }
        }

        WorkspaceMetrics { workspaceData: root.workspaceData }

        // ─── EDIT Section ──────────────────────────────────────
        GroupBox {
            Layout.fillWidth: true
            Layout.topMargin: 16
            title: "CHỈNH SỬA"
            background: Rectangle { color: Theme.bg; border.color: Theme.border; border.width: 1 }
            label: Label { text: parent.title; color: Theme.accent; font.pixelSize: Theme.textSm; font.bold: true }

            WorkspaceEditForm {
                workspaceId: root.workspaceId
                workspaceData: root.workspaceData
            }
        }

        // ─── Render with new settings ──────────────────────────
        RowLayout {
            Layout.fillWidth: true
            Layout.topMargin: 8
            spacing: 6

            IconButton {
                Layout.fillWidth: true
                Layout.preferredHeight: 36
                iconName: "render"
                label: "Render"
                iconSize: 14
                colorIdle: Theme.accent + "20"
                colorHover: Theme.accent + "40"
                colorPressed: Theme.accent
                iconColorIdle: Theme.accent
                iconColorHover: "white"
                flat: true
                enabled: root.workspaceData.status === "ready" || root.workspaceData.status === "done"
                onClicked: {
                    backend.send_command("render:start", {
                        "id": root.workspaceId,
                        "speed": root.workspaceData.speed || 1.0,
                        "trimStart": root.workspaceData.trimStart || 0,
                        "trimEnd": root.workspaceData.trimEnd || 0,
                    })
                }
            }
        }

        // Action buttons
        RowLayout {
            Layout.fillWidth: true
            spacing: 6

            IconButton {
                iconName: "pause"
                label: "Hủy"
                iconSize: 12
                Layout.minimumWidth: 64
                onClicked: backend.send_command("render:cancel", {"id": root.workspaceId})
            }
            IconButton {
                iconName: "retry"
                label: "Thử lại"
                iconSize: 12
                Layout.minimumWidth: 80
                onClicked: backend.send_command("workspace:retry", {"id": root.workspaceId})
            }
            Item { Layout.fillWidth: true; Layout.minimumWidth: 4 }
            IconButton {
                iconName: "delete"
                label: "Xóa"
                iconSize: 12
                iconColorIdle: Theme.textMuted
                iconColorHover: "white"
                colorHover: Theme.error + "30"
                colorPressed: Theme.error
                Layout.minimumWidth: 64
                onClicked: {
                    backend.send_command("workspace:delete", {"id": root.workspaceId})
                    activityModel.add_entry("ws", "Đã xóa " + root.workspaceId, "info")
                }
            }
        }
    }
}
