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

    function normalizeWorkspaceData(raw) {
        if (!raw) return {};
        let data = Object.assign({}, raw);
        
        // durationSec
        if (data.durationSec === undefined && data.duration_sec !== undefined) {
            data.durationSec = Math.round(data.duration_sec);
        } else if (data.durationSec !== undefined) {
            data.durationSec = Math.round(data.durationSec);
        }
        
        // trimStart
        if (data.trimStart === undefined) {
            let ts = data.trim_start_sec !== undefined ? data.trim_start_sec : (data.trim_start !== undefined ? data.trim_start : 0);
            data.trimStart = Math.round(ts);
        } else {
            data.trimStart = Math.round(data.trimStart);
        }
        
        // trimEnd
        if (data.trimEnd === undefined) {
            let te = data.trim_end_sec !== undefined ? data.trim_end_sec : (data.trim_end !== undefined ? data.trim_end : 0);
            data.trimEnd = Math.round(te);
        } else {
            data.trimEnd = Math.round(data.trimEnd);
        }
        
        // speed
        if (data.videoSpeed !== undefined) {
            data.speed = data.videoSpeed;
        } else if (data.video_speed !== undefined) {
            data.speed = data.video_speed;
        } else if (data.speed === undefined) {
            data.speed = 1.0;
        }
        
        // video_id
        if (data.video_id === undefined && data.videoId !== undefined) {
            data.video_id = data.videoId;
        }
        if (data.video_id === undefined && data.id !== undefined) {
            data.video_id = data.id;
        }
        
        // channel_id
        if (data.channel_id === undefined && data.channelId !== undefined) {
            data.channel_id = data.channelId;
        }
        
        // thumbnail & thumbnail_local
        let localThumb = data.thumbnailLocal || data.thumbnail_local || data.thumbnail || "";
        if (localThumb && !localThumb.startsWith("http") && !localThumb.startsWith("file://") && !localThumb.startsWith("qrc:")) {
            localThumb = "file:///" + localThumb.replace(/\\/g, "/");
        }
        data.thumbnail = localThumb;
        data.thumbnail_local = localThumb;
        
        // fileSize format
        let size = data.fileSize !== undefined ? data.fileSize : (data.downloadedSize !== undefined ? data.downloadedSize : 0);
        if (typeof size === "number" && size > 0) {
            if (size > 1024 * 1024) {
                data.fileSizeStr = (size / (1024 * 1024)).toFixed(1) + " MB";
            } else if (size > 1024) {
                data.fileSizeStr = (size / 1024).toFixed(1) + " KB";
            } else {
                data.fileSizeStr = size + " B";
            }
        } else if (typeof size === "string") {
            data.fileSizeStr = size;
        } else {
            data.fileSizeStr = "—";
        }
        
        // Make sure we have fallbacks
        data.downloadTime = data.downloadTime || "—";
        data.downloadSpeed = data.downloadSpeed || "—";
        data.source = data.source || "yt-dlp";
        data.renderFps = data.renderFps !== undefined ? data.renderFps : null;
        data.renderWorkers = data.renderWorkers !== undefined ? data.renderWorkers : null;
        data.renderPreset = data.renderPreset || "";
        data.renderCodec = data.renderCodec || "";
        data.outputPath = data.renderedPath || data.outputPath || "";
        
        return data;
    }

    Connections {
        target: eventBus
        function onWorkspace_updated(params) {
            if (params.id === root.currentWorkspaceId) {
                if (params.field) {
                    let updated = Object.assign({}, root.currentWorkspaceData);
                    updated[params.field] = params.value;
                    root.currentWorkspaceData = root.normalizeWorkspaceData(updated);
                } else {
                    let merged = Object.assign({}, root.currentWorkspaceData, params);
                    root.currentWorkspaceData = root.normalizeWorkspaceData(merged);
                }
            }
        }
    }

    function loadWorkspace(id) {
        currentWorkspaceId = id
        currentView = "workspace"
        // Minimal snapshot from model — full data fetched async by main.qml via workspace:get
        for (let i = 0; i < workspaceModel.rowCount(); i++) {
            const idx = workspaceModel.index(i, 0)
            if (workspaceModel.data(idx, root._roleId) === id) {
                currentWorkspaceData = normalizeWorkspaceData({
                    "id": id,
                    "title": workspaceModel.data(idx, root._roleTitle) || "",
                    "channel_name": workspaceModel.data(idx, root._roleChannel) || "",
                    "progress": workspaceModel.data(idx, root._roleProgress) || 0,
                    "thumbnail": workspaceModel.data(idx, root._roleThumbnail) || "",
                    "video_id": id,
                })
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
                    font.pixelSize: 36
                    font.bold: true
                    Layout.alignment: Qt.AlignHCenter
                }
                Label {
                    text: "Chọn một workspace để xem chi tiết"
                    color: Theme.textMuted
                    font.pixelSize: 16
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
