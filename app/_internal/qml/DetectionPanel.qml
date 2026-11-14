// src/ui/qml/DetectionPanel.qml
// Detection thresholds + poller monitoring + activity log
// Thiết kế gọn gàng, ẩn text giải thích vào nút HelpTip [?]
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
            text: "Bật quét tự động"
            color: Theme.text
            font.pixelSize: Theme.textMd
            font.bold: true
        }
        HelpTip {
            text: "Kích hoạt hệ thống theo dõi định kỳ danh sách kênh YouTube qua Data API v3 và CDP Watcher."
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
        font.pixelSize: 11
        font.bold: true
    }

    GridLayout {
        columns: 2
        columnSpacing: 16
        rowSpacing: 12
        Layout.fillWidth: true

        // ─── CHU KỲ QUÉT (MS) ─────────────────────────────────────────
        RowLayout {
            spacing: 6
            Layout.fillWidth: true
            Label {
                text: "Chu kỳ quét (ms)"
                color: Theme.text
                font.pixelSize: Theme.textMd
                font.bold: true
            }
            HelpTip {
                text: "Tần suất quét YouTube Data API v3 & Chrome CDP (mặc định 3.000 - 5.000 ms, liên quan trực tiếp tới tốc độ bắt video mới)."
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

        // ─── THỜI LƯỢNG TỐI ĐA (PHÚT) ─────────────────────────────────
        RowLayout {
            spacing: 6
            Layout.fillWidth: true
            Label {
                text: "Thời lượng video tối đa"
                color: Theme.text
                font.pixelSize: Theme.textMd
                font.bold: true
            }
            HelpTip {
                text: "Giới hạn thời lượng video tối đa để tự động tải (phút). Video dài hơn mức này sẽ bị bỏ qua để bảo vệ bộ nhớ máy."
            }
        }
        RowLayout {
            Layout.preferredWidth: 180
            Layout.alignment: Qt.AlignRight
            spacing: 6
            TextField {
                Layout.fillWidth: true
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
            Label { text: "phút"; color: Theme.textMuted; font.pixelSize: Theme.textMd }
        }
    }

    RowLayout {
        Layout.fillWidth: true
        spacing: 10
        Layout.topMargin: 4

        Button {
            text: (poller && poller.active) ? "Tạm dừng quét" : "Tiếp tục quét"
            Layout.preferredWidth: 140
            onClicked: if (poller) { poller.active ? poller.pause(backend) : poller.resume(backend) }
        }

        Item { Layout.fillWidth: true }

        Label {
            text: "Pool 60 Projects · Gộp 50 kênh/unit · CDP Realtime"
            color: Theme.textMuted
            font.pixelSize: 11
        }
        HelpTip {
            text: "Lõi quét Data API v3 tối ưu hóa quota kết hợp song song với Chrome CDP Watcher để bắt video <1s."
        }
    }
}
