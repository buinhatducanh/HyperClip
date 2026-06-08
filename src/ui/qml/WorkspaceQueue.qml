// src/ui/qml/WorkspaceQueue.qml
// Right-pane queue: search + status filter + workspace list
// Navigation handled by Sidebar — no tab header needed
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Rectangle {
    id: root
    color: Theme.bg
    border.color: Theme.border
    border.width: 1

    property string searchText: ""
    property string statusFilter: "all"

    function passFilter(itemStatus, itemTitle) {
        if (statusFilter !== "all" && statusFilter !== itemStatus)
            return false
        if (searchText) {
            const title = (itemTitle || "").toLowerCase()
            if (!title.includes(searchText.toLowerCase()))
                return false
        }
        return true
    }

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 6
        spacing: 4

        // ─── Search ─────────────────────────────────────────────
        SearchBar {
            Layout.fillWidth: true
            placeholderText: "Tìm video..."
            onSearchChanged: root.searchText = searchText
            onClearClicked: root.searchText = ""
        }

        // ─── Status filter pills ────────────────────────────────
        FilterPills {
            Layout.fillWidth: true
            current: root.statusFilter
            onFilterChanged: function(v) { root.statusFilter = v }
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
                status: root.passFilter(model.status || "pending", model.title) ? model.status || "pending" : "hidden"
                visible: status !== "hidden"
                height: status === "hidden" ? 0 : 76
                title: model.title
                progress: model.progress || 0
                channel_name: model.channel_name
                thumbnail: model.thumbnail
                isShort: model.isShort
            }

            Label {
                anchors.centerIn: parent
                visible: queueList.count === 0
                text: "Chưa có video nào"
                color: Theme.textMuted
                font.pixelSize: 11
            }
        }
    }
}
