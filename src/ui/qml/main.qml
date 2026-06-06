import QtQuick
import QtQuick.Window
import QtQuick.Layouts
import QtQuick.Controls

ApplicationWindow {
    id: root
    width: 1280
    height: 800
    visible: true
    title: "HyperClip"
    color: Theme.bg

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
