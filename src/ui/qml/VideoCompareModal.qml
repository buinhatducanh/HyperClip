// src/ui/qml/VideoCompareModal.qml
// Side-by-side compare: HyperClip rendered output vs YouTube original
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Dialog {
    id: dlg
    title: "So sánh video"
    modal: true
    width: 800
    height: 500

    property string channelId: ""
    property string channelName: ""

    function openFor(id, name) {
        channelId = id
        channelName = name
        open()
    }

    ColumnLayout {
        anchors.fill: parent
        spacing: 8

        Label {
            text: "Channel: " + dlg.channelName
            color: Theme.text
            font.pixelSize: 14
            font.bold: true
        }

        RowLayout {
            Layout.fillWidth: true
            Layout.fillHeight: true
            spacing: 12

            // YouTube original side
            Rectangle {
                Layout.fillWidth: true
                Layout.fillHeight: true
                color: "black"
                border.color: Theme.border
                border.width: 1
                ColumnLayout {
                    anchors.fill: parent
                    anchors.margins: 4
                    Label {
                        text: "YOUTUBE (gốc)"
                        color: Theme.textMuted
                        font.pixelSize: 10
                        font.bold: true
                    }
                    Label {
                        text: "https://www.youtube.com/channel/" + dlg.channelId
                        color: Theme.accent
                        font.pixelSize: 9
                        wrapMode: Text.Wrap
                    }
                }
            }

            // HyperClip rendered side
            Rectangle {
                Layout.fillWidth: true
                Layout.fillHeight: true
                color: "black"
                border.color: Theme.border
                border.width: 1
                ColumnLayout {
                    anchors.fill: parent
                    anchors.margins: 4
                    Label {
                        text: "HYPERCLIP (đã render)"
                        color: Theme.textMuted
                        font.pixelSize: 10
                        font.bold: true
                    }
                    Label {
                        text: "Mở HyperClip-Data\\output\\" + dlg.channelName
                        color: Theme.textMuted
                        font.pixelSize: 9
                        wrapMode: Text.Wrap
                    }
                }
            }
        }

        RowLayout {
            Layout.fillWidth: true
            Button {
                text: "Mở YouTube"
                onClicked: backend.send_command("system:openUrl",
                    {"url": "https://www.youtube.com/channel/" + dlg.channelId})
            }
            Button {
                text: "Mở folder output"
                onClicked: backend.send_command("system:openFolder",
                    {"path": "C:/HyperClip-Data/output"})
            }
            Item { Layout.fillWidth: true }
            Button {
                text: "Đóng"
                onClicked: dlg.close()
            }
        }
    }
}
