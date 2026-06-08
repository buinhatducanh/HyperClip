// src/ui/qml/DetailEditor.qml
// Right pane: workspace detail / rendered detail / empty state
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Rectangle {
    id: root
    color: Theme.bg
    border.color: Theme.border
    border.width: 1

    property string currentView: "empty"  // empty | workspace | rendered
    property string currentWorkspaceId: ""
    property string currentRenderedId: ""
    property var currentWorkspaceData: ({})
    property var currentRenderedData: ({})

    // Mirror of WorkspaceModel role constants (see workspace_model.py)
    readonly property int _roleId: Qt.UserRole + 1
    readonly property int _roleStatus: Qt.UserRole + 2
    readonly property int _roleTitle: Qt.UserRole + 3
    readonly property int _roleProgress: Qt.UserRole + 4
    readonly property int _roleChannel: Qt.UserRole + 5
    readonly property int _roleCreatedAt: Qt.UserRole + 6
    readonly property int _roleThumbnail: Qt.UserRole + 7

    function loadWorkspace(id) {
        currentWorkspaceId = id
        currentView = "workspace"
        for (let i = 0; i < workspaceModel.rowCount(); i++) {
            const idx = workspaceModel.index(i, 0)
            if (workspaceModel.data(idx, root._roleId) === id) {
                currentWorkspaceData = {
                    "id": id,
                    "title": workspaceModel.data(idx, root._roleTitle) || "",
                    "channel_name": workspaceModel.data(idx, root._roleChannel) || "",
                    "progress": workspaceModel.data(idx, root._roleProgress) || 0,
                    "quality": 1080,
                    "speed": 1.0,
                    "trimStart": 0.0,
                    "trimEnd": 0.0,
                    "thumbnail": workspaceModel.data(idx, root._roleThumbnail) || "",
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

    Loader {
        anchors.fill: parent
        sourceComponent: {
            if (root.currentView === "workspace") return workspaceView
            if (root.currentView === "rendered") return renderedView
            return emptyView
        }
    }

    Component {
        id: emptyView
        Rectangle {
            color: Theme.bg
            ColumnLayout {
                anchors.centerIn: parent
                spacing: 8
                Label {
                    text: "HyperClip"
                    color: Theme.accent
                    font.pixelSize: 24
                    font.bold: true
                    Layout.alignment: Qt.AlignHCenter
                }
                Label {
                    text: "Chọn một workspace để xem chi tiết"
                    color: Theme.textMuted
                    font.pixelSize: 11
                    Layout.alignment: Qt.AlignHCenter
                }
            }
        }
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
