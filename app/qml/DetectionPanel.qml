// src/ui/qml/DetectionPanel.qml
// Detection thresholds + poller monitoring + activity log
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

SettingsCard {
    id: root
    title: "BỘ LỌC PHÁT HIỆN"

    RowLayout {
        Layout.fillWidth: true
        spacing: 8
        Label {
            text: "Bật quét"
            color: Theme.textMuted
            font.pixelSize: Theme.textMd
        }
        Item { Layout.fillWidth: true }
        Switch {
            checked: settings ? settings.pollingEnabled : false
            onToggled: if (settings) settings.pollingEnabled = checked
        }
    }

    Label {
        text: "Trạng thái: " + ((poller && poller.active) ? "Đang chạy" : "Tạm dừng")
              + ((poller && poller.lastError) ? " · " + poller.lastError : "")
        color: (poller && poller.active) ? Theme.success : Theme.textMuted
        font.pixelSize: 10
    }

    // Pass 89 — CÔNG TẮC 3 KHỚP: lấy gì về máy. Đặt TRÊN CÙNG vì nó quyết
    // định ý nghĩa của hai ô thời lượng bên dưới (khớp "chỉ Short" tự hạ trần
    // về 3 phút, khớp "cả hai" bỏ sàn).
    ColumnLayout {
        Layout.fillWidth: true
        spacing: 6

        Label {
            text: "LẤY LOẠI VIDEO NÀO"
            color: Theme.text
            font.pixelSize: Theme.textMd
            font.bold: true
        }

        RowLayout {
            Layout.fillWidth: true
            spacing: 0

            Repeater {
                model: [
                    { key: "long",  label: "Chỉ video",     hint: "Bỏ qua Short" },
                    { key: "both",  label: "Video + Short", hint: "Lấy tất cả" },
                    { key: "short", label: "Chỉ Short",     hint: "Bỏ video dài" }
                ]
                delegate: Button {
                    id: kindBtn
                    required property var modelData
                    required property int index
                    // Tham chiếu qua id, KHÔNG dùng parent.parent: contentItem
                    // và background nằm ở hai độ sâu khác nhau nên chuỗi parent
                    // dễ gãy im lặng khi ai đó bọc thêm một lớp Item.
                    readonly property bool isOn: settings
                        ? (settings.videoKindFilter === modelData.key)
                        : (modelData.key === "long")
                    Layout.fillWidth: true
                    Layout.preferredHeight: 40
                    onClicked: if (settings) settings.videoKindFilter = modelData.key
                    background: Rectangle {
                        color: kindBtn.isOn ? Theme.accent : Theme.inputBg
                        border.color: kindBtn.isOn ? Theme.accent : Theme.border
                        border.width: 1
                        radius: Theme.radiusMd
                        // Lấp bo góc ở hai mối nối để 3 nút thành một khối liền
                        Rectangle {
                            visible: kindBtn.index > 0
                            width: parent.radius; height: parent.height
                            color: parent.color
                        }
                        Rectangle {
                            visible: kindBtn.index < 2
                            anchors.right: parent.right
                            width: parent.radius; height: parent.height
                            color: parent.color
                        }
                    }
                    contentItem: ColumnLayout {
                        spacing: 0
                        Label {
                            Layout.alignment: Qt.AlignHCenter
                            text: kindBtn.modelData.label
                            color: kindBtn.isOn ? "#FFFFFF" : Theme.text
                            font.pixelSize: Theme.textMd
                            font.bold: kindBtn.isOn
                        }
                        Label {
                            Layout.alignment: Qt.AlignHCenter
                            text: kindBtn.modelData.hint
                            color: kindBtn.isOn ? "#E0F2FE" : Theme.textMuted
                            font.pixelSize: 10
                        }
                    }
                }
            }
        }

        Label {
            // Nói THẲNG giới hạn của cơ chế: API YouTube không có cờ "Short",
            // app phân loại bằng thời lượng nên video thường ngắn hơn mốc này
            // cũng bị tính là Short. Giấu chi tiết đó là hứa hẹn quá tay.
            text: {
                if (!settings) return ""
                const minS = settings.videoMinDurationSec
                const maxM = Math.round(settings.videoMaxDurationSec / 60)
                if (settings.videoKindFilter === "short")
                    return "→ Chỉ lấy video ≤ 3 phút. YouTube không báo 'đây là Short', app phân loại theo thời lượng nên video thường ngắn cũng được lấy."
                if (settings.videoKindFilter === "both")
                    return "→ Lấy mọi video từ 1 giây đến " + maxM + " phút."
                return "→ Chỉ lấy video dài hơn " + minS + " giây (đặt ở ô dưới), tối đa " + maxM + " phút."
            }
            color: Theme.textMuted
            font.pixelSize: 11
            wrapMode: Text.WordWrap
            Layout.fillWidth: true
        }
    }

    GridLayout {
        columns: 2
        columnSpacing: 16
        rowSpacing: 12
        Layout.fillWidth: true

        // Sàn thời lượng — trước Pass 89 chỉ sửa được bằng tay trong
        // settings.json. Ẩn ở khớp "cả hai"/"chỉ Short" vì hai khớp đó bỏ sàn.
        ColumnLayout {
            spacing: 2
            Layout.fillWidth: true
            visible: !settings || settings.videoKindFilter === "long"
            Label {
                text: "TG tối thiểu (giây)"
                color: Theme.text
                font.pixelSize: Theme.textMd
                font.bold: true
            }
            Label {
                text: "Video ngắn hơn mức này bị bỏ qua — đây là thứ chặn Short ở khớp 'Chỉ video'."
                color: Theme.textMuted
                font.pixelSize: 11
                wrapMode: Text.WordWrap
                Layout.fillWidth: true
            }
        }
        SpinBox {
            Layout.preferredWidth: 180
            Layout.alignment: Qt.AlignRight
            visible: !settings || settings.videoKindFilter === "long"
            from: 1; to: 600; stepSize: 10
            value: settings ? settings.videoMinDurationSec : 60
            editable: true
            onValueModified: if (settings) settings.videoMinDurationSec = value
        }

        ColumnLayout {
            spacing: 2
            Layout.fillWidth: true
            Label {
                text: "Chu kỳ quét (ms)"
                color: Theme.text
                font.pixelSize: Theme.textMd
                font.bold: true
            }
            Label {
                text: "Chu kỳ kiểm tra & reload Chrome (tần suất này liên quan trực tiếp tới tốc độ bắt video)."
                color: Theme.textMuted
                font.pixelSize: 11
                wrapMode: Text.WordWrap
                Layout.fillWidth: true
            }
        }
        SpinBox {
            Layout.preferredWidth: 180
            Layout.alignment: Qt.AlignRight
            from: 1000; to: 60000; stepSize: 500
            value: settings ? settings.pollIntervalMs : 5000
            editable: true
            onValueModified: if (settings) settings.pollIntervalMs = value
            onActiveFocusChanged: {
                if (!activeFocus) {
                    var val = valueFromText(contentItem.text, locale)
                    val = Math.max(from, Math.min(to, val))
                    value = val
                    if (settings) settings.pollIntervalMs = val
                }
            }
        }
 

 
        ColumnLayout {
            spacing: 2
            Layout.fillWidth: true
            Label {
                text: "TG tối đa (phút)"
                color: Theme.text
                font.pixelSize: Theme.textMd
                font.bold: true
            }
            Label {
                text: "Giới hạn thời lượng video tối đa để tự động tải."
                color: Theme.textMuted
                font.pixelSize: 11
                wrapMode: Text.WordWrap
                Layout.fillWidth: true
            }
        }
        TextField {
            Layout.preferredWidth: 180
            Layout.alignment: Qt.AlignRight
            font.pixelSize: Theme.textMd
            color: Theme.text
            placeholderTextColor: Theme.textMuted
            text: settings ? Math.round(settings.videoMaxDurationSec / 60).toString() : "60"
            validator: IntValidator { bottom: 1; top: 120 }
            onEditingFinished: {
                let mins = parseInt(text)
                if (!isNaN(mins) && settings) {
                    settings.videoMaxDurationSec = mins * 60
                }
            }
            background: Rectangle {
                color: Theme.inputBg
                border.color: parent.activeFocus ? Theme.accent : Theme.border
                border.width: 1
                radius: Theme.radiusMd
            }
        }

        // Pass 58: ô "Daemon Limit" đã gỡ — không còn pool daemon quét nền,
        // lõi phát hiện là Data API (xem GcpWizard/QuotaPoolCard).
    }

    Rectangle {
        Layout.fillWidth: true
        Layout.topMargin: 8
        Layout.bottomMargin: 8
        implicitHeight: warningColumn.implicitHeight + 24
        color: Qt.rgba(255, 171, 0, 0.05)
        border.color: Qt.rgba(255, 171, 0, 0.2)
        border.width: 1
        radius: Theme.radiusMd

        ColumnLayout {
            id: warningColumn
            anchors.fill: parent
            anchors.margins: 12
            spacing: 6

            RowLayout {
                spacing: 8
                Layout.fillWidth: true
                Text {
                    text: "⚠"
                    font.pixelSize: 16
                    color: "#FFAB00"
                    font.bold: true
                }
                Label {
                    text: "LƯU Ý VẬN HÀNH DAEMON"
                    color: "#FFAB00"
                    font.bold: true
                    font.pixelSize: Theme.textMd
                    Layout.fillWidth: true
                }
            }

            Label {
                text: "• <b>Tự động quản lý:</b> Các tiến trình Node.js daemon được HyperClip tự động khởi chạy và giám sát ngầm. Bạn không cần cài đặt thủ công bên ngoài hệ thống.<br/>" +
                      "• <b>Khuyến nghị mạng gia đình:</b> Nên đặt giới hạn từ <b>6 - 12</b> luồng. Cấu hình này đủ để xử lý mượt mà và tránh bị YouTube quét chặn IP (429).<br/>" +
                      "• <b>Chạy chuyên nghiệp (VPS/Proxy):</b> Đặt tối đa <b>30</b> luồng khi bạn sở hữu hệ thống proxy sạch xoay vòng hoặc chạy trên máy chủ VPS cấu hình mạnh."
                color: Theme.text
                font.pixelSize: 11
                wrapMode: Text.WordWrap
                textFormat: Text.RichText
                Layout.fillWidth: true
                lineHeight: 1.3
            }
        }
    }

    // ─── CHROMEWATCHER CDP (QUÉT TRỰC TIẾP TRÌNH DUYỆT CHROME PORT 9222) ──
    Rectangle {
        Layout.fillWidth: true
        Layout.topMargin: Theme.spacingSm
        Layout.preferredHeight: 1
        color: Theme.border
    }

    ColumnLayout {
        Layout.fillWidth: true
        spacing: 6

        RowLayout {
            Layout.fillWidth: true
            spacing: 8
            Label {
                text: "CHROMEWATCHER CDP (ĐỘ TRỄ < 1.5S)"
                color: Theme.text
                font.pixelSize: Theme.textMd
                font.bold: true
            }
            Item { Layout.fillWidth: true }
            Rectangle {
                Layout.preferredHeight: 20
                Layout.preferredWidth: cdpStatusLbl.implicitWidth + 16
                radius: 10
                color: "#1A00FF88"
                border.color: "#00FF88"
                border.width: 1
                Label {
                    id: cdpStatusLbl
                    anchors.centerIn: parent
                    text: "CHROME PORT 9222"
                    color: "#00FF88"
                    font.pixelSize: 10
                    font.bold: true
                }
            }
        }

        Label {
            text: "Cơ chế ChromeWatcher kết nối trực tiếp Chrome DevTools Protocol (port 9222), tự động mở tab /videos cho các kênh được bật CDP và quét DOM mỗi 500ms. Bắt video mới cực nhanh (< 1.5s) mà KHÔNG tốn quota Google Data API."
            color: Theme.textMuted
            font.pixelSize: 11
            wrapMode: Text.WordWrap
            Layout.fillWidth: true
        }

        Rectangle {
            Layout.fillWidth: true
            Layout.preferredHeight: 56
            radius: Theme.radiusMd
            color: Theme.cardBg
            border.color: Theme.border
            border.width: 1

            RowLayout {
                anchors.fill: parent
                anchors.margins: 8
                spacing: 12

                Label {
                    text: "🌐"
                    font.pixelSize: 22
                }

                ColumnLayout {
                    Layout.fillWidth: true
                    spacing: 2
                    Label {
                        text: "Quy tắc tự động ngắt quét API:"
                        color: Theme.text
                        font.pixelSize: 11
                        font.bold: true
                    }
                    Label {
                        text: "Kênh nào bật CDP sẽ được TẮT hoàn toàn việc gọi API YouTube để tránh bị trễ và tiết kiệm 100% quota. Bạn có thể bật/tắt CDP trực tiếp ở nút 🌐 tại Sidebar hoặc bảng Chính sách quét."
                        color: Theme.textMuted
                        font.pixelSize: 10
                        wrapMode: Text.WordWrap
                        Layout.fillWidth: true
                    }
                }
            }
        }
    }

    Button {
        text: (poller && poller.active) ? "Tạm dừng quét" : "Tiếp tục quét"
        Layout.preferredWidth: 150
        onClicked: if (poller) { poller.active ? poller.pause(backend) : poller.resume(backend) }
    }
}

