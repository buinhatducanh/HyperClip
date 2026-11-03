// src/ui/qml/DetectionCard.qml
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

SettingsCard {
    title: "PHÁT HIỆN"

    ColumnLayout {
        width: parent.width
        spacing: 10

        RowLayout {
            Layout.fillWidth: true
            spacing: 12
            Label {
                text: "Bật quét"
                color: Theme.textMuted
                font.pixelSize: 24
            }
            Item { Layout.fillWidth: true }
            Switch {
                checked: settings.pollingEnabled
                onToggled: settings.pollingEnabled = checked
            }
        }

        Label {
            text: "Trạng thái: " + (poller.active ? "Đang chạy" : "Tạm dừng")
                  + (poller.lastError ? " · " + poller.lastError : "")
            color: poller.active ? Theme.success : Theme.textMuted
            font.pixelSize: 21
        }

        GridLayout {
            columns: 2
            columnSpacing: 24
            rowSpacing: 10
            Layout.fillWidth: true

            Label { text: "Chu kỳ (ms)"; color: Theme.textMuted; font.pixelSize: 24 }
            SpinBox {
                Layout.fillWidth: true
                font.pixelSize: 24
                from: 1000; to: 60000; stepSize: 500
                value: settings.pollIntervalMs
                editable: true
                onValueModified: settings.pollIntervalMs = value
                onActiveFocusChanged: {
                    if (!activeFocus) {
                        var val = valueFromText(contentItem.text, locale)
                        val = Math.max(from, Math.min(to, val))
                        value = val
                        if (settings) settings.pollIntervalMs = val
                    }
                }
            }

            Label {
                text: "* Ghi chú: Chu kỳ này đồng thời là tần suất reload tab Chrome để bắt video mới."
                color: Theme.textMuted
                font.pixelSize: 18
                wrapMode: Text.WordWrap
                Layout.columnSpan: 2
                Layout.fillWidth: true
            }

            Label { text: "Số kênh dò nhanh"; color: Theme.textMuted; font.pixelSize: 24 }
            SpinBox {
                Layout.fillWidth: true
                font.pixelSize: 24
                from: 0; to: 15; stepSize: 1
                value: settings.fastProbeLimit
                editable: true
                onValueModified: settings.fastProbeLimit = value
                onActiveFocusChanged: {
                    if (!activeFocus) {
                        var val = valueFromText(contentItem.text, locale)
                        val = Math.max(from, Math.min(to, val))
                        value = val
                        if (settings) settings.fastProbeLimit = val
                    }
                }
            }

            Label {
                text: "* Số kênh ĐẦU danh sách được dò nhanh HTML mỗi chu kỳ (thấy video sớm hơn API — giảm nhãn 'YT'). Ngoài ra có thể bật ⚡ từng kênh ở sidebar. Mỗi kênh dò nhanh tốn ~0.9GB/giờ."
                color: Theme.textMuted
                font.pixelSize: 18
                wrapMode: Text.WordWrap
                Layout.columnSpan: 2
                Layout.fillWidth: true
            }



            Label { text: "TG tối đa (phút)"; color: Theme.textMuted; font.pixelSize: 24 }
            TextField {
                Layout.fillWidth: true
                font.pixelSize: 24
                color: Theme.text
                placeholderTextColor: Theme.textMuted
                text: Math.round(settings.videoMaxDurationSec / 60).toString()
                validator: IntValidator { bottom: 1; top: 120 }
                onEditingFinished: {
                    let mins = parseInt(text)
                    if (!isNaN(mins)) {
                        settings.videoMaxDurationSec = mins * 60
                    }
                }
            }
        }

        Button {
            text: poller.active ? "Tạm dừng" : "Tiếp tục"
            font.pixelSize: 24
            onClicked: poller.active ? poller.pause(backend) : poller.resume(backend)
        }
    }
}
