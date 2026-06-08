// src/ui/qml/DownloadCard.qml
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

SettingsCard {
    title: "DOWNLOAD"
    Layout.preferredHeight: 200

    ColumnLayout {
        width: parent.width
        spacing: 8

        RowLayout {
            Layout.fillWidth: true
            Switch {
                checked: settings.autoDownloadEnabled
                onToggled: settings.autoDownloadEnabled = checked
                Layout.alignment: Qt.AlignRight
            }
        }

        GridLayout {
            columns: 2
            columnSpacing: 24
            rowSpacing: 8
            Layout.fillWidth: true

            Label { text: "Default quality"; color: Theme.textMuted; font.pixelSize: 11 }
            ComboBox {
                Layout.fillWidth: true
                model: ["1080", "720", "480", "360"]
                currentIndex: model.indexOf(settings.autoDownloadQuality)
                onActivated: settings.autoDownloadQuality = model[currentIndex]
            }

            Label { text: "Trim (minutes)"; color: Theme.textMuted; font.pixelSize: 11 }
            SpinBox {
                Layout.fillWidth: true
                from: 1
                to: 999
                value: settings.defaultTrimLimit
                onValueChanged: settings.defaultTrimLimit = value
            }

            Label { text: "Concurrent downloads"; color: Theme.textMuted; font.pixelSize: 11 }
            SpinBox {
                Layout.fillWidth: true
                from: 1
                to: 16
                value: settings.maxConcurrentDownloads
                onValueChanged: settings.maxConcurrentDownloads = value
            }
        }
    }
}
