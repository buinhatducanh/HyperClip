// src/ui/qml/Sidebar.qml
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Rectangle {
    color: Theme.bg
    border.color: Theme.border
    border.width: 1

    property string currentPage: "queue"

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 6
        spacing: 4

        Label {
            text: "HyperClip"
            color: Theme.accent
            font.pixelSize: 16
            font.bold: true
            Layout.leftMargin: 4
        }

        Label {
            text: "24/7 YouTube auto-capture"
            color: Theme.textMuted
            font.pixelSize: 9
            Layout.leftMargin: 4
        }

        Rectangle {
            Layout.fillWidth: true
            Layout.preferredHeight: 1
            color: Theme.border
            Layout.topMargin: 4
            Layout.bottomMargin: 4
        }

        NavItem {
            label: "Queue"; icon: "📋"
            active: parent.parent.currentPage === "queue"
            onClicked: parent.parent.currentPage = "queue"
        }
        NavItem {
            label: "Channels"; icon: "📺"
            active: parent.parent.currentPage === "channels"
            onClicked: parent.parent.currentPage = "channels"
        }
        NavItem {
            label: "Rendered"; icon: "🎬"
            active: parent.parent.currentPage === "rendered"
            onClicked: parent.parent.currentPage = "rendered"
        }
        NavItem {
            label: "Settings"; icon: "⚙"
            active: parent.parent.currentPage === "settings"
            onClicked: parent.parent.currentPage = "settings"
        }
        NavItem {
            label: "Operation"; icon: "🔧"
            active: parent.parent.currentPage === "operation"
            onClicked: parent.parent.currentPage = "operation"
        }

        ChannelList {
            Layout.fillWidth: true
            Layout.fillHeight: true
            Layout.topMargin: 8
        }

        Item {
            Layout.fillHeight: true
            visible: false
        }

        DetectionStatusBar {
            Layout.alignment: Qt.AlignHCenter
            Layout.bottomMargin: 4
        }
    }

    component NavItem : Rectangle {
        property string label: ""
        property string icon: ""
        property bool active: false
        signal clicked()

        Layout.fillWidth: true
        Layout.preferredHeight: 28
        Layout.leftMargin: 4
        Layout.rightMargin: 4
        color: active ? "#1F2A33" : Theme.bg
        border.color: active ? Theme.accent : "transparent"
        border.width: 1

        RowLayout {
            anchors.fill: parent
            anchors.leftMargin: 8
            spacing: 8

            Label { text: parent.parent.icon; font.pixelSize: 12 }
            Label {
                text: parent.parent.label
                color: parent.parent.active ? Theme.accent : Theme.text
                font.pixelSize: 11
                font.bold: parent.parent.active
            }
        }
        MouseArea {
            anchors.fill: parent
            cursorShape: Qt.PointingHandCursor
            onClicked: parent.clicked()
        }
    }
}
