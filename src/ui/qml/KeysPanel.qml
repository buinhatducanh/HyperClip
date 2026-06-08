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
            Label {
                text: "API KEYS"
                color: Theme.accent
                font.pixelSize: 13
                font.bold: true
                Layout.fillWidth: true
            }
            Label {
                text: (keyModel ? keyModel.rowCount : 0) + " / 30"
                color: Theme.textMuted
                font.pixelSize: 11
            }
            Button { text: "Test all"; onClicked: keyModel.test_all(backend) }
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

                    Rectangle {
                        Layout.preferredWidth: 8
                        Layout.preferredHeight: 8
                        radius: 4
                        color: model.valid ? Theme.success : Theme.error
                    }
                    Label {
                        text: model.name
                        color: Theme.text
                        font.pixelSize: 11
                        Layout.preferredWidth: 100
                        elide: Text.ElideRight
                    }
                    Label {
                        text: model.maskedKey
                        color: Theme.textMuted
                        font.pixelSize: 10
                        font.family: "monospace"
                    }
                    Item { Layout.fillWidth: true }
                    Button {
                        text: "×"
                        onClicked: keyModel.remove(backend, model.key)
                    }
                }
            }
            Label {
                anchors.centerIn: parent
                visible: !keyModel || keyModel.rowCount === 0
                text: "Chưa có key nào"
                color: Theme.textMuted
                font.pixelSize: 10
            }
        }
    }
}
