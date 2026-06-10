// src/ui/qml/Sidebar.qml
// Fixed-width left sidebar (220px) — shows channel list, detection status, add channel.
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls
import QtQuick.Shapes

Rectangle {
    id: sideRoot

    // ─── State ───────────────────────────────────────────────────────
    property string activeChannelId: ""
    property bool expanded: true
    signal channelSelected(string id)
    signal addChannel(string url)

    width: 220
    color: Theme.cardBg
    border.color: Theme.border
    border.width: 0

    // ─── Logo block ────────────────────────────────────────────────
    Rectangle {
        id: logoBlock
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        height: 44
        color: "transparent"

        RowLayout {
            anchors.fill: parent
            anchors.leftMargin: 12
            anchors.rightMargin: 12
            spacing: 8

            Rectangle {
                id: brandIcon
                Layout.preferredWidth: 28
                Layout.preferredHeight: 28
                radius: 6
                color: Theme.accent

                Shape {
                    anchors.fill: parent
                    anchors.margins: 7
                    antialiasing: true
                    ShapePath {
                        fillColor: "white"
                        startX: 0
                        startY: 0
                        PathLine { x: 10; y: 7 }
                        PathLine { x: 0; y: 14 }
                        PathLine { x: 0; y: 0 }
                    }
                }
            }
            Label {
                text: "HyperClip"
                color: Theme.text
                font.pixelSize: 13
                font.bold: true
                Layout.fillWidth: true
            }
        }
    }

    // ─── Detection status bar ──────────────────────────────────────
    Rectangle {
        id: detBar
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: logoBlock.bottom
        height: 28
        color: Theme.bg
        border.color: Theme.border
        border.width: 0

        RowLayout {
            anchors.fill: parent
            anchors.leftMargin: 8
            anchors.rightMargin: 6
            spacing: 4

            StatusDot {
                state: poller.active ? "running" : "paused"
                size: 8
                showRing: poller.active
                Layout.alignment: Qt.AlignVCenter
            }
            Label {
                text: poller.active ? "ĐANG CHẠY" : "TẠM DỪNG"
                color: poller.active ? Theme.success : Theme.textMuted
                font.pixelSize: 10
                font.bold: true
            }
            Item { Layout.fillWidth: true }
            RowLayout {
                spacing: 2
                Icon {
                    name: "settings"
                    size: 10
                    color: Theme.textMuted
                }
                Label {
                    text: (typeof sessionModel !== 'undefined' && sessionModel ? sessionModel.rowCount() : 0) + " ses"
                    color: Theme.textMuted
                    font.pixelSize: 9
                    font.family: "monospace"
                }
            }
        }

        Rectangle {
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.bottom: parent.bottom
            height: 1
            color: Theme.border
            opacity: 0.5
        }
    }

    // ─── Add channel input ──────────────────────────────────────────
    Rectangle {
        id: addBox
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: detBar.bottom
        height: 36
        color: "transparent"

        RowLayout {
            anchors.fill: parent
            anchors.leftMargin: 8
            anchors.rightMargin: 8
            anchors.topMargin: 4
            anchors.bottomMargin: 4
            spacing: 4

            Rectangle {
                Layout.fillWidth: true
                Layout.preferredHeight: 28
                color: Theme.bg
                border.color: addInput.activeFocus ? Theme.accent : Theme.border
                border.width: 1
                radius: 3

                TextField {
                    id: addInput
                    anchors.fill: parent
                    anchors.leftMargin: 6
                    anchors.rightMargin: 6
                    placeholderText: "URL hoặc @handle"
                    color: Theme.text
                    font.pixelSize: 11
                    font.family: "monospace"
                    background: Rectangle { color: "transparent"; border.width: 0 }
                    onAccepted: {
                        if (text.length > 0) {
                            sideRoot.addChannel(text.trim())
                            text = ""
                        }
                    }
                }
            }
            Rectangle {
                Layout.preferredWidth: 28
                Layout.preferredHeight: 28
                radius: 3
                color: addInput.text.length > 0 ? Theme.accent : Theme.bg
                border.color: Theme.border
                border.width: 1
                Icon {
                    anchors.centerIn: parent
                    name: "add"
                    size: 16
                    color: addInput.text.length > 0 ? "white" : Theme.text
                }
                MouseArea {
                    anchors.fill: parent
                    cursorShape: Qt.PointingHandCursor
                    onClicked: {
                        if (addInput.text.length > 0) {
                            sideRoot.addChannel(addInput.text.trim())
                            addInput.text = ""
                        } else {
                            addInput.forceActiveFocus()
                        }
                    }
                }
            }
        }
    }

    // ─── Channel list ──────────────────────────────────────────────
    ListView {
        id: chList
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: addBox.bottom
        anchors.bottom: parent.bottom
        model: channelListModel
        clip: true
        spacing: 0
        boundsBehavior: Flickable.StopAtBounds

        delegate: Rectangle {
            width: chList.width
            height: 36
            color: sideRoot.activeChannelId === model.channelId ? Theme.accent + "10" : "transparent"

            property bool rowHover: rowMa.containsMouse
            Rectangle {
                anchors.fill: parent
                visible: parent.rowHover && sideRoot.activeChannelId !== model.channelId
                color: Theme.hoverBg
                opacity: 0.5
            }
            Rectangle {
                anchors.left: parent.left
                width: 2
                height: parent.height
                color: sideRoot.activeChannelId === model.channelId ? Theme.accent : "transparent"
            }

            MouseArea {
                id: rowMa
                anchors.fill: parent
                hoverEnabled: true
                cursorShape: Qt.PointingHandCursor
                onClicked: {
                    if (sideRoot.activeChannelId === model.channelId) {
                        sideRoot.channelSelected("")
                    } else {
                        sideRoot.channelSelected(model.channelId)
                    }
                }
            }

            RowLayout {
                anchors.fill: parent
                anchors.leftMargin: 12
                anchors.rightMargin: 6
                spacing: 8

                Rectangle {
                    Layout.preferredWidth: 28
                    Layout.preferredHeight: 28
                    radius: 14
                    color: (model.avatarColor || Theme.accent) + "22"
                    border.color: (model.avatarColor || Theme.accent) + "44"
                    border.width: 1
                    Label {
                        anchors.centerIn: parent
                        text: model.name ? model.name[0].toUpperCase() : "?"
                        color: model.avatarColor || Theme.accent
                        font.pixelSize: 11
                        font.bold: true
                    }
                }

                Label {
                    text: model.name
                    color: model.paused ? Theme.textMuted : Theme.text
                    font.pixelSize: 12
                    font.bold: sideRoot.activeChannelId === model.channelId
                    elide: Text.ElideRight
                    Layout.fillWidth: true
                    Layout.maximumWidth: 100
                }
                }

                // Paused indicator (small icon)
                Icon {
                    visible: model.paused === true
                    name: "pause"
                    size: 10
                    color: Theme.textMuted
                }

                // New videos count badge
                Rectangle {
                    visible: (model.newCount || 0) > 0
                    Layout.preferredWidth: 18
                    Layout.preferredHeight: 16
                    radius: 8
                    color: Theme.accent
                    Label {
                        anchors.centerIn: parent
                        text: model.newCount > 99 ? "99+" : model.newCount
                        color: "white"
                        font.pixelSize: 9
                        font.bold: true
                    }
                }

                // Action buttons (visible on hover when expanded)
                RowLayout {
                    visible: sideRoot.expanded && rowMa.containsMouse
                    spacing: 2
                    Layout.preferredWidth: 44

                    Rectangle {
                        Layout.preferredWidth: 18
                        Layout.preferredHeight: 18
                        color: pauseMa.containsMouse ? Theme.hoverBg : "transparent"
                        radius: 3
                        Icon {
                            anchors.centerIn: parent
                            name: model.paused ? "play" : "pause"
                            size: 10
                            color: model.paused ? Theme.success : "#FFD93D"
                        }
                        MouseArea {
                            id: pauseMa
                            anchors.fill: parent
                            hoverEnabled: true
                            cursorShape: Qt.PointingHandCursor
                            onClicked: {
                                if (model.paused) {
                                    backend.send_command("channel:resume", {"id": model.channelId})
                                } else {
                                    backend.send_command("channel:pause", {"id": model.channelId})
                                }
                            }
                        }
                    }
                    Rectangle {
                        Layout.preferredWidth: 18
                        Layout.preferredHeight: 18
                        color: delMa.containsMouse ? Theme.error + "30" : "transparent"
                        radius: 3
                        Icon {
                            anchors.centerIn: parent
                            name: "delete"
                            size: 12
                            color: delMa.containsMouse ? Theme.error : Theme.textMuted
                        }
                        MouseArea {
                            id: delMa
                            anchors.fill: parent
                            hoverEnabled: true
                            cursorShape: Qt.PointingHandCursor
                            onClicked: {
                                backend.send_command("channel:remove", {"id": model.channelId})
                            }
                        }
                    }
                }
            }
        }

        Label {
            anchors.centerIn: parent
            visible: chList.count === 0
            text: "Chưa có kênh"
            color: Theme.textMuted
            font.pixelSize: 10
        }
    }
}
