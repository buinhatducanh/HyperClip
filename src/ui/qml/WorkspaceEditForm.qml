// src/ui/qml/WorkspaceEditForm.qml
// Trim, speed, title, thumbnail edit controls
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

ColumnLayout {
    property string workspaceId: ""
    property var workspaceData: ({})

    spacing: 6

    // Title
    EditField {
        label: "Tiêu đề"
        value: workspaceData.title || ""
        onValueChanged: (newVal) => {
            workspaceModel.update_field(workspaceId, "title", newVal, backend)
        }
    }

    // Speed
    RowLayout {
        Layout.fillWidth: true
        Label {
            text: "Tốc độ"
            color: Theme.textMuted
            font.pixelSize: Theme.textSm
            Layout.preferredWidth: 80
        }
        Slider {
            id: speedSlider
            Layout.fillWidth: true
            from: 1.0; to: 2.0; stepSize: 0.1
            value: workspaceData.speed || 1.0
            onMoved: workspaceModel.update_field(workspaceId, "speed", value, backend)
        }
        Label {
            text: speedSlider.value.toFixed(1) + "x"
            color: Theme.text; font.pixelSize: Theme.textSm; font.family: "monospace"
            Layout.preferredWidth: 40
        }
    }

    // Trim
    RowLayout {
        Layout.fillWidth: true
        Label {
            text: "Cắt"
            color: Theme.textMuted; font.pixelSize: Theme.textSm
            Layout.preferredWidth: 80
        }
        SpinBox {
            id: trimStart
            from: 0; to: (workspaceData.durationSec || 3600)
            value: workspaceData.trimStart || 0
            editable: true; Layout.fillWidth: true
            onValueChanged: workspaceModel.update_field(workspaceId, "trimStart", value, backend)
        }
        Label { text: "→"; color: Theme.text; font.pixelSize: Theme.textSm }
        SpinBox {
            id: trimEnd
            from: 0; to: (workspaceData.durationSec || 3600)
            value: workspaceData.trimEnd || (workspaceData.durationSec || 60)
            editable: true; Layout.fillWidth: true
            onValueChanged: workspaceModel.update_field(workspaceId, "trimEnd", value, backend)
        }
        Label { text: "giây"; color: Theme.textMuted; font.pixelSize: Theme.textXs }
    }

    // Thumbnail
    ThumbnailUploader {
        Layout.fillWidth: true
        workspaceId: workspaceData.video_id || ""
        currentThumbnail: workspaceData.thumbnail || ""
        localThumbnail: workspaceData.thumbnail_local || ""
        onThumbnailChanged: (path) => {
            workspaceModel.update_field(workspaceId, "thumbnail", path, backend)
        }
    }
}
