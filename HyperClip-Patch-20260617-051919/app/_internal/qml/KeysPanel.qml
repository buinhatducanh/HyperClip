// src/ui/qml/KeysPanel.qml
// Data API v3 key pool (30 keys, fallback)
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Rectangle {
    id: panel
    color: Theme.bg
    border.color: Theme.border
    border.width: 1
    clip: true
    Layout.preferredHeight: 280
    Layout.minimumHeight: 200
    Layout.fillHeight: true

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 12
        spacing: 8
        Layout.fillHeight: true

        RowLayout {
            Layout.fillWidth: true
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
                font.pixelSize: 18
                font.bold: true
                Layout.fillWidth: true
                Layout.minimumWidth: 0
                elide: Text.ElideRight
            }
            Item { Layout.fillWidth: false; Layout.preferredWidth: 0 }
            Label {
                text: (keyModel ? keyModel.rowCount() : 0) + " / 30"
                color: Theme.textMuted
                font.pixelSize: 14
                Layout.alignment: Qt.AlignVCenter
            }
            IconButton {
                iconName: "play"
                iconSize: 12
                Layout.preferredWidth: 28
                Layout.preferredHeight: 24
                ToolTip.text: "Test tất cả key"
                ToolTip.visible: hovered
                ToolTip.delay: 400
                onClicked: keyModel.test_all(backend)
            }
        }

        ListView {
            Layout.fillWidth: true
            Layout.fillHeight: true
            Layout.minimumHeight: 100
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
                visible: !keyModel || keyModel.rowCount() === 0
                text: "Chưa có API key nào"
                color: Theme.textMuted
                font.pixelSize: 15
            }
        }
    }
}
