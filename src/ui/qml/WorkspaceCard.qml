// src/ui/qml/WorkspaceCard.qml
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Rectangle {
    id: card

    property string ws_id: ""
    property string status: "pending"
    property string title: ""
    property real progress: 0
    property string channel_name: ""
    property string thumbnail: ""
    property bool isShort: true

    color: Theme.bg
    border.color: status === "error" ? Theme.error
              : status === "rendering" ? Theme.accent
              : status === "done" ? Theme.success
              : Theme.border
    border.width: 1
    height: 64

    RowLayout {
        anchors.fill: parent
        anchors.margins: 8
        spacing: 8

        ColumnLayout {
            Layout.fillWidth: true
            spacing: 2

            Label {
                text: card.title || "Untitled"
                color: Theme.text
                font.pixelSize: 13
                elide: Text.ElideRight
                Layout.fillWidth: true
            }

            Label {
                text: card.channel_name || ""
                color: Theme.textMuted
                font.pixelSize: 11
            }
        }

        Label {
            text: {
                switch (status) {
                    case 'pending': return '⏳'
                    case 'downloading': return '⬇'
                    case 'ready': return '✅'
                    case 'rendering': return '🎬'
                    case 'done': return '✓'
                    case 'error': return '✗'
                    default: return '?'
                }
            }
            color: status === "error" ? Theme.error
                 : status === "done" ? Theme.success
                 : Theme.accent
            font.pixelSize: 16
        }
    }

    // Progress bar for rendering
    Rectangle {
        visible: status === "rendering" && progress > 0
        anchors.left: parent.left
        anchors.bottom: parent.bottom
        width: parent.width * Math.min(progress, 100) / 100
        height: 2
        color: Theme.accent
    }

    MouseArea {
        anchors.fill: parent
        cursorShape: Qt.PointingHandCursor
        onClicked: detailEditor.loadWorkspace(ws_id)
    }
}
