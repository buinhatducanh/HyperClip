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
