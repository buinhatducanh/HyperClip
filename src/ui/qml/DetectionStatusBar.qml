// src/ui/qml/DetectionStatusBar.qml
// Compact status bar — source badge, latency, sessions.
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Rectangle {
    id: root
    color: Theme.bg
    border.color: Theme.border
    border.width: 1
    Layout.preferredHeight: 28
    Layout.preferredWidth: 196

    property string source: auth.oauthReady ? "OAuth" : (auth.isReady ? "Innertube" : "No auth")
    property bool backoff: poller.innertubeDegraded || poller.lastError !== ""
    property string sourceColor: backoff ? Theme.error
                               : source === "OAuth" ? Theme.success
                               : source === "Innertube" ? Theme.accent
                               : Theme.textMuted

    RowLayout {
        anchors.fill: parent
        anchors.leftMargin: 6
        anchors.rightMargin: 6
        spacing: 4

        // Active dot
        Rectangle {
            width: 6; height: 6; radius: 3
            color: poller.active ? Theme.success : Theme.textMuted
        }

        // Source
        Label {
            text: root.source
            color: root.sourceColor
            font.pixelSize: 9
            font.bold: true
        }

        // Latency badge (only when active)
        Rectangle {
            height: 16; Layout.preferredWidth: implicitWidth + 8
            color: poller.latencyColor + "22"
            radius: 2
            visible: poller.active && poller.lastDetectionLatencyMs > 0
            Label {
                anchors.centerIn: parent
                text: poller.lastDetectionLatencyStr
                color: poller.latencyColor
                font.pixelSize: 8
                font.bold: true
            }
        }

        Item { Layout.fillWidth: true }

        // Sessions count
        Label {
            text: (typeof sessionModel !== 'undefined' && sessionModel ? (sessionModel.rowCount() || "—") : "—") + " ses"
            color: Theme.textMuted
            font.pixelSize: 8
        }
    }
}
