// src/ui/qml/LogViewer.qml
// Viewer for backend log files (hyperclip.log, hyperclip-error.log, etc.)
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

SettingsCard {
    title: "BACKEND LOGS"
    Layout.preferredHeight: 500
    Layout.minimumHeight: 300
    Layout.fillHeight: true

    property var currentFile: ""

    Component.onCompleted: {
        logFilesModel.refresh()
    }

    // File selector
    RowLayout {
        Layout.fillWidth: true
        spacing: 8

        Label {
            text: "File:"
            color: Theme.text
            font.pixelSize: 14
            Layout.preferredWidth: 40
        }

        ComboBox {
            id: fileCombo
            Layout.fillWidth: true
            model: logFilesModel
            textRole: "name"
            onCurrentIndexChanged: {
                if (currentIndex >= 0 && currentText) {
                    logFileModel.load(currentText, 500)
                }
            }
        }

        IconButton {
            iconName: "refresh"
            label: ""
            iconSize: 14
            Layout.minimumWidth: 36
            onClicked: {
                logFilesModel.refresh()
                fileCombo.currentIndex = 0
            }
        }

        IconButton {
            iconName: "folder"
            label: "Export all"
            iconSize: 12
            Layout.minimumWidth: 110
            onClicked: backend.send_command("logs:export")
        }
    }

    // Log content
    Rectangle {
        Layout.fillWidth: true
        Layout.fillHeight: true
        Layout.minimumHeight: 150
        color: Theme.bgDark
        border.color: Theme.border
        border.width: 1
        radius: 4

        Flickable {
            id: flick
            anchors.fill: parent
            anchors.margins: 8
            clip: true
            contentHeight: logContent.implicitHeight

            Text {
                id: logContent
                width: flick.width
                text: logFileModel.loading ? "Loading..." : logFileModel.lines.join("\n")
                color: Theme.text
                font.family: "monospace"
                font.pixelSize: 12
                wrapMode: Text.WordWrap
                renderType: Text.NativeRendering
            }
        }

        // Auto-scroll to bottom when new content
        Connections {
            target: logFileModel
            function onLinesChanged() {
                flick.contentY = flick.contentHeight
            }
        }
    }

    // Status bar
    RowLayout {
        Layout.fillWidth: true
        Label {
            text: logFileModel.file_name ? qsTr("Showing: ") + logFileModel.file_name : "No file selected"
            color: Theme.textMuted
            font.pixelSize: 12
        }
        Label {
            Layout.alignment: Qt.AlignRight
            text: logFileModel.loading ? "⟳ Loading..." : (logFileModel.lines.length > 0 ? qsTr("%1 lines").arg(logFileModel.lines.length) : "Empty")
            color: Theme.textMuted
            font.pixelSize: 12
        }
    }
}