// src/ui/qml/Sidebar.qml
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Rectangle {
    color: Theme.bg
    border.color: Theme.border
    border.width: 1

    property string activeItem: "queue"
    signal navigateToPage(string page)

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
            text: "Bắt video YouTube 24/7"
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
            label: "Hàng đợi"; icon: "📋"
            active: parent.parent.activeItem === "queue"
            onClicked: parent.parent.navigateToPage("queue")
        }
        NavItem {
            label: "Kênh"; icon: "📺"
            active: parent.parent.activeItem === "channels"
            onClicked: parent.parent.navigateToPage("channels")
        }
        NavItem {
            label: "Đã render"; icon: "🎬"
            active: parent.parent.activeItem === "rendered"
            onClicked: parent.parent.navigateToPage("rendered")
        }
        NavItem {
            label: "Cài đặt"; icon: "⚙"
            active: parent.parent.activeItem === "settings"
            onClicked: parent.parent.navigateToPage("settings")
        }
        NavItem {
            label: "Vận hành"; icon: "🔧"
            active: parent.parent.activeItem === "operation"
            onClicked: parent.parent.navigateToPage("operation")
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
        color: active ? Theme.hoverBg : Theme.bg
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
