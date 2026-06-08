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
            Button {
                text: "Clear"
                onClicked: activityModel.clear()
                Layout.alignment: Qt.AlignRight
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
                        font.pixelSize: 10
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
                        font.pixelSize: 10
                        font.bold: true
                        Layout.preferredWidth: 60
                    }
                    Label {
                        text: model.message
                        color: Theme.text
                        font.pixelSize: 10
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
                font.pixelSize: 11
            }
        }
    }
}
