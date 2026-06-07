// src/ui/qml/PollerPanel.qml
// Poller control center — start/stop, status, new video count, last error.
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Rectangle {
    color: Theme.bg
    border.color: Theme.border
    border.width: 1
    Layout.preferredHeight: 240

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 12
        spacing: 8

        RowLayout {
            Layout.fillWidth: true
            Label {
                text: "POLLER"
                color: Theme.accent
                font.pixelSize: 13
                font.bold: true
                Layout.fillWidth: true
            }
            Rectangle {
                width: 10; height: 10; radius: 5
                color: poller.active ? Theme.success : Theme.textMuted
            }
            Label {
                text: poller.active ? "ACTIVE" : "PAUSED"
                color: poller.active ? Theme.success : Theme.textMuted
                font.pixelSize: 10
                font.bold: true
            }
        }

        GridLayout {
            columns: 2
            columnSpacing: 16
            rowSpacing: 6
            Layout.fillWidth: true

            Label { text: "Interval"; color: Theme.textMuted; font.pixelSize: 11 }
            Label {
                text: poller.pollIntervalMs + " ms"
                color: Theme.text
                font.pixelSize: 11
                font.family: "monospace"
            }

            Label { text: "Last poll"; color: Theme.textMuted; font.pixelSize: 11 }
            Label { text: poller.lastPollLabel; color: Theme.text; font.pixelSize: 11 }

            Label { text: "New videos"; color: Theme.textMuted; font.pixelSize: 11 }
            Label {
                text: poller.newVideoCount
                color: poller.newVideoCount > 0 ? Theme.accent : Theme.text
                font.pixelSize: 11
                font.bold: poller.newVideoCount > 0
            }

            Label { text: "Innertube"; color: Theme.textMuted; font.pixelSize: 11 }
            Label {
                text: poller.innertubeDegraded ? "DEGRADED" : "OK"
                color: poller.innertubeDegraded ? Theme.error : Theme.success
                font.pixelSize: 11
            }
        }

        Label {
            text: poller.lastError
            color: Theme.error
            font.pixelSize: 10
            visible: poller.lastError !== ""
            wrapMode: Text.WordWrap
            Layout.fillWidth: true
        }

        RowLayout {
            Layout.fillWidth: true
            Button {
                text: poller.active ? "Pause" : "Resume"
                onClicked: poller.resume(backend)
            }
            Button {
                text: "Refresh"
                onClicked: poller.refresh_from_backend(backend)
            }
            Item { Layout.fillWidth: true }
        }
    }
}
