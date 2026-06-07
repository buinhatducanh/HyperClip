// src/ui/qml/UpdateBar.qml
// Auto-update toast — bottom-right notification when new version available
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Rectangle {
    id: root
    color: Theme.bg
    border.color: Theme.accent
    border.width: 1
    height: 60
    width: 360
    radius: 4

    property bool visible_: false
    property string version_: ""
    property int progress_: 0
    property bool downloaded_: false
    property string releaseNotes_: ""

    function showUpdate(version, notes) {
        version_ = version
        releaseNotes_ = notes
        downloaded_ = false
        progress_ = 0
        visible_ = true
        backend.send_command("update:check")
    }

    RowLayout {
        anchors.fill: parent
        anchors.margins: 8
        spacing: 8

        ColumnLayout {
            Layout.fillWidth: true
            spacing: 2
            Label {
                text: "🆕 HyperClip " + root.version_ + " có sẵn"
                color: Theme.accent
                font.pixelSize: 11
                font.bold: true
            }
            Label {
                text: root.releaseNotes_.substring(0, 80) + (root.releaseNotes_.length > 80 ? "..." : "")
                color: Theme.textMuted
                font.pixelSize: 9
                elide: Text.ElideRight
                Layout.fillWidth: true
            }
        }

        Button {
            text: root.downloaded_ ? "Cài đặt" : "Tải về"
            onClicked: {
                if (root.downloaded_) {
                    backend.send_command("update:install")
                } else {
                    backend.send_command("update:download")
                }
            }
        }
        Button {
            text: "×"
            Layout.preferredWidth: 24
            onClicked: root.visible_ = false
        }
    }

    // Progress overlay
    Rectangle {
        anchors.left: parent.left
        anchors.bottom: parent.bottom
        height: 2
        width: parent.width * Math.min(root.progress_, 100) / 100
        color: Theme.accent
        visible: root.progress_ > 0 && root.progress_ < 100
    }
}
