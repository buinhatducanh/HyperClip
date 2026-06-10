// src/ui/qml/WorkspaceCard.qml
// Thin wrapper: display card + click handling. Action buttons live in the
// right-pane DetailEditor (Electron-style: click card → detail panel).
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Rectangle {
    id: card
    color: "transparent"
    height: 76

    property string ws_id: ""
    property string status: "pending"
    property string title: ""
    property real progress: 0
    property string channel_name: ""
    property string thumbnail: ""
    property bool isShort: true
    property int durationSec: 0
    property int quality: 1080
    property real speed: 1.0
    property string fileSize: ""
    property string ageLabel: ""
    signal workspaceClicked(string ws_id)

    WorkspaceCardDisplay {
        anchors.fill: parent
        status: card.status
        title: card.title
        progress: card.progress
        channel_name: card.channel_name
        thumbnail: card.thumbnail
        isShort: card.isShort
        durationSec: card.durationSec
        quality: card.quality
        speed: card.speed
        fileSize: card.fileSize
        ageLabel: card.ageLabel

        MouseArea {
            anchors.fill: parent
            hoverEnabled: true
            cursorShape: Qt.PointingHandCursor
            onClicked: {
                card.workspaceClicked(card.ws_id)
            }
        }
    }
}
