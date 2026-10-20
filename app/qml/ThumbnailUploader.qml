import QtQuick
import QtQuick.Layouts
import QtQuick.Controls
import QtQuick.Dialogs

Rectangle {
    id: root

    property string workspaceId: ""
    property string currentThumbnail: ""
    property string localThumbnail: ""
    signal thumbnailChanged(string path)

    color: Theme.bg
    border.color: Theme.border
    border.width: 1
    Layout.fillWidth: true
    Layout.preferredHeight: 80

    RowLayout {
        anchors.fill: parent
        anchors.margins: 8
        spacing: 12

        // Preview
        Rectangle {
            Layout.preferredWidth: 110
            Layout.preferredHeight: 62
            color: "#000"
            border.color: Theme.border
            radius: Theme.radiusSm
            clip: true

            Image {
                anchors.fill: parent
                source: root.localThumbnail || root.currentThumbnail || ""
                fillMode: Image.PreserveAspectFit
            }
        }

        // Buttons
        ColumnLayout {
            Layout.fillWidth: true
            spacing: 4

            Label {
                text: "Thumbnail (PNG/JPG)"
                color: Theme.textMuted
                font.pixelSize: Theme.textSm
                font.bold: true
            }

            RowLayout {
                spacing: 6
                Button {
                    text: "Tải ảnh lên"
                    Layout.preferredHeight: 28
                    onClicked: fileDialog.open()
                }
                Button {
                    text: "Lấy từ YouTube"
                    Layout.preferredHeight: 28
                    onClicked: {
                        if (root.workspaceId) {
                            var path = thumbnailService.download_thumbnail(root.workspaceId)
                            if (path) {
                                root.localThumbnail = path
                                root.thumbnailChanged(path)
                            }
                        }
                    }
                    enabled: root.workspaceId !== ""
                }
                Button {
                    text: "Xóa"
                    Layout.preferredHeight: 28
                    onClicked: {
                        root.localThumbnail = ""
                        root.thumbnailChanged("")
                    }
                    visible: root.localThumbnail !== ""
                }
            }
        }
    }

    FileDialog {
        id: fileDialog
        title: "Select thumbnail"
        nameFilters: ["Image files (*.png *.jpg *.jpeg)"]
        onAccepted: {
            var path = selectedFile.toString().replace("file:///", "")
            if (path.indexOf(":") === -1 && path.charAt(0) === "/") {
                path = path.substring(1)
            }
            root.localThumbnail = path
            root.thumbnailChanged(path)
        }
    }
}
