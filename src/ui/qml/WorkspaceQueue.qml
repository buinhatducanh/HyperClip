// src/ui/qml/WorkspaceQueue.qml
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Rectangle {
    color: Theme.bg
    border.color: Theme.border
    border.width: 1

    ColumnLayout {
        anchors.fill: parent
        spacing: 0

        RowLayout {
            Layout.fillWidth: true
            Layout.preferredHeight: 40
            Layout.leftMargin: 8
            Layout.rightMargin: 8

            Label {
                text: "Queue"
                color: Theme.accent
                font.pixelSize: 14
                font.bold: true
            }

            Item { Layout.fillWidth: true }

            Label {
                text: workspaceModel.rowCount + " videos"
                color: Theme.textMuted
                font.pixelSize: 11
            }
        }

        Rectangle {
            Layout.fillWidth: true
            Layout.preferredHeight: 1
            color: Theme.border
        }

        ListView {
            id: queueList
            Layout.fillWidth: true
            Layout.fillHeight: true
            model: workspaceModel
            spacing: 2
            clip: true

            delegate: WorkspaceCard {
                ws_id: model.id
                status: model.status
                title: model.title
                progress: model.progress || 0
                channel_name: model.channel_name
                thumbnail: model.thumbnail
                isShort: model.isShort
                width: queueList.width
            }
        }
    }
}
