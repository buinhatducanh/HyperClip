// src/ui/qml/KeysPanel.qml
// Data API v3 key pool (30 keys, fallback)
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Rectangle {
    color: Theme.bg
    border.color: Theme.border
    border.width: 1
    Layout.preferredHeight: 280

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 12
        spacing: 8

        RowLayout {
            Layout.fillWidth: true
            RowLayout {
                spacing: 6
                Icon {
                    name: "settings"
                    size: 14
                    color: Theme.accent
                    Layout.alignment: Qt.AlignVCenter
                }
                Label {
                    text: "API KEYS"
                    color: Theme.accent
                    font.pixelSize: 20
                    font.bold: true
                }
            }
            Item { Layout.fillWidth: true }
            Label {
                text: (keyModel ? keyModel.rowCount : 0) + " / 30"
                color: Theme.textMuted
                font.pixelSize: 16
            }
            IconButton {
                iconName: "play"
                label: "Test tất cả"
                iconSize: 12
                Layout.minimumWidth: 90
                onClicked: keyModel.test_all(backend)
            }
        }

        ListView {
            Layout.fillWidth: true
            Layout.fillHeight: true
            model: keyModel
            clip: true
            spacing: 1
            delegate: Rectangle {
                width: ListView.view.width
                height: 32
                color: index % 2 === 0 ? Theme.rowEven : Theme.rowOdd

                RowLayout {
                    anchors.fill: parent
                    anchors.margins: 4
                    spacing: 8

                    StatusDot {
                        state: model.valid ? "running" : "error"
                        size: 8
                        showRing: model.valid
                    }
                    Label {
                        text: model.name
                        color: Theme.text
                        font.pixelSize: 16
                        Layout.preferredWidth: 100
                        elide: Text.ElideRight
                    }
                    Label {
                        text: model.maskedKey
                        color: Theme.textMuted
                        font.pixelSize: 15
                        font.family: "monospace"
                        Layout.minimumWidth: 60
                        Layout.maximumWidth: 120
                        elide: Text.ElideRight
                    }
                    Item { Layout.fillWidth: true; Layout.minimumWidth: 4 }
                    IconButton {
                        iconName: "delete"
                        Layout.preferredWidth: 32
                        Layout.preferredHeight: 24
                        iconSize: 12
                        onClicked: keyModel.remove(backend, model.key)
                    }
                }
            }
            Label {
                anchors.centerIn: parent
                visible: !keyModel || keyModel.rowCount === 0
                text: "Chưa có API key nào"
                color: Theme.textMuted
                font.pixelSize: 15
            }
        }
    }
}
