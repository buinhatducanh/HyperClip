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
            RowLayout {
                spacing: 6
                Icon {
                    name: "settings"
                    size: 14
                    color: Theme.accent
                    Layout.alignment: Qt.AlignVCenter
                }
                Label {
                    text: "OAUTH PROJECTS"
                    color: Theme.accent
                    font.pixelSize: 20
                    font.bold: true
                }
            }
            Item { Layout.fillWidth: true }
            Label {
                text: (projectModel ? projectModel.rowCount : 0) + " / ?"
                color: Theme.textMuted
                font.pixelSize: 16
            }
            IconButton {
                iconName: "play"
                label: "Test tất cả"
                iconSize: 12
                Layout.minimumWidth: 90
                onClicked: projectModel.test_all(backend)
            }
            IconButton {
                iconName: "retry"
                label: "Sửa tất cả"
                iconSize: 12
                Layout.minimumWidth: 90
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
                color: index % 2 === 0 ? Theme.rowEven : Theme.rowOdd

                RowLayout {
                    anchors.fill: parent
                    anchors.margins: 4
                    spacing: 8

                    StatusDot {
                        state: model.healthy ? "running" : (model.errorText ? "error" : "idle")
                        size: 8
                        showRing: model.healthy
                    }
                    Label {
                        text: model.name || model.id
                        color: Theme.text
                        font.pixelSize: 16
                        font.bold: true
                        Layout.minimumWidth: 60
                        Layout.maximumWidth: 140
                        elide: Text.ElideRight
                    }
                    Label {
                        text: model.quotaUsed + " / " + model.quotaLimit
                        color: model.quotaUsed / Math.max(1, model.quotaLimit) > 0.9
                              ? Theme.error : Theme.textMuted
                        font.pixelSize: 15
                        font.family: "monospace"
                        Layout.minimumWidth: 60
                    }
                    Item { Layout.fillWidth: true; Layout.minimumWidth: 4 }
                    RowLayout {
                        spacing: 2
                        Icon {
                            visible: model.errorText !== ""
                            name: "warning"
                            size: 11
                            color: Theme.error
                        }
                        Label {
                            text: model.errorText
                            color: Theme.error
                            font.pixelSize: 14
                            elide: Text.ElideRight
                            Layout.maximumWidth: 90
                            visible: model.errorText !== ""
                        }
                    }
                    IconButton {
                        iconName: "edit"
                        Layout.preferredWidth: 32
                        Layout.preferredHeight: 24
                        iconSize: 12
                        onClicked: projectModel.repair(backend, model.id)
                    }
                    IconButton {
                        iconName: "delete"
                        Layout.preferredWidth: 32
                        Layout.preferredHeight: 24
                        iconSize: 12
                        onClicked: projectModel.remove(backend, model.id)
                    }
                }
            }
            Label {
                anchors.centerIn: parent
                visible: !projectModel || projectModel.rowCount === 0
                text: "Chưa có project nào — OAuth Flow để thêm"
                color: Theme.textMuted
                font.pixelSize: 15
            }
        }
    }
}
