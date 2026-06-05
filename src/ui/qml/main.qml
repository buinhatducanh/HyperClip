import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Rectangle {
    color: Theme.bg
    width: 1280
    height: 800

    RowLayout {
        spacing: 0
        anchors.fill: parent

        Sidebar {
            Layout.preferredWidth: 220
            Layout.fillHeight: true
        }

        WorkspaceQueue {
            Layout.fillWidth: true
            Layout.fillHeight: true
        }

        DetailEditor {
            Layout.preferredWidth: 400
            Layout.fillHeight: true
        }
    }
}
