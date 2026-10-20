// src/ui/qml/VideoCompareModal.qml
// Side-by-side compare: HyperClip rendered output vs YouTube original.
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Dialog {
    id: dlg
    modal: true
    dim: true
    anchors.centerIn: Overlay.overlay
    width: 760
    height: 480
    padding: 0
    closePolicy: Popup.CloseOnEscape | Popup.CloseOnPressOutside

    property string channelId: ""
    property string channelName: ""

    function openFor(id, name) {
        channelId = id
        channelName = name
        open()
    }

    background: Rectangle {
        color: Theme.cardBg
        border.color: Theme.border
        border.width: 1
        radius: Theme.radiusXl
        clip: true

        Rectangle {
            anchors.top: parent.top
            anchors.left: parent.left
            anchors.right: parent.right
            height: 3
            color: Theme.accent
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
                    color: Theme.accent + "25"
                    border.color: Theme.accent + "66"
                    border.width: 1

                    Icon {
                        anchors.centerIn: parent
                        name: "render"
                        size: 15
                        color: Theme.accent
                    }
                }

                ColumnLayout {
                    Layout.fillWidth: true
                    spacing: 1
                    Label {
                        text: "So Sánh Video Gốc vs Kết Quả Render"
                        color: Theme.text
                        font.pixelSize: 15
                        font.bold: true
                    }
                    Label {
                        text: "Kênh: " + dlg.channelName + " (" + dlg.channelId + ")"
                        color: Theme.accent
                        font.pixelSize: 11
                    }
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

        // 2 Columns Comparison
        RowLayout {
            Layout.fillWidth: true
            Layout.fillHeight: true
            Layout.margins: 20
            spacing: 16

            // YouTube original side
            Rectangle {
                Layout.fillWidth: true
                Layout.fillHeight: true
                color: Theme.inputBg
                border.color: Theme.border
                border.width: 1
                radius: Theme.radiusLg

                ColumnLayout {
                    anchors.fill: parent
                    anchors.margins: 16
                    spacing: 12

                    RowLayout {
                        spacing: 8
                        Rectangle {
                            width: 18; height: 18; radius: 4
                            color: "#FF0000"
                            Icon { anchors.centerIn: parent; name: "play"; size: 10; color: "white" }
                        }
                        Label {
                            text: "YOUTUBE (VIDEO GỐC)"
                            color: Theme.text
                            font.pixelSize: 12
                            font.bold: true
                        }
                    }

                    Rectangle {
                        Layout.fillWidth: true
                        Layout.fillHeight: true
                        color: Qt.rgba(0, 0, 0, 0.3)
                        radius: Theme.radiusMd
                        border.color: Theme.border
                        border.width: 1

                        ColumnLayout {
                            anchors.centerIn: parent
                            spacing: 8
                            Icon {
                                Layout.alignment: Qt.AlignHCenter
                                name: "download"
                                size: 28
                                color: Theme.textMuted
                            }
                            Label {
                                text: "https://www.youtube.com/channel/" + dlg.channelId
                                color: Theme.accent
                                font.pixelSize: 11
                                horizontalAlignment: Text.AlignHCenter
                                wrapMode: Text.Wrap
                                Layout.maximumWidth: 260
                            }
                        }
                    }

                    Rectangle {
                        Layout.fillWidth: true
                        Layout.preferredHeight: 34
                        radius: Theme.radiusMd
                        color: ytMa.containsMouse ? Theme.error : Theme.error + "C0"

                        RowLayout {
                            anchors.centerIn: parent
                            spacing: 6
                            Icon { name: "play"; size: 12; color: "white" }
                            Label { text: "Mở Kênh YouTube"; color: "white"; font.pixelSize: 11; font.bold: true }
                        }

                        MouseArea {
                            id: ytMa
                            anchors.fill: parent
                            hoverEnabled: true
                            cursorShape: Qt.PointingHandCursor
                            onClicked: backend.send_command_async("system:openUrl", {"url": "https://www.youtube.com/channel/" + dlg.channelId})
                        }
                    }
                }
            }

            // HyperClip rendered side
            Rectangle {
                Layout.fillWidth: true
                Layout.fillHeight: true
                color: Theme.inputBg
                border.color: Theme.accent + "55"
                border.width: 1
                radius: Theme.radiusLg

                ColumnLayout {
                    anchors.fill: parent
                    anchors.margins: 16
                    spacing: 12

                    RowLayout {
                        spacing: 8
                        Rectangle {
                            width: 18; height: 18; radius: 4
                            color: Theme.accent
                            Icon { anchors.centerIn: parent; name: "render"; size: 10; color: "white" }
                        }
                        Label {
                            text: "HYPERCLIP (ĐÃ RENDER)"
                            color: Theme.accent
                            font.pixelSize: 12
                            font.bold: true
                        }
                    }

                    Rectangle {
                        Layout.fillWidth: true
                        Layout.fillHeight: true
                        color: Qt.rgba(0, 0, 0, 0.3)
                        radius: Theme.radiusMd
                        border.color: Theme.border
                        border.width: 1

                        ColumnLayout {
                            anchors.centerIn: parent
                            spacing: 8
                            Icon {
                                Layout.alignment: Qt.AlignHCenter
                                name: "render"
                                size: 28
                                color: Theme.accent
                            }
                            Label {
                                text: ((typeof settings !== "undefined" && settings !== null) ? settings.outputPath : "Output") + "/" + dlg.channelName
                                color: Theme.text
                                font.pixelSize: 11
                                horizontalAlignment: Text.AlignHCenter
                                wrapMode: Text.Wrap
                                Layout.maximumWidth: 260
                            }
                        }
                    }

                    Rectangle {
                        Layout.fillWidth: true
                        Layout.preferredHeight: 34
                        radius: Theme.radiusMd
                        color: folderMa.containsMouse ? Theme.accentHover : Theme.accent

                        RowLayout {
                            anchors.centerIn: parent
                            spacing: 6
                            Icon { name: "folder"; size: 12; color: "white" }
                            Label { text: "Mở Thư Mục Xuất Bản"; color: "white"; font.pixelSize: 11; font.bold: true }
                        }

                        MouseArea {
                            id: folderMa
                            anchors.fill: parent
                            hoverEnabled: true
                            cursorShape: Qt.PointingHandCursor
                            onClicked: backend.send_command_async("system:openFolder", {
                                "path": (typeof settings !== "undefined" && settings !== null) ? settings.outputPath : ""
                            })
                        }
                    }
                }
            }
        }

        // Footer
        Rectangle {
            Layout.fillWidth: true
            Layout.preferredHeight: 52
            color: Qt.rgba(0, 0, 0, 0.25)
            border.color: Theme.border
            border.width: 1

            RowLayout {
                anchors.fill: parent
                anchors.leftMargin: 20
                anchors.rightMargin: 20

                Item { Layout.fillWidth: true }

                Rectangle {
                    Layout.preferredWidth: 90
                    Layout.preferredHeight: 32
                    radius: Theme.radiusMd
                    color: closeMa.containsMouse ? Theme.hoverBg : "transparent"
                    border.color: closeMa.containsMouse ? Theme.cardBorderHover : Theme.border
                    border.width: 1

                    Label {
                        anchors.centerIn: parent
                        text: "Đóng"
                        color: closeMa.containsMouse ? "#FFFFFF" : Theme.textMuted
                        font.pixelSize: 12
                        font.bold: true
                    }

                    MouseArea {
                        id: closeMa
                        anchors.fill: parent
                        hoverEnabled: true
                        cursorShape: Qt.PointingHandCursor
                        onClicked: dlg.close()
                    }
                }
            }
        }
    }
}
