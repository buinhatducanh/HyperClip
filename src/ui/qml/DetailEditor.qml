// src/ui/qml/DetailEditor.qml
// Center pane container — switches between SettingsPanel / VideoDetailPanel / RenderedVideoDetail
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Rectangle {
    id: root
    color: Theme.bg
    border.color: Theme.border
    border.width: 1

    property string currentView: "settings"  // settings | workspace | rendered
    property string currentWorkspaceId: ""
    property string currentRenderedId: ""
    property var currentWorkspaceData: ({})
    property var currentRenderedData: ({})

    function loadWorkspace(id) {
        currentWorkspaceId = id
        currentView = "workspace"
        // Lookup in workspaceModel — find the row
        for (let i = 0; i < workspaceModel.rowCount(); i++) {
            const idx = workspaceModel.index(i, 0)
            if (workspaceModel.data(idx, Qt.UserRole + 1) === id) {
                // Found — pull data (simplified)
                currentWorkspaceData = {
                    "id": id,
                    "title": workspaceModel.data(idx, Qt.UserRole + 3) || "",
                    "channel_name": workspaceModel.data(idx, Qt.UserRole + 5) || "",
                    "progress": workspaceModel.data(idx, Qt.UserRole + 4) || 0,
                    "quality": 1080
                }
                return
            }
        }
    }
    function loadRendered(id) {
        currentRenderedId = id
        currentView = "rendered"
    }
    function showSettings() { currentView = "settings" }

    Loader {
        anchors.fill: parent
        sourceComponent: {
            if (root.currentView === "workspace") return workspaceView
            if (root.currentView === "rendered") return renderedView
            return settingsView
        }
    }

    Component {
        id: settingsView
        SettingsPanel {}
    }
    Component {
        id: workspaceView
        VideoDetailPanel {
            workspaceId: root.currentWorkspaceId
            workspaceData: root.currentWorkspaceData
        }
    }
    Component {
        id: renderedView
        RenderedVideoDetail {
            videoId: root.currentRenderedId
            videoData: root.currentRenderedData
        }
    }
}
