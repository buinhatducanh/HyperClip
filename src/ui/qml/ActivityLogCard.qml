// src/ui/qml/ActivityLogCard.qml
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

SettingsCard {
    title: "ACTIVITY LOG"
    Layout.preferredHeight: 280

    ColumnLayout {
        width: parent.width
        spacing: 8

        RowLayout {
            Layout.fillWidth: true
            IconButton {
                iconName: "delete"
                label: "Clear"
                iconSize: 12
                Layout.alignment: Qt.AlignRight
                Layout.minimumWidth: 80
                onClicked: activityModel.clear()
            }
        }

        ListView {
            id: logList
            Layout.fillWidth: true
            Layout.fillHeight: true
            model: activityModel
            clip: true
            spacing: 1
            delegate: Rectangle {
                width: logList.width
                height: 22
                color: index % 2 === 0 ? Theme.rowEven : Theme.rowOdd
                RowLayout {
                    anchors.fill: parent
                    anchors.leftMargin: 6
                    anchors.rightMargin: 6
                    spacing: 8
                    Label {
                        text: model.time
                        color: Theme.textMuted
                        font.pixelSize: 15
                        font.family: "monospace"
                        Layout.preferredWidth: 60
                    }
                    Rectangle {
                        Layout.preferredWidth: 8
                        Layout.preferredHeight: 8
                        radius: 4
                        color: model.level === "error" ? Theme.error
                             : model.level === "warn" ? "#FFD93D"
                             : Theme.success
                    }
                    Label {
                        text: model.type
                        color: Theme.accent
                        font.pixelSize: 15
                        font.bold: true
                        Layout.preferredWidth: 60
                    }
                    Label {
                        text: model.message
                        color: Theme.text
                        font.pixelSize: 15
                        elide: Text.ElideRight
                        Layout.fillWidth: true
                    }
                }
            }
            Label {
                visible: logList.count === 0
                anchors.centerIn: parent
                text: "Chưa có hoạt động nào"
                color: Theme.textMuted
                font.pixelSize: 16
            }
        }
    }
}
