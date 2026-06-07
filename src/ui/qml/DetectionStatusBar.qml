// src/ui/qml/DetectionStatusBar.qml
// Inline status bar showing detection source + session health.
// Embeddable in Sidebar bottom.
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Rectangle {
    id: root
    color: Theme.bg
    border.color: Theme.border
    border.width: 1
    Layout.preferredHeight: 110
    Layout.preferredWidth: 196

    property string source: auth.oauthReady ? "OAuth" : (auth.isReady ? "Innertube" : "No auth")
    property bool backoff: poller.innertubeDegraded || poller.lastError !== ""
    property string sourceColor: backoff ? Theme.error
                               : source === "OAuth" ? Theme.success
                               : source === "Innertube" ? Theme.accent
                               : Theme.textMuted

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 6
        spacing: 2

        RowLayout {
            Layout.fillWidth: true
            Label {
                text: root.source
                color: root.sourceColor
                font.pixelSize: 10
                font.bold: true
            }
            Item { Layout.fillWidth: true }
            Rectangle {
                width: 6; height: 6; radius: 3
                color: poller.active ? Theme.success : Theme.textMuted
            }
        }

        Label {
            text: "Sessions: " + (sessionModel.rowCount() || "—")
            color: Theme.textMuted
            font.pixelSize: 9
        }
        Label {
            text: "Projects: " + (projectModel.rowCount() || "—")
            color: Theme.textMuted
            font.pixelSize: 9
        }
        Label {
            text: "Last poll: " + poller.lastPollLabel
            color: Theme.textMuted
            font.pixelSize: 9
        }
        Label {
            text: poller.lastError !== "" ? "⚠ " + poller.lastError : ""
            color: Theme.error
            font.pixelSize: 9
            elide: Text.ElideRight
            Layout.fillWidth: true
        }
    }
}
