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
        onValueModified: (newVal) => {
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
            onValueModified: workspaceModel.update_field(workspaceId, "trimStart", value, backend)
        }
        Label { text: "→"; color: Theme.text; font.pixelSize: Theme.textSm }
        SpinBox {
            id: trimEnd
            from: 0; to: (workspaceData.durationSec || 3600)
            value: workspaceData.trimEnd || (workspaceData.durationSec || 60)
            editable: true; Layout.fillWidth: true
            onValueModified: workspaceModel.update_field(workspaceId, "trimEnd", value, backend)
        }
        Label { text: "giây"; color: Theme.textMuted; font.pixelSize: Theme.textXs }
    }

    // Bottom Bar Color Selection
    RowLayout {
        Layout.fillWidth: true
        Layout.preferredHeight: 36
        spacing: 8
        Label {
            text: "Màu thanh dưới"
            color: "#888"
            font.pixelSize: 16
            Layout.preferredWidth: 80
        }
        RowLayout {
            Layout.fillWidth: true
            spacing: 6
            property var colors: ["#00B4FF", "#FF007F", "#FFCC00", "#00FF66", "#FF3333"]
            property string activeColor: workspaceData.bottomBarColor || "#00B4FF"

            Repeater {
                model: parent.colors
                delegate: Rectangle {
                    width: 24
                    height: 24
                    radius: 12
                    color: modelData
                    border.color: parent.activeColor.toLowerCase() === modelData.toLowerCase() ? (Theme.accent || "#00B4FF") : "transparent"
                    border.width: 2
                    scale: mouseArea.containsMouse ? 1.15 : 1.0
                    Behavior on scale { NumberAnimation { duration: 100 } }

                    MouseArea {
                        id: mouseArea
                        anchors.fill: parent
                        hoverEnabled: true
                        onClicked: {
                            workspaceModel.update_field(workspaceId, "bottomBarColor", modelData, backend)
                            customColorInput.text = ""
                        }
                    }
                }
            }

            TextField {
                id: customColorInput
                Layout.fillWidth: true
                Layout.preferredHeight: 28
                placeholderText: "Hex (VD: #00B4FF)"
                font.pixelSize: 14
                color: "#fff"
                background: Rectangle {
                    color: "#1e1e1e"
                    border.color: customColorInput.activeFocus ? (Theme.accent || "#00B4FF") : "#333"
                    border.width: 1
                    radius: 2
                }
                text: {
                    let cur = workspaceData.bottomBarColor || "#00B4FF"
                    return parent.colors.indexOf(cur) === -1 ? cur : ""
                }
                onEditingFinished: {
                    let val = text.trim()
                    if (val.match(/^#[0-9A-Fa-f]{6}$/) || val.match(/^#[0-9A-Fa-f]{3}$/)) {
                        workspaceModel.update_field(workspaceId, "bottomBarColor", val, backend)
                    }
                }
            }
        }
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
