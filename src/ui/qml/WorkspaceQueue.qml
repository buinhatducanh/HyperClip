// src/ui/qml/WorkspaceQueue.qml
// Queue: status filter + workspace list
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Rectangle {
    id: root
    color: Theme.bg
    border.color: Theme.border
    border.width: 1

    property string channelFilter: ""
    property string statusFilter: "all"
    signal openWorkspace(string ws_id)

    function passFilter(itemStatus, itemTitle, itemChannel) {
        if (statusFilter !== "all" && statusFilter !== itemStatus)
            return false
        if (channelFilter && channelFilter !== itemChannel)
            return false
        return true
    }

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 6
        spacing: 4

        // ─── Status filter pills & Clear button ─────────────────
        RowLayout {
            Layout.fillWidth: true
            spacing: 6

            FilterPills {
                Layout.fillWidth: true
                current: root.statusFilter
                onFilterChanged: function(v) { root.statusFilter = v }
            }

            IconButton {
                iconName: "delete"
                label: "Dọn queue"
                iconSize: 12
                Layout.alignment: Qt.AlignVCenter
                onClicked: workspaceModel.clear_finished(backend)
            }
        }

        Rectangle {
            Layout.fillWidth: true; Layout.preferredHeight: 1
            color: Theme.border
            Layout.topMargin: 2; Layout.bottomMargin: 2
        }

        // ─── Workspace list ─────────────────────────────────────
        ListView {
            id: queueList
            Layout.fillWidth: true
            Layout.fillHeight: true
            model: workspaceModel
            clip: true
            spacing: 2
            delegate: WorkspaceCard {
                width: queueList.width
                ws_id: model.id
                status: root.passFilter(model.status || "pending", model.title, model.channel_name) ? model.status || "pending" : "hidden"
                visible: status !== "hidden"
                height: status === "hidden" ? 0 : 82
                title: model.title
                progress: model.progress || 0
                channel_name: model.channel_name
                thumbnail: model.thumbnail
                isShort: model.isShort
                durationSec: model.durationSec || 0
                quality: model.quality || 1080
                speed: model.speed || 1.0
                fileSize: model.fileSize || ""
                ageLabel: model.ageLabel || ""
                onWorkspaceClicked: function(id) {
                    root.openWorkspace(id)
                }
            }

            Label {
                anchors.centerIn: parent
                visible: queueList.count === 0
                text: "Chưa có video nào"
                color: Theme.textMuted
                font.pixelSize: 16
            }
        }
    }
}
