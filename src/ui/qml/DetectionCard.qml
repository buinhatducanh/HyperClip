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
                onValueChanged: settings.pollIntervalMs = value
            }

            Label { text: "TG tối thiểu (s)"; color: Theme.textMuted; font.pixelSize: 24 }
            SpinBox {
                Layout.fillWidth: true
                font.pixelSize: 24
                from: 0; to: 3600
                value: settings.videoMinDurationSec
                onValueChanged: settings.videoMinDurationSec = value
            }

            Label { text: "TG tối đa (s)"; color: Theme.textMuted; font.pixelSize: 24 }
            SpinBox {
                Layout.fillWidth: true
                font.pixelSize: 24
                from: 60; to: 7200
                value: settings.videoMaxDurationSec
                onValueChanged: settings.videoMaxDurationSec = value
            }
        }

        Button {
            text: poller.active ? "Tạm dừng" : "Tiếp tục"
            font.pixelSize: 24
            onClicked: poller.active ? poller.pause(backend) : poller.resume(backend)
        }
    }
}
