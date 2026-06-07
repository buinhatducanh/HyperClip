// src/ui/qml/WorkspaceQueue.qml
// Right-pane queue: 2 tabs (PIPELINE / RENDERED) + search/filter + status groups
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Rectangle {
    color: Theme.bg
    border.color: Theme.border
    border.width: 1

    property string activeTab: "pipeline"
    property string searchText: ""
    property string statusFilter: "all"

    function filterWorkspaces() {
        const all = workspaceModel.rowCount === undefined
            ? [] : Array.from({length: 0})  // placeholder
        return []
    }

    ColumnLayout {
        anchors.fill: parent
        spacing: 0

        // Tab header
        RowLayout {
            Layout.fillWidth: true
            Layout.preferredHeight: 36
            spacing: 0

            Rectangle {
                Layout.fillWidth: true
                Layout.preferredHeight: 36
                color: parent.parent.activeTab === "pipeline" ? "#1F2A33" : "transparent"
                border.color: parent.parent.activeTab === "pipeline" ? Theme.accent : "transparent"
                border.width: parent.parent.activeTab === "pipeline" ? 1 : 0
                Label {
                    anchors.centerIn: parent
                    text: "PIPELINE"
                    color: parent.parent.parent.activeTab === "pipeline" ? Theme.accent : Theme.textMuted
                    font.pixelSize: 11
                    font.bold: parent.parent.parent.activeTab === "pipeline"
                }
                MouseArea {
                    anchors.fill: parent
                    cursorShape: Qt.PointingHandCursor
                    onClicked: parent.parent.parent.activeTab = "pipeline"
                }
            }
            Rectangle {
                Layout.fillWidth: true
                Layout.preferredHeight: 36
                color: parent.parent.activeTab === "rendered" ? "#1F2A33" : "transparent"
                border.color: parent.parent.activeTab === "rendered" ? Theme.accent : "transparent"
                border.width: parent.parent.activeTab === "rendered" ? 1 : 0
                Label {
                    anchors.centerIn: parent
                    text: "RENDERED"
                    color: parent.parent.parent.activeTab === "rendered" ? Theme.accent : Theme.textMuted
                    font.pixelSize: 11
                    font.bold: parent.parent.parent.activeTab === "rendered"
                }
                MouseArea {
                    anchors.fill: parent
                    cursorShape: Qt.PointingHandCursor
                    onClicked: parent.parent.parent.activeTab = "rendered"
                }
            }
        }

        Rectangle { Layout.fillWidth: true; Layout.preferredHeight: 1; color: Theme.border }

        // Tab content
        Loader {
            id: tabLoader
            Layout.fillWidth: true
            Layout.fillHeight: true
            sourceComponent: parent.parent.activeTab === "pipeline" ? pipelineComp : renderedComp
        }

        Component {
            id: pipelineComp
            ColumnLayout {
                spacing: 4
                Layout.fillWidth: true
                Layout.fillHeight: true
                Layout.margins: 6

                SearchBar {
                    onClearClicked: parent.parent.parent.searchText = ""
                }

                FilterPills {
                    onFilterChanged: function(v) { parent.parent.parent.statusFilter = v }
                }

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
                        status: {
                            const s = model.status || "pending"
                            if (parent.parent.parent.parent.statusFilter === "all") return s
                            if (parent.parent.parent.parent.statusFilter === s) return s
                            return "hidden"
                        }
                        visible: status !== "hidden"
                        height: status === "hidden" ? 0 : 76
                        title: model.title
                        progress: model.progress || 0
                        channel_name: model.channel_name
                        thumbnail: model.thumbnail
                        isShort: model.isShort
                    }
                }
            }
        }

        Component {
            id: renderedComp
            RenderedTab {}
        }
    }
}
