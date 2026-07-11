// src/ui/qml/RenderedVideoDetail.qml
// Center pane: rendered video output detail (output vs source, file info)
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

ScrollView {
    id: root
    clip: true
    property string videoId: ""
    property var videoData: ({})

    function loadFromModel(idx) {
        if (idx < 0 || idx >= renderedModel.rowCount()) return
        // Lookup by index from renderedModel — placeholder for now
    }

    ColumnLayout {
        width: root.width - 24
        spacing: 12
        x: 12
        y: 12

        RowLayout {
            Layout.fillWidth: true
            Label {
                text: "Rendered Video"
                color: Theme.text
                font.pixelSize: 27
                font.bold: true
                Layout.fillWidth: true
            }
            IconButton {
                iconName: "archive"
                label: "Archive"
                iconSize: 12
                Layout.minimumWidth: 70
                onClicked: renderedModel.archive(backend, root.videoId)
            }
            IconButton {
                iconName: "folder"
                label: "Folder"
                iconSize: 12
                Layout.minimumWidth: 70
                onClicked: renderedModel.open_folder(backend, root.videoId)
            }
        }

        // Video preview
        Rectangle {
            Layout.fillWidth: true
            Layout.preferredHeight: 300
            color: "black"
            border.color: Theme.border
            border.width: 1
            clip: true

            Image {
                anchors.fill: parent
                fillMode: Image.PreserveAspectFit
                source: root.videoData.thumbnail || ""
                visible: root.videoData.thumbnail && root.videoData.thumbnail !== ""
            }
            Label {
                anchors.centerIn: parent
                text: root.videoData.thumbnail ? "" : (root.videoData.title || root.videoId || "Chọn video đã render")
                color: Theme.textMuted
                font.pixelSize: 14
                visible: !root.videoData.thumbnail || root.videoData.thumbnail === ""
            }
        }

        // Output info
        GroupBox {
            Layout.fillWidth: true
            title: "OUTPUT"
            background: Rectangle {
                color: Theme.bg
                border.color: Theme.border
                border.width: 1
            }
            label: Label {
                text: parent.title
                color: Theme.success
                font.pixelSize: 16
                font.bold: true
            }
            GridLayout {
                columns: 2
                columnSpacing: 16
                rowSpacing: 4
                anchors.fill: parent
                Label { text: "Path"; color: Theme.textMuted; font.pixelSize: 15 }
                Label {
                    text: root.videoData.outputPath || "—"
                    color: root.videoData.outputPath ? Theme.accent : Theme.text
                    font.pixelSize: 14
                    font.family: "monospace"
                    font.underline: !!root.videoData.outputPath
                    elide: Text.ElideMiddle
                    Layout.fillWidth: true

                    MouseArea {
                        anchors.fill: parent
                        enabled: !!root.videoData.outputPath
                        cursorShape: Qt.PointingHandCursor
                        onClicked: {
                            if (root.videoData.outputPath) {
                                backend.send_command("system:openFolder", {"path": root.videoData.outputPath})
                            }
                        }
                    }
                }
                Label { text: "Size"; color: Theme.textMuted; font.pixelSize: 15 }
                Label { text: ((root.videoData.fileSize || 0) / 1048576).toFixed(1) + " MB"; color: Theme.text; font.pixelSize: 15; font.family: "monospace" }
                Label { text: "Duration"; color: Theme.textMuted; font.pixelSize: 15 }
                Label { text: (root.videoData.duration || 0).toFixed(1) + "s"; color: Theme.text; font.pixelSize: 15; font.family: "monospace" }
                Label { text: "Quality"; color: Theme.textMuted; font.pixelSize: 15 }
                Label { text: root.videoData.quality || "1080p"; color: Theme.text; font.pixelSize: 15; font.family: "monospace" }
                Label { text: "Rendered at"; color: Theme.textMuted; font.pixelSize: 15 }
                Label { text: root.videoData.renderedAt ? new Date(root.videoData.renderedAt * 1000).toLocaleString() : "—"; color: Theme.text; font.pixelSize: 15; font.family: "monospace" }
            }
        }

        // Source vs output compare
        GroupBox {
            Layout.fillWidth: true
            title: "COMPARE"
            background: Rectangle {
                color: Theme.bg
                border.color: Theme.border
                border.width: 1
            }
            label: Label {
                text: parent.title
                color: Theme.accent
                font.pixelSize: 16
                font.bold: true
            }
            RowLayout {
                anchors.fill: parent
                spacing: 12
                Rectangle {
                    Layout.fillWidth: true
                    Layout.preferredHeight: 140
                    color: "black"
                    border.color: Theme.border
                    border.width: 1
                    Label {
                        anchors.centerIn: parent
                        text: "YOUTUBE\n(gốc)"
                        color: Theme.textMuted
                        font.pixelSize: 15
                        horizontalAlignment: Text.AlignHCenter
                    }
                }
                Rectangle {
                    Layout.fillWidth: true
                    Layout.preferredHeight: 140
                    color: "black"
                    border.color: Theme.success
                    border.width: 1
                    Label {
                        anchors.centerIn: parent
                        text: "HYPERCLIP\n(đã render)"
                        color: Theme.success
                        font.pixelSize: 15
                        horizontalAlignment: Text.AlignHCenter
                    }
                }
            }
        }

        IconButton {
            iconName: "delete"
            label: "Remove"
            iconSize: 12
            iconColorIdle: Theme.textMuted
            iconColorHover: "white"
            colorHover: Theme.error + "30"
            colorPressed: Theme.error
            Layout.minimumWidth: 80
            onClicked: {
                renderedModel.remove(backend, root.videoId)
                activityModel.add_entry("rendered", "Removed " + root.videoId, "info")
            }
        }
    }
}
