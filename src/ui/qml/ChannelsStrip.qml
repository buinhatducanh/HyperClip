// src/ui/qml/ChannelsStrip.qml
// Collapsible horizontal channel strip below top menu
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Rectangle {
    id: root
    color: Theme.cardBg
    border.color: Theme.border
    border.width: 1
    height: collapsed ? 26 : 56

    property bool collapsed: false
    property string filterChannelId: ""  // non-empty = filter queue by this channel
    signal filterChanged(string channelId)
    signal addChannel(string url)

    RowLayout {
        anchors.fill: parent
        anchors.margins: 4
        spacing: 4

        // ─── Toggle button ───────────────────────────────────
        Rectangle {
            Layout.preferredWidth: 24
            Layout.preferredHeight: 24
            color: Theme.hoverBg
            radius: 3
            Label {
                anchors.centerIn: parent
                text: root.collapsed ? "▶" : "▼"
                color: Theme.textMuted
                font.pixelSize: 12
            }
            MouseArea {
                anchors.fill: parent
                cursorShape: Qt.PointingHandCursor
                onClicked: root.collapsed = !root.collapsed
            }
        }

        Label {
            text: "Kênh (" + (channelListModel.count || 0) + ")"
            color: Theme.textMuted
            font.pixelSize: 14
            font.bold: true
            Layout.leftMargin: 4
            visible: !root.collapsed
        }

        // ─── Channel list (horizontal) ───────────────────────
        ListView {
            id: chStrip
            visible: !root.collapsed
            Layout.fillWidth: true
            Layout.fillHeight: true
            orientation: ListView.Horizontal
            model: channelListModel
            clip: true
            spacing: 4

            delegate: Rectangle {
                width: delegateLabel.implicitWidth + 32
                height: chStrip.height
                radius: 4
                color: root.filterChannelId === model.channelId ? Theme.accent + "30" : Theme.bg
                border.color: root.filterChannelId === model.channelId ? Theme.accent : "transparent"
                border.width: 1

                RowLayout {
                    anchors.fill: parent
                    anchors.margins: 6
                    spacing: 4

                    Rectangle {
                        width: 8; height: 8; radius: 4
                        color: model.paused ? Theme.textMuted : Theme.success
                    }
                    Label {
                        id: delegateLabel
                        text: model.name
                        color: root.filterChannelId === model.channelId ? Theme.accent : Theme.text
                        font.pixelSize: 14
                        elide: Text.ElideRight
                    }
                    Rectangle {
                        visible: model.newCount > 0
                        width: 18; height: 16; radius: 8
                        color: Theme.error
                        Label {
                            anchors.centerIn: parent
                            text: model.newCount
                            color: "white"
                            font.pixelSize: 10
                            font.bold: true
                        }
                    }
                }

                MouseArea {
                    anchors.fill: parent
                    cursorShape: Qt.PointingHandCursor
                    onClicked: {
                        if (root.filterChannelId === model.channelId) {
                            root.filterChannelId = ""
                            root.filterChanged("")
                        } else {
                            root.filterChannelId = model.channelId
                            root.filterChanged(model.channelId)
                        }
                    }
                }
            }
        }

        // ─── Add button ──────────────────────────────────────
        Rectangle {
            visible: !root.collapsed
            Layout.preferredWidth: 24
            Layout.preferredHeight: 24
            Layout.minimumWidth: 24
            color: Theme.hoverBg
            radius: 3
            Label {
                anchors.centerIn: parent
                text: "+"
                color: Theme.accent
                font.pixelSize: 18
                font.bold: true
            }
            MouseArea {
                anchors.fill: parent
                cursorShape: Qt.PointingHandCursor
                onClicked: addField.visible = !addField.visible
            }
        }

        // ─── Inline add field ────────────────────────────────
        Rectangle {
            id: addField
            visible: false
            Layout.preferredWidth: 220
            Layout.preferredHeight: 24
            color: Theme.inputBg
            border.color: Theme.border
            border.width: 1
            radius: 3

            TextField {
                id: addInput
                anchors.fill: parent
                anchors.margins: 2
                placeholderText: "URL kênh..."
                color: Theme.text
                font.pixelSize: 14
                background: Rectangle { color: "transparent" }
                onAccepted: {
                    if (text.length > 0) {
                        root.addChannel(text.trim())
                        text = ""
                        addField.visible = false
                    }
                }
            }
        }
    }
}
