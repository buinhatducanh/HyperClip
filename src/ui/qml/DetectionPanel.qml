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
                text: "Tần suất truy vấn tìm video mới (mặc định 5000ms)."
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
    }

    Button {
        text: (poller && poller.active) ? "Tạm dừng" : "Tiếp tục"
        onClicked: if (poller) { poller.active ? poller.pause(backend) : poller.resume(backend) }
    }
}

