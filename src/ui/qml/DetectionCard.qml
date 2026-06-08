// src/ui/qml/DetectionCard.qml
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

SettingsCard {
    title: "DETECTION"
    Layout.preferredHeight: 220

    ColumnLayout {
        width: parent.width
        spacing: 8

        RowLayout {
            Layout.fillWidth: true
            Switch {
                checked: settings.pollingEnabled
                onToggled: settings.pollingEnabled = checked
                Layout.alignment: Qt.AlignRight
            }
        }

        Label {
            text: "Status: " + (poller.active ? "Active" : "Paused")
                  + (poller.lastError ? " · " + poller.lastError : "")
            color: poller.active ? Theme.success : Theme.textMuted
            font.pixelSize: 10
        }

        GridLayout {
            columns: 2
            columnSpacing: 24
            rowSpacing: 8
            Layout.fillWidth: true

            Label { text: "Poll interval (ms)"; color: Theme.textMuted; font.pixelSize: 11 }
            SpinBox {
                Layout.fillWidth: true
                from: 1000
                to: 60000
                stepSize: 500
                value: settings.pollIntervalMs
                onValueChanged: settings.pollIntervalMs = value
            }

            Label { text: "Min duration (s)"; color: Theme.textMuted; font.pixelSize: 11 }
            SpinBox {
                Layout.fillWidth: true
                from: 0
                to: 3600
                value: settings.videoMinDurationSec
                onValueChanged: settings.videoMinDurationSec = value
            }

            Label { text: "Max duration (s)"; color: Theme.textMuted; font.pixelSize: 11 }
            SpinBox {
                Layout.fillWidth: true
                from: 60
                to: 7200
                value: settings.videoMaxDurationSec
                onValueChanged: settings.videoMaxDurationSec = value
            }
        }

        Button {
            text: poller.active ? "Pause" : "Resume"
            onClicked: poller.active ? poller.pause(backend) : poller.resume(backend)
        }
    }
}
