// src/ui/qml/WorkspaceCard.qml
// Single video card with thumbnail, status badge, progress, action strip
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Rectangle {
    id: card

    property string ws_id: ""
    property string status: "pending"
    property string title: ""
    property real progress: 0
    property string channel_name: ""
    property string thumbnail: ""
    property bool isShort: true
    property int durationSec: 0
    property int quality: 1080
    property real speed: 1.0
    property string fileSize: ""
    property string ageLabel: ""

    color: hoverArea.containsMouse ? "#1A1A1A" : Theme.bg
    border.color: status === "error" ? Theme.error
              : status === "rendering" ? Theme.accent
              : status === "done" ? Theme.success
              : Theme.border
    border.width: 1
    height: 76

    // Status icon + color
    function statusIcon() {
        switch (status) {
            case "pending": return "⏳"
            case "waiting": return "⏸"
            case "downloading": return "⬇"
            case "ready": return "✅"
            case "editing": return "✏"
            case "rendering": return "🎬"
            case "done": return "✓"
            case "error": return "✗"
            default: return "?"
        }
    }
    function statusLabel() {
        switch (status) {
            case "pending": return "Chờ"
            case "waiting": return "Chờ DL"
            case "downloading": return "Đang tải"
            case "ready": return "Sẵn sàng"
            case "editing": return "Đang sửa"
            case "rendering": return "Đang render"
            case "done": return "Xong"
            case "error": return "Lỗi"
            default: return status
        }
    }

    RowLayout {
        anchors.fill: parent
        anchors.margins: 6
        spacing: 8

        // Thumbnail (16:9 or 9:16)
        Rectangle {
            id: thumb
            Layout.preferredWidth: card.isShort ? 36 : 64
            Layout.preferredHeight: 64
            color: "#0A0A0A"
            border.color: Theme.border
            border.width: 1
            clip: true

            Image {
                anchors.fill: parent
                source: card.thumbnail
                fillMode: Image.PreserveAspectCrop
                visible: card.thumbnail !== ""
            }
            Label {
                anchors.centerIn: parent
                visible: card.thumbnail === ""
                text: "▶"
                color: Theme.textMuted
                font.pixelSize: 14
            }
            // Short indicator
            Rectangle {
                visible: card.isShort
                anchors.bottom: parent.bottom
                anchors.right: parent.right
                width: 14; height: 14
                color: Theme.accent
                Label {
                    anchors.centerIn: parent
                    text: "9:16"
                    color: "white"
                    font.pixelSize: 6
                }
            }
            // Duration badge
            Rectangle {
                visible: card.durationSec > 0
                anchors.bottom: parent.bottom
                anchors.left: parent.left
                color: "#000000BB"
                height: 14
                width: durLabel.implicitWidth + 6
                Label {
                    id: durLabel
                    anchors.centerIn: parent
                    text: {
                        const m = Math.floor(card.durationSec / 60)
                        const s = card.durationSec % 60
                        return m + ":" + (s < 10 ? "0" : "") + s
                    }
                    color: "white"
                    font.pixelSize: 8
                }
            }
        }

        ColumnLayout {
            Layout.fillWidth: true
            spacing: 2

            // Title + status row
            RowLayout {
                Layout.fillWidth: true
                Label {
                    text: card.title || "Untitled"
                    color: Theme.text
                    font.pixelSize: 12
                    font.bold: true
                    elide: Text.ElideRight
                    Layout.fillWidth: true
                }
                Rectangle {
                    Layout.preferredHeight: 16
                    Layout.preferredWidth: badgeLabel.implicitWidth + 12
                    radius: 2
                    color: card.status === "error" ? Theme.error
                         : card.status === "rendering" ? Theme.accent
                         : card.status === "done" ? Theme.success
                         : "#2A2A2A"
                    Label {
                        id: badgeLabel
                        anchors.centerIn: parent
                        text: card.statusIcon() + " " + card.statusLabel()
                        color: "white"
                        font.pixelSize: 8
                        font.bold: true
                    }
                    // Pulse animation for active states
                    SequentialAnimation on opacity {
                        running: card.status === "downloading" || card.status === "rendering"
                        loops: Animation.Infinite
                        NumberAnimation { from: 1.0; to: 0.4; duration: 600 }
                        NumberAnimation { from: 0.4; to: 1.0; duration: 600 }
                    }
                }
            }

            // Channel + meta
            Label {
                text: (card.channel_name || "—") +
                      (card.ageLabel !== "" ? " · " + card.ageLabel : "") +
                      (card.fileSize !== "" ? " · " + card.fileSize : "") +
                      (card.durationSec > 0 ? " · " + Math.floor(card.durationSec/60) + ":" + (card.durationSec%60<10?"0":"") + (card.durationSec%60) : "")
                color: Theme.textMuted
                font.pixelSize: 9
                elide: Text.ElideRight
                Layout.fillWidth: true
            }

            // Quality + speed
            Label {
                text: card.quality + "p" + (card.speed > 1 ? " · " + card.speed.toFixed(1) + "x" : "")
                color: Theme.textMuted
                font.pixelSize: 8
            }

            // Progress bar (only when active)
            Rectangle {
                Layout.fillWidth: true
                Layout.preferredHeight: 3
                color: "#1A1A1A"
                visible: (card.status === "downloading" || card.status === "rendering")
                             && card.progress > 0
                Rectangle {
                    anchors.left: parent.left
                    anchors.top: parent.top
                    anchors.bottom: parent.bottom
                    width: parent.width * Math.min(card.progress, 100) / 100
                    color: card.status === "downloading" ? Theme.success : Theme.accent
                }
            }

            // Action strip — only show on hover
            RowLayout {
                Layout.fillWidth: true
                visible: hoverArea.containsMouse
                spacing: 4
                Button {
                    text: "Chi tiết"
                    Layout.preferredHeight: 18
                    font.pixelSize: 8
                    onClicked: detailEditor.loadWorkspace(card.ws_id)
                }
                Button {
                    text: card.status === "error" ? "Thử lại" : "Xóa"
                    Layout.preferredHeight: 18
                    font.pixelSize: 8
                    onClicked: {
                        if (card.status === "error") {
                            backend.send_command("workspace:retry", {"id": card.ws_id})
                        } else {
                            backend.send_command("workspace:delete", {"id": card.ws_id})
                        }
                    }
                }
                Button {
                    text: "Render"
                    Layout.preferredHeight: 18
                    font.pixelSize: 8
                    enabled: card.status === "ready"
                    onClicked: backend.send_command("render:start", {"id": card.ws_id})
                }
                Item { Layout.fillWidth: true }
            }
        }
    }

    MouseArea {
        id: hoverArea
        anchors.fill: parent
        hoverEnabled: true
        cursorShape: Qt.PointingHandCursor
        onClicked: detailEditor.loadWorkspace(card.ws_id)
    }
}
