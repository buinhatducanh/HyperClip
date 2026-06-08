// src/ui/qml/WorkspaceCard.qml
// Thin wrapper: display + action strip + click handling
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Rectangle {
    id: card
    color: "transparent"
    height: col.implicitHeight

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

    ColumnLayout {
        id: col
        anchors.fill: parent
        spacing: 0

        WorkspaceCardDisplay {
            Layout.fillWidth: true
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
                id: hoverArea
                anchors.fill: parent
                hoverEnabled: true
                cursorShape: Qt.PointingHandCursor
                onClicked: detailEditor.loadWorkspace(card.ws_id)
            }
        }

        // Action strip — only show on hover over the display area
        RowLayout {
            Layout.fillWidth: true
            Layout.leftMargin: 6; Layout.rightMargin: 6
            Layout.bottomMargin: 4
            visible: hoverArea.containsMouse
            spacing: 4

            Button {
                text: "Chi tiết"
                Layout.preferredHeight: 18; font.pixelSize: 8
                onClicked: detailEditor.loadWorkspace(card.ws_id)
            }
            Button {
                text: status === "error" ? "Thử lại" : "Xóa"
                Layout.preferredHeight: 18; font.pixelSize: 8
                onClicked: {
                    if (card.status === "error") {
                        backend.send_command("workspace:retry", {"id": card.ws_id})
                    } else {
                        backend.send_command("workspace:delete", {"id": card.ws_id})
                    }
                }
            }
            Button {
                text: "Render"
                Layout.preferredHeight: 18; font.pixelSize: 8
                enabled: status === "ready" || status === "done"
                onClicked: backend.send_command("render:start", {"id": card.ws_id})
            }
            Item { Layout.fillWidth: true }
        }
    }
}
