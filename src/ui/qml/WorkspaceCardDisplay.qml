// src/ui/qml/WorkspaceCardDisplay.qml
// Pure presentational card: thumbnail, status badge, progress bar, meta info
import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

Rectangle {
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

    color: Theme.cardBg
    border.color: status === "error" ? Theme.error
                : status === "rendering" ? Theme.accent
                : status === "done" ? Theme.success
                : Theme.border
    border.width: 1
    height: 76

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

        // Thumbnail
        Rectangle {
            id: thumb
            Layout.preferredWidth: isShort ? 36 : 64
            Layout.preferredHeight: 64
            color: Theme.bg
            border.color: Theme.border; border.width: 1
            clip: true

            Image {
                anchors.fill: parent
                source: thumbnail
                fillMode: Image.PreserveAspectCrop
                visible: thumbnail !== ""
            }
            Label {
                anchors.centerIn: parent
                visible: thumbnail === ""
                text: "▶"
                color: Theme.textMuted; font.pixelSize: 14
            }
            // Short indicator
            Rectangle {
                visible: isShort
                anchors.bottom: parent.bottom; anchors.right: parent.right
                width: 14; height: 14; color: Theme.accent
                Label {
                    anchors.centerIn: parent
                    text: "9:16"; color: "white"; font.pixelSize: 6
                }
            }
            // Duration badge
            Rectangle {
                visible: durationSec > 0
                anchors.bottom: parent.bottom; anchors.left: parent.left
                color: "#000000BB"; height: 14
                width: durLabel.implicitWidth + 6
                Label {
                    id: durLabel
                    anchors.centerIn: parent
                    text: {
                        const m = Math.floor(durationSec / 60)
                        const s = durationSec % 60
                        return m + ":" + (s < 10 ? "0" : "") + s
                    }
                    color: "white"; font.pixelSize: 8
                }
            }
        }

        ColumnLayout {
            Layout.fillWidth: true
            spacing: 2

            // Title + status badge
            RowLayout {
                Layout.fillWidth: true
                Label {
                    text: title || "Chưa có tiêu đề"
                    color: Theme.text; font.pixelSize: 12; font.bold: true
                    elide: Text.ElideRight; Layout.fillWidth: true
                }
                Rectangle {
                    Layout.preferredHeight: 16
                    Layout.preferredWidth: badgeLabel.implicitWidth + 12
                    radius: 2
                    color: status === "error" ? Theme.error
                         : status === "rendering" ? Theme.accent
                         : status === "done" ? Theme.success
                         : "#2A2A2A"
                    Label {
                        id: badgeLabel
                        anchors.centerIn: parent
                        text: statusIcon() + " " + statusLabel()
                        color: "white"; font.pixelSize: 8; font.bold: true
                    }
                    SequentialAnimation on opacity {
                        running: status === "downloading" || status === "rendering"
                        loops: Animation.Infinite
                        NumberAnimation { from: 1.0; to: 0.4; duration: 600 }
                        NumberAnimation { from: 0.4; to: 1.0; duration: 600 }
                    }
                }
            }

            // Channel + meta
            Label {
                text: (channel_name || "—") +
                      (ageLabel !== "" ? " · " + ageLabel : "") +
                      (fileSize !== "" ? " · " + fileSize : "") +
                      (durationSec > 0 ? " · " + Math.floor(durationSec/60) + ":" + (durationSec%60<10?"0":"") + (durationSec%60) : "")
                color: Theme.textMuted; font.pixelSize: Theme.textXs
                elide: Text.ElideRight; Layout.fillWidth: true
            }

            // Quality + speed
            Label {
                text: quality + "p" + (speed > 1 ? " · " + speed.toFixed(1) + "x" : "")
                color: Theme.textMuted; font.pixelSize: 8
            }

            // Progress bar
            Rectangle {
                Layout.fillWidth: true; Layout.preferredHeight: 3
                color: Theme.cardBg
                visible: (status === "downloading" || status === "rendering") && progress > 0
                Rectangle {
                    anchors.left: parent.left; anchors.top: parent.top; anchors.bottom: parent.bottom
                    width: parent.width * Math.min(progress, 100) / 100
                    color: status === "downloading" ? Theme.success : Theme.accent
                }
            }
        }
    }
}
