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
                // Found — pull data
                currentWorkspaceData = {
                    "id": id,
                    "title": workspaceModel.data(idx, Qt.UserRole + 3) || "",
                    "channel_name": workspaceModel.data(idx, Qt.UserRole + 5) || "",
                    "progress": workspaceModel.data(idx, Qt.UserRole + 4) || 0,
                    "quality": 1080,
                    "speed": 1.0,
                    "trimStart": 0.0,
                    "trimEnd": 0.0,
                    "thumbnail": workspaceModel.data(idx, Qt.UserRole + 7) || "",
                    "thumbnail_local": "",
                    "durationSec": 0,
                    "video_id": id,
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
