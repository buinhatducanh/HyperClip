// src/ui/qml/DownloadCard.qml
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

SettingsCard {
    title: "TẢI XUỐNG"

    ColumnLayout {
        Layout.fillWidth: true
        spacing: Theme.spacingMd

        RowLayout {
            Layout.fillWidth: true
            spacing: Theme.spacingMd
            Label {
                text: "Tự động tải"
                color: Theme.text
                font.pixelSize: Theme.textMd
                Layout.fillWidth: true
            }
            Switch {
                checked: settings.autoDownloadEnabled
                onToggled: settings.autoDownloadEnabled = checked
            }
        }

        GridLayout {
            columns: 2
            columnSpacing: Theme.spacingLg
            rowSpacing: Theme.spacingSm
            Layout.fillWidth: true

            Label { text: "Chất lượng"; color: Theme.textMuted; font.pixelSize: Theme.textMd }
            ComboBox {
                Layout.fillWidth: true
                font.pixelSize: Theme.textMd
                model: ["1080", "720", "480", "360"]
                currentIndex: model.indexOf(settings.autoDownloadQuality)
                onActivated: settings.autoDownloadQuality = model[currentIndex]
            }

            Label { text: "Tải video ≤ (phút)"; color: Theme.textMuted; font.pixelSize: Theme.textMd }
            SpinBox {
                Layout.fillWidth: true
                font.pixelSize: Theme.textMd
                from: 1
                to: 1440
                value: settings.autoDownloadMaxAgeMinutes
                onValueChanged: settings.autoDownloadMaxAgeMinutes = value
            }

            Label { text: "Cắt tối đa (phút)"; color: Theme.textMuted; font.pixelSize: Theme.textMd }
            SpinBox {
                Layout.fillWidth: true
                font.pixelSize: Theme.textMd
                from: 1
                to: 999
                value: settings.defaultTrimLimit
                onValueChanged: settings.defaultTrimLimit = value
            }

            Label { text: "Tải đồng thời"; color: Theme.textMuted; font.pixelSize: Theme.textMd }
            SpinBox {
                Layout.fillWidth: true
                font.pixelSize: Theme.textMd
                from: 1
                to: 16
                value: settings.maxConcurrentDownloads
                onValueChanged: settings.maxConcurrentDownloads = value
            }
        }
    }
}
