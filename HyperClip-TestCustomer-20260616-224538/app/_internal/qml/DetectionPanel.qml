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

    GridLayout {
        columns: 2
        columnSpacing: 16
        rowSpacing: 12
        Layout.fillWidth: true
 
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
                text: "Chu kỳ quét YouTube Data API v3 & Chrome CDP (tần suất liên quan trực tiếp tới tốc độ bắt video)."
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
        color: Qt.rgba(56, 189, 248, 0.03)
        border.color: Qt.rgba(56, 189, 248, 0.15)
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
                    text: "⚡"
                    font.pixelSize: 16
                    color: Theme.accent
                    font.bold: true
                }
                Label {
                    text: "LÕI QUÉT HYPERCLIP (DATA API v3 & CDP WATCHER)"
                    color: Theme.accent
                    font.bold: true
                    font.pixelSize: Theme.textMd
                    Layout.fillWidth: true
                }
            }

            Label {
                text: "• <b>Tự động gộp 50 kênh/unit:</b> Tối ưu hóa tuyệt đối ngân sách Quota YouTube.<br/>" +
                      "• <b>Quản lý Quota & Pool 60 Projects:</b> Kiểm tra key, trạng thái từng project tại tab <b>Lõi quét</b>.<br/>" +
                      "• <b>Chế độ bắt video thời gian thực:</b> Hoạt động song song với Chrome CDP Watcher."
                color: Theme.text
                font.pixelSize: 11
                wrapMode: Text.WordWrap
                textFormat: Text.RichText
                Layout.fillWidth: true
                lineHeight: 1.3
            }
        }
    }

    Button {
        text: (poller && poller.active) ? "Tạm dừng quét" : "Tiếp tục quét"
        Layout.preferredWidth: 150
        onClicked: if (poller) { poller.active ? poller.pause(backend) : poller.resume(backend) }
    }
}

