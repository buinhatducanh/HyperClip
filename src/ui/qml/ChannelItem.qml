// src/ui/qml/ChannelItem.qml
// Single channel row in the sidebar list
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls
import Qt5Compat.GraphicalEffects

Rectangle {
    id: item
    Layout.fillWidth: true
    Layout.preferredHeight: 36
    color: hoverArea.containsMouse ? Theme.hoverBg : "transparent"
    border.color: Theme.cardBg
    border.width: 0

    property bool isPaused: false
    property bool isActive: false
    property int newCount: 0

    signal pauseClicked()
    signal deleteClicked()
    signal compareClicked()

    RowLayout {
        anchors.fill: parent
        anchors.leftMargin: 8
        anchors.rightMargin: 6
        spacing: 8

        Rectangle {
            id: avatarWrapper
            width: 22
            height: 22
            Layout.preferredWidth: 22
            Layout.preferredHeight: 22
            radius: 11
            color: item.isPaused ? Theme.textMuted : (model.avatarColor || Theme.accent) + "22"
            border.color: item.isPaused ? Theme.textMuted : (model.avatarColor || Theme.accent)
            border.width: 1

            Image {
                id: avatarImg
                anchors.fill: parent
                source: model.avatarUrl || ""
                fillMode: Image.PreserveAspectCrop
                visible: false
                asynchronous: true
            }

            Rectangle {
                id: roundMask
                anchors.fill: parent
                radius: 11
                visible: false
            }

            OpacityMask {
                anchors.fill: parent
                source: avatarImg
                maskSource: roundMask
                visible: !!model.avatarUrl && avatarImg.status === Image.Ready
            }

            Label {
                anchors.centerIn: parent
                visible: !model.avatarUrl || avatarImg.status !== Image.Ready
                text: model.name ? model.name[0].toUpperCase() : "?"
                color: item.isPaused ? "white" : (model.avatarColor || Theme.accent)
                font.pixelSize: 10
                font.bold: true
            }
        }
        ColumnLayout {
            Layout.fillWidth: true
            spacing: 0
            Label {
                text: model.name
                color: item.isPaused ? Theme.textMuted : Theme.text
                font.pixelSize: 16
                elide: Text.ElideRight
                Layout.fillWidth: true
            }
            Label {
                text: item.isPaused ? "Đã tạm dừng" : "@" + (model.handle || model.channelId || "")
                color: Theme.textMuted
                font.pixelSize: 14
                elide: Text.ElideRight
                Layout.fillWidth: true
            }
        }
        Rectangle {
            visible: item.newCount > 0
            Layout.preferredWidth: 18
            Layout.preferredHeight: 18
            radius: 9
            color: Theme.accent
            Label {
                anchors.centerIn: parent
                text: item.newCount > 99 ? "99+" : item.newCount
                color: "white"
                font.pixelSize: 14
                font.bold: true
            }
        }
    }

    MouseArea {
        id: hoverArea
        anchors.fill: parent
        hoverEnabled: true
        acceptedButtons: Qt.LeftButton | Qt.RightButton
        onClicked: function(mouse) {
            if (mouse.button === Qt.RightButton) {
                ctxMenu.popup()
            } else {
                item.isActive = !item.isActive
            }
        }
    }

    Menu {
        id: ctxMenu
        MenuItem {
            text: item.isPaused ? "Tiếp tục" : "Tạm dừng"
            onTriggered: item.pauseClicked()
        }
        MenuItem {
            text: "So sánh"
            onTriggered: item.compareClicked()
        }
        MenuItem {
            text: "Xóa"
            onTriggered: item.deleteClicked()
        }
    }
}
