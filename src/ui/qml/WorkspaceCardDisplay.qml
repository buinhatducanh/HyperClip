// src/ui/qml/WorkspaceCardDisplay.qml
// Pure presentational card: thumbnail, status badge, progress bar, meta info
import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

Rectangle {
    id: displayRoot
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
    property bool hovered: false

    color: hovered ? Theme.hoverBg : Theme.cardBg
    border.color: status === "error" ? Theme.error
                : status === "rendering" ? Theme.accent
                : hovered ? Theme.accent
                : Theme.border
    border.width: 1
    height: 82
    radius: Theme.radiusLg
    clip: true

    Behavior on color { ColorAnimation { duration: 150 } }
    Behavior on border.color { ColorAnimation { duration: 150 } }

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

    // Status strip on the left edge
    Rectangle {
        id: statusStrip
        width: 4
        anchors.left: parent.left
        anchors.top: parent.top
        anchors.bottom: parent.bottom
        color: status === "error" ? Theme.error
             : status === "rendering" ? Theme.accent
             : status === "done" ? Theme.success
             : status === "downloading" ? "#FFA500"
             : status === "ready" ? Theme.success
             : "transparent"
    }

    RowLayout {
        anchors.fill: parent
        anchors.leftMargin: 10
        anchors.rightMargin: 8
        anchors.topMargin: 8
        anchors.bottomMargin: 8
        spacing: 10

        // Thumbnail
        Rectangle {
            id: thumb
            Layout.preferredWidth: isShort ? 36 : 64
            Layout.preferredHeight: 64
            color: Theme.bg
            border.color: Theme.border
            border.width: 1
            radius: Theme.radiusMd
            clip: true

            Image {
                anchors.fill: parent
                source: thumbnail
                fillMode: Image.PreserveAspectCrop
                visible: thumbnail !== ""
            }
            Icon {
                anchors.centerIn: parent
                visible: thumbnail === ""
                name: "play"
                size: 20
                color: Theme.textMuted
            }
            // Duration badge
            Rectangle {
                visible: durationSec > 0
                anchors.bottom: parent.bottom; anchors.right: parent.right; anchors.margins: 2
                color: "#000000AA"; height: 14
                radius: 2
                width: durLabel.implicitWidth + 6
                Label {
                    id: durLabel
                    anchors.centerIn: parent
                    text: {
                        const m = Math.floor(durationSec / 60)
                        const s = durationSec % 60
                        return m + ":" + (s < 10 ? "0" : "") + s
                    }
                    color: "white"; font.pixelSize: 10; font.bold: true
                }
            }
        }

        ColumnLayout {
            Layout.fillWidth: true
            spacing: 2

            // Title + status badge
            RowLayout {
                Layout.fillWidth: true
                spacing: 8
                Label {
                    text: title || "Chưa có tiêu đề"
                    color: Theme.text
                    font.pixelSize: Theme.textMd
                    font.bold: true
                    elide: Text.ElideRight
                    Layout.fillWidth: true
                }
                // Status badge
                Rectangle {
                    Layout.preferredHeight: 18
                    Layout.preferredWidth: badgeRow.implicitWidth + 10
                    radius: Theme.radiusMd
                    color: status === "error" ? Theme.error + "20"
                         : status === "rendering" ? Theme.accent + "20"
                         : status === "done" ? Theme.success + "20"
                         : status === "downloading" ? "#FFA50020"
                         : status === "ready" ? Theme.success + "20"
                         : "#2A2A2A"
                    border.color: status === "error" ? Theme.error
                               : status === "rendering" ? Theme.accent
                               : status === "done" ? Theme.success
                               : status === "downloading" ? "#FFA500"
                               : status === "ready" ? Theme.success
                               : Theme.border
                    border.width: 1
                    RowLayout {
                        id: badgeRow
                        anchors.centerIn: parent
                        spacing: 4
                        StatusDot {
                            state: {
                                if (status === "error") return "error"
                                if (status === "rendering") return "running"
                                if (status === "done") return "success"
                                if (status === "downloading") return "warning"
                                if (status === "ready") return "ready"
                                return "idle"
                            }
                            size: 6
                            showRing: status === "rendering" || status === "downloading"
                        }
                        Label {
                            text: statusLabel()
                            color: status === "error" ? Theme.error
                                 : status === "rendering" ? Theme.accent
                                 : status === "done" ? Theme.success
                                 : status === "downloading" ? "#FFA500"
                                 : status === "ready" ? Theme.success
                                 : Theme.text
                            font.pixelSize: 9; font.bold: true
                        }
                    }
                }
            }

            // Channel name row
            Label {
                text: channel_name || "—"
                color: Theme.accent
                font.pixelSize: Theme.textSm
                font.bold: true
                elide: Text.ElideRight
                Layout.fillWidth: true
            }

            // Detailed metadata line
            Label {
                text: (ageLabel !== "" ? ageLabel : "") +
                      (fileSize !== "" ? " · " + fileSize : "") +
                      (durationSec > 0 ? " · " + Math.floor(durationSec/60) + ":" + (durationSec%60<10?"0":"") + (durationSec%60) : "") +
                      " · " + quality + "p" +
                      (speed > 1 ? " · " + speed.toFixed(1) + "x" : "")
                color: Theme.textMuted
                font.pixelSize: Theme.textXs
                elide: Text.ElideRight
                Layout.fillWidth: true
            }

            // Progress bar
            Rectangle {
                Layout.fillWidth: true
                Layout.preferredHeight: 4
                Layout.topMargin: 2
                radius: 2
                color: "#242424"
                visible: (status === "downloading" || status === "rendering") && progress > 0
                Rectangle {
                    id: progressFill
                    anchors.left: parent.left
                    anchors.top: parent.top
                    anchors.bottom: parent.bottom
                    radius: 2
                    width: parent.width * Math.min(progress, 100) / 100
                    color: status === "downloading" ? Theme.success : Theme.accent

                    Behavior on width {
                        NumberAnimation {
                            duration: 250
                            easing.type: Easing.OutQuad
                        }
                    }
                }
            }
        }
    }
}
