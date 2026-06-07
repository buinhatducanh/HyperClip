// src/ui/qml/StorageCard.qml
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Rectangle {
    color: Theme.bg
    border.color: Theme.border
    border.width: 1
    Layout.preferredHeight: 200

    property var storage: ({})

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 12
        spacing: 8

        RowLayout {
            Layout.fillWidth: true
            Label {
                text: "STORAGE"
                color: Theme.accent
                font.pixelSize: 13
                font.bold: true
                Layout.fillWidth: true
            }
            Button {
                text: "Refresh"
                onClicked: storage.refresh(backend)
            }
        }

        GridLayout {
            columns: 2
            columnSpacing: 24
            rowSpacing: 8
            Layout.fillWidth: true

            Label { text: "Video storage"; color: Theme.textMuted; font.pixelSize: 11 }
            TextField {
                Layout.fillWidth: true
                text: settings.videoStoragePath
                onEditingFinished: settings.videoStoragePath = text
            }

            Label { text: "Output folder"; color: Theme.textMuted; font.pixelSize: 11 }
            TextField {
                Layout.fillWidth: true
                text: settings.outputPath
                onEditingFinished: settings.outputPath = text
            }

            Label { text: "Cleanup (days)"; color: Theme.textMuted; font.pixelSize: 11 }
            SpinBox {
                Layout.fillWidth: true
                from: 0
                to: 365
                value: settings.downloadsCleanupDays
                onValueChanged: settings.downloadsCleanupDays = value
            }

            Label { text: "Concurrent renders"; color: Theme.textMuted; font.pixelSize: 11 }
            SpinBox {
                Layout.fillWidth: true
                from: 1
                to: 16
                value: settings.maxConcurrentRenders
                onValueChanged: settings.maxConcurrentRenders = value
            }
        }

        RowLayout {
            Layout.fillWidth: true
            Button {
                text: "Clear downloads"
                onClicked: activityModel.add_entry("storage", "Clear downloads requested", "warn")
            }
            Button {
                text: "Clear blur bg"
                onClicked: activityModel.add_entry("storage", "Clear blur requested", "warn")
            }
        }
    }
}
