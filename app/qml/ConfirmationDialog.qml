// src/ui/qml/ConfirmationDialog.qml
// Premium Dark Mode Confirmation Dialog with clear warnings and hotkeys.
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Dialog {
    id: dlg
    modal: true
    dim: true
    anchors.centerIn: Overlay.overlay
    width: 440
    padding: 0
    closePolicy: Popup.CloseOnEscape | Popup.CloseOnPressOutside

    property string targetId: ""
    property string targetName: ""
    property string confirmTitle: "Xác nhận xóa"
    property string confirmMessage: "Bạn có chắc chắn muốn xóa mục này? Hành động này sẽ loại bỏ dữ liệu khỏi hàng đợi và không thể hoàn tác."
    property string acceptLabel: "Xóa ngay"
    property var onAcceptCallback: null

    function openFor(id, name, callback, customTitle, customMsg, customAccept) {
        targetId = id
        targetName = name
        onAcceptCallback = callback
        if (customTitle) confirmTitle = customTitle
        else confirmTitle = "Xác nhận xóa"
        if (customMsg) confirmMessage = customMsg
        else confirmMessage = "Bạn có chắc chắn muốn xóa \"" + name + "\"? Thao tác này sẽ dọn sạch khỏi hàng đợi."
        if (customAccept) acceptLabel = customAccept
        else acceptLabel = "Xóa ngay"
        open()
    }

    background: Rectangle {
        color: Theme.cardBg
        border.color: Theme.border
        border.width: 1
        radius: Theme.radiusXl
        clip: true

        // Top accent red danger indicator line
        Rectangle {
            anchors.top: parent.top
            anchors.left: parent.left
            anchors.right: parent.right
            height: 3
            color: Theme.error
        }
    }

    contentItem: ColumnLayout {
        spacing: 0

        // Header
        Rectangle {
            Layout.fillWidth: true
            Layout.preferredHeight: 52
            color: "transparent"

            RowLayout {
                anchors.fill: parent
                anchors.leftMargin: 20
                anchors.rightMargin: 16
                spacing: 12

                Rectangle {
                    width: 32
                    height: 32
                    radius: 16
                    color: Theme.error + "25"
                    border.color: Theme.error + "66"
                    border.width: 1

                    Icon {
                        anchors.centerIn: parent
                        name: "warning"
                        size: 16
                        color: Theme.error
                    }
                }

                Label {
                    text: dlg.confirmTitle
                    color: Theme.text
                    font.pixelSize: 15
                    font.bold: true
                    Layout.fillWidth: true
                }

                IconButton {
                    iconName: "close"
                    iconSize: 12
                    variant: "ghost"
                    tooltipText: "Đóng (Esc)"
                    onClicked: dlg.close()
                }
            }
        }

        // Divider
        Rectangle {
            Layout.fillWidth: true
            height: 1
            color: Theme.border
        }

        // Body Content
        ColumnLayout {
            Layout.fillWidth: true
            Layout.margins: 20
            spacing: 14

            Label {
                id: msgLabel
                text: dlg.confirmMessage
                color: "#E0E0E0"
                font.pixelSize: 13
                wrapMode: Text.WordWrap
                lineHeight: 1.3
                Layout.fillWidth: true
            }

            Rectangle {
                Layout.fillWidth: true
                Layout.preferredHeight: nameBoxCol.implicitHeight + 16
                color: Theme.inputBg
                border.color: Theme.border
                border.width: 1
                radius: Theme.radiusMd
                visible: dlg.targetName !== ""

                ColumnLayout {
                    id: nameBoxCol
                    anchors.fill: parent
                    anchors.margins: 10
                    spacing: 2

                    Label {
                        text: "MỤC ĐƯỢC CHỌN:"
                        color: Theme.textMuted
                        font.pixelSize: 10
                        font.bold: true
                    }
                    Label {
                        text: dlg.targetName
                        color: Theme.accent
                        font.pixelSize: 12
                        font.bold: true
                        elide: Text.ElideRight
                        Layout.fillWidth: true
                    }
                }
            }
        }

        // Footer Action Buttons
        Rectangle {
            Layout.fillWidth: true
            Layout.preferredHeight: 60
            color: Qt.rgba(0, 0, 0, 0.25)
            border.color: Theme.border
            border.width: 1

            RowLayout {
                anchors.fill: parent
                anchors.leftMargin: 20
                anchors.rightMargin: 20
                spacing: 12

                Item { Layout.fillWidth: true }

                // Cancel Button
                Rectangle {
                    Layout.preferredWidth: 90
                    Layout.preferredHeight: 34
                    radius: Theme.radiusMd
                    color: cancelMa.containsMouse ? Theme.hoverBg : "transparent"
                    border.color: cancelMa.containsMouse ? Theme.cardBorderHover : Theme.border
                    border.width: 1

                    Label {
                        anchors.centerIn: parent
                        text: "Hủy bỏ"
                        color: cancelMa.containsMouse ? "#FFFFFF" : Theme.textMuted
                        font.pixelSize: 12
                        font.bold: true
                    }

                    MouseArea {
                        id: cancelMa
                        anchors.fill: parent
                        hoverEnabled: true
                        cursorShape: Qt.PointingHandCursor
                        onClicked: dlg.close()
                    }
                }

                // Accept Danger Button
                Rectangle {
                    Layout.preferredWidth: 110
                    Layout.preferredHeight: 34
                    radius: Theme.radiusMd
                    color: acceptMa.containsMouse ? Theme.error : Theme.error + "D0"

                    RowLayout {
                        anchors.centerIn: parent
                        spacing: 6
                        Icon {
                            name: "trash"
                            size: 13
                            color: "#FFFFFF"
                        }
                        Label {
                            text: dlg.acceptLabel
                            color: "#FFFFFF"
                            font.pixelSize: 12
                            font.bold: true
                        }
                    }

                    MouseArea {
                        id: acceptMa
                        anchors.fill: parent
                        hoverEnabled: true
                        cursorShape: Qt.PointingHandCursor
                        onClicked: {
                            if (dlg.onAcceptCallback) {
                                dlg.onAcceptCallback(dlg.targetId, dlg.targetName)
                            }
                            dlg.close()
                        }
                    }
                }
            }
        }
    }
}
