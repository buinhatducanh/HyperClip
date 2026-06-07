// src/ui/qml/Sidebar.qml
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Rectangle {
    color: Theme.bg
    border.color: Theme.border
    border.width: 1

    ColumnLayout {
        anchors.fill: parent
        spacing: 4

        Label {
            text: "HyperClip"
            color: Theme.accent
            font.pixelSize: 16
            font.bold: true
            Layout.topMargin: 8
            Layout.leftMargin: 8
        }

        Label {
            text: "24/7 YouTube auto-capture"
            color: Theme.textMuted
            font.pixelSize: 9
            Layout.leftMargin: 8
        }

        Rectangle {
            Layout.fillWidth: true
            Layout.preferredHeight: 1
            color: Theme.border
            Layout.topMargin: 4
            Layout.bottomMargin: 4
        }

        NavItem {
            label: "Queue"
            icon: "📋"
            active: true
        }
        NavItem {
            label: "Channels"
            icon: "📺"
        }
        NavItem {
            label: "Settings"
            icon: "⚙"
        }

        Item { Layout.fillHeight: true }

        DetectionStatusBar {
            Layout.alignment: Qt.AlignHCenter
            Layout.bottomMargin: 8
        }
    }

    component NavItem : Rectangle {
        property string label: ""
        property string icon: ""
        property bool active: false

        Layout.fillWidth: true
        Layout.preferredHeight: 32
        Layout.leftMargin: 4
        Layout.rightMargin: 4
        color: active ? "#1F1F1F" : Theme.bg

        RowLayout {
            anchors.fill: parent
            anchors.leftMargin: 8
            spacing: 8

            Label {
                text: icon
                font.pixelSize: 14
            }
            Label {
                text: label
                color: active ? Theme.accent : Theme.text
                font.pixelSize: 12
            }
        }
    }
}
