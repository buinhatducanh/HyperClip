// src/ui/qml/DownloadCard.qml
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

SettingsCard {
    title: "TẢI XUỐNG"

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
            checked: settings ? settings.autoDownloadEnabled : true
            onToggled: if (settings) settings.autoDownloadEnabled = checked
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
            currentIndex: settings ? model.indexOf(settings.autoDownloadQuality) : 0
            onActivated: if (settings) settings.autoDownloadQuality = model[currentIndex]
        }
 
        Label { text: "Tải video ≤ (phút)"; color: Theme.textMuted; font.pixelSize: Theme.textMd }
        SpinBox {
            Layout.fillWidth: true
            font.pixelSize: Theme.textMd
            from: 1
            to: 1440
            value: settings ? settings.autoDownloadMaxAgeMinutes : 1440
            editable: true
            onValueModified: if (settings) settings.autoDownloadMaxAgeMinutes = value
        }
 
        Label { text: "Cắt tối đa (phút)"; color: Theme.textMuted; font.pixelSize: Theme.textMd }
        SpinBox {
            Layout.fillWidth: true
            font.pixelSize: Theme.textMd
            from: 1
            to: 999
            value: settings ? settings.defaultTrimLimit : 10
            editable: true
            onValueModified: if (settings) settings.defaultTrimLimit = value
        }
 
        Label { text: "Tải đồng thời"; color: Theme.textMuted; font.pixelSize: Theme.textMd }
        SpinBox {
            Layout.fillWidth: true
            font.pixelSize: Theme.textMd
            from: 1
            to: 16
            value: settings ? settings.maxConcurrentDownloads : 1
            editable: true
            onValueModified: if (settings) settings.maxConcurrentDownloads = value
        }
    }
}
