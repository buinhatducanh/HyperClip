// src/ui/qml/ProjectsPanel.qml
// GCP OAuth projects list — used for Data API v3 fallback
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
                text: "OAUTH PROJECTS"
                color: Theme.accent
                font.pixelSize: 13
                font.bold: true
                Layout.fillWidth: true
            }
            Label {
                text: projectModel.rowCount + " / " + "?"
                color: Theme.textMuted
                font.pixelSize: 11
            }
            Button {
                text: "Test all"
                onClicked: projectModel.test_all(backend)
            }
            Button {
                text: "Repair all"
                onClicked: projectModel.batch_repair(backend)
            }
        }

        ListView {
            Layout.fillWidth: true
            Layout.fillHeight: true
            model: projectModel
            clip: true
            spacing: 1
            delegate: Rectangle {
                width: ListView.view.width
                height: 36
                color: index % 2 === 0 ? "#161616" : "#1A1A1A"

                RowLayout {
                    anchors.fill: parent
                    anchors.margins: 4
                    spacing: 8

                    Rectangle {
                        Layout.preferredWidth: 8
                        Layout.preferredHeight: 8
                        radius: 4
                        color: model.healthy ? Theme.success
                             : model.error ? Theme.error : Theme.textMuted
                    }
                    Label {
                        text: model.name || model.id
                        color: Theme.text
                        font.pixelSize: 11
                        font.bold: true
                        Layout.preferredWidth: 140
                        elide: Text.ElideRight
                    }
                    Label {
                        text: model.quotaUsed + " / " + model.quotaLimit
                        color: model.quotaUsed / Math.max(1, model.quotaLimit) > 0.9
                              ? Theme.error : Theme.textMuted
                        font.pixelSize: 10
                        font.family: "monospace"
                    }
                    Item { Layout.fillWidth: true }
                    Label {
                        text: model.error
                        color: Theme.error
                        font.pixelSize: 9
                        elide: Text.ElideRight
                        Layout.preferredWidth: 120
                    }
                    Button {
                        text: "Repair"
                        onClicked: projectModel.repair(backend, model.id)
                    }
                    Button {
                        text: "×"
                        onClicked: projectModel.remove(backend, model.id)
                    }
                }
            }
            Label {
                anchors.centerIn: parent
                visible: projectModel.rowCount === 0
                text: "Chưa có project nào — OAuth Flow để thêm"
                color: Theme.textMuted
                font.pixelSize: 10
            }
        }
    }
}
