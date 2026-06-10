// src/ui/qml/StatusGroup.qml
// Collapsible group header + filtered list of workspaces
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

ColumnLayout {
    id: grp
    spacing: 0
    Layout.fillWidth: true
    Layout.fillHeight: true

    property string groupStatus: "ready"
    property string groupLabel: "Sẵn sàng"
    property var groupColor: Theme.success
    property var items: []
    property bool collapsed: false
    property int collapsedByDefault: false

    Rectangle {
        Layout.fillWidth: true
        Layout.preferredHeight: 26
        color: Theme.rowEven
        border.color: Theme.border
        border.width: 0
        RowLayout {
            anchors.fill: parent
            anchors.leftMargin: 6
            anchors.rightMargin: 6
            spacing: 6
            Label {
                text: grp.collapsed ? "▸" : "▾"
                color: Theme.textMuted
                font.pixelSize: 15
            }
            Rectangle {
                Layout.preferredWidth: 8
                Layout.preferredHeight: 8
                radius: 4
                color: grp.groupColor
            }
            Label {
                text: grp.groupLabel.toUpperCase()
                color: grp.groupColor
                font.pixelSize: 15
                font.bold: true
            }
            Label {
                text: "(" + grp.items.length + ")"
                color: Theme.textMuted
                font.pixelSize: 15
            }
            Item { Layout.fillWidth: true }
        }
        MouseArea {
            anchors.fill: parent
            cursorShape: Qt.PointingHandCursor
            onClicked: grp.collapsed = !grp.collapsed
        }
    }

    Repeater {
        model: grp.collapsed ? 0 : grp.items
        delegate: WorkspaceCard {
            Layout.fillWidth: true
            ws_id: modelData.id
            status: modelData.status
            title: modelData.title
            progress: modelData.progress || 0
            channel_name: modelData.channel_name
            thumbnail: modelData.thumbnail
            isShort: modelData.isShort
            durationSec: modelData.durationSec || 0
            quality: modelData.quality || 1080
            speed: modelData.speed || 1.0
            fileSize: modelData.fileSize || ""
            ageLabel: modelData.ageLabel || ""
        }
    }
}
