// src/ui/qml/WorkspaceCardDisplay.qml
// Pure presentational card: thumbnail, status badge, progress bar, meta info
import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import "Fmt.js" as Fmt

Rectangle {
    id: displayRoot
    property string status: "pending"
    property string title: ""
    property real progress: 0
    property string channel_name: ""
    /// id kênh trong store (`ch-…`) — khoá tra avatar; rỗng thì tra theo tên.
    property string channelId: ""
    property string thumbnail: ""
    property bool isShort: true
    property int durationSec: 0
    property int quality: 1080
    property real speed: 1.0
    property string fileSize: ""
    /// "bắt được cách đây bao lâu" — KHÔNG phải tuổi video lúc bắt.
    property string ageLabel: ""
    /// Giờ ĐĂNG của video (HH:MM:SS). Hàng bù hiện mốc này, không hiện khoảng.
    property string publishedTimeStr: ""
    property bool isSelected: false
    property bool selectionActive: false
    property bool isStartupCatchup: false
    property bool hovered: false
    property real totalDurationSec: 0
    property int partIndex: 0
    property int partTotal: 0
    property real sourceDupRatio: 0

    function formatDuration1Dec(sec) { return Fmt.durationOr(sec, "") }

    color: hovered ? Theme.hoverBg : Theme.cardBg
    border.color: isSelected ? Theme.accent
                : status === "error" ? Theme.error
                : status === "rendering" ? Theme.accent
                : hovered ? Theme.accent
                : Theme.border
    border.width: isSelected ? 2 : 1
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
        anchors.leftMargin: 12
        anchors.rightMargin: 36
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
                        const actualDur = Math.round(durationSec / speed)
                        const m = Math.floor(actualDur / 60)
                        const s = actualDur % 60
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
                // Cảnh báo nguồn bẩn: video gốc upload đã lặp frame sẵn —
                // output giật là do NGUỒN, không phải render (Pass 35a).
                Rectangle {
                    visible: sourceDupRatio >= 0.03
                    Layout.preferredHeight: 18
                    Layout.preferredWidth: dupWarnLabel.implicitWidth + 10
                    radius: Theme.radiusMd
                    color: "#FF8C0025"
                    border.color: "#FF8C00"
                    border.width: 1
                    Label {
                        id: dupWarnLabel
                        anchors.centerIn: parent
                        text: "⚠ NGUỒN GIẬT " + Math.round(sourceDupRatio * 100) + "%"
                        color: "#FF8C00"
                        font.pixelSize: 9
                        font.bold: true
                    }
                }
                // Part badge: video tách part hiện "P1/3", "P2/3"...
                Rectangle {
                    visible: partTotal >= 2 && partIndex >= 1
                    Layout.preferredHeight: 18
                    Layout.preferredWidth: partLabel.implicitWidth + 10
                    radius: Theme.radiusMd
                    color: Theme.accent + "25"
                    border.color: Theme.accent
                    border.width: 1
                    Label {
                        id: partLabel
                        anchors.centerIn: parent
                        text: "P" + partIndex + "/" + partTotal
                        color: Theme.accent
                        font.pixelSize: 10
                        font.bold: true
                    }
                }
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

            // Channel name row — kèm avatar chuẩn của kênh (cùng bảng tra với
            // Sidebar / Quản lí / Vận hành, không tự đi lấy ảnh riêng).
            RowLayout {
                Layout.fillWidth: true
                spacing: 4
                ChannelAvatarFor {
                    channelKey: displayRoot.channelId
                    fallbackName: displayRoot.channel_name
                    diameter: 14
                    Layout.alignment: Qt.AlignVCenter
                }
                Label {
                    text: channel_name || "—"
                    color: Theme.accent
                    font.pixelSize: Theme.textSm
                    font.bold: true
                    elide: Text.ElideRight
                    Layout.fillWidth: true
                }
            }

            // Detailed metadata line
            Label {
                // "Khởi động" đọc thành "app khởi động mất ngần này" — sai
                // hẳn nghĩa: nó chỉ có nghĩa video ĐÃ ĐĂNG TRƯỚC KHI mở app.
                // Khách hỏi đúng: "app quét bằng API thì khởi động gì?". Nói
                // bằng chữ của việc thật: đây là hàng BÙ.
                // Pass 71: hàng bù hiện MỐC GIỜ ĐĂNG + "App khởi động", không
                // hiện khoảng thời gian nào — giống hàng LỊCH SỬ PHÁT HIỆN.
                //
                // Pass 74: `ageLabel` = "bắt cách đây bao lâu" (now − detectedAt).
                // Pass 73 từng đổi sang publishedAt — SAI HƯỚNG: đó là mốc bắt
                // đầu UPLOAD, sớm hơn công khai 3-4 phút với video dài (đo
                // 14/08: khai 11:16:06, bấm Đăng 11:19:29), nhãn lệch THÊM chứ
                // không khớp nhãn YouTube hơn.
                text: (isStartupCatchup
                       ? ((publishedTimeStr !== "" ? "đăng " + publishedTimeStr + " · " : "")
                          + "App khởi động")
                       : (ageLabel !== "" ? ageLabel : "")) +
                      (fileSize !== "" ? " · " + fileSize : "") +
                      (durationSec > 0 ? " · " + (function() {
                          const actualDur = Math.round(durationSec / speed)
                          const m = Math.floor(actualDur / 60)
                          const s = actualDur % 60
                          return m + ":" + (s < 10 ? "0" : "") + s
                      })() : "") +
                      " · " + quality + "p" +
                      (speed > 1 ? " · " + speed.toFixed(1) + "x" : "") +
                      (totalDurationSec > 0 ? " · E2E Tổng: " + formatDuration1Dec(totalDurationSec) : "")
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
