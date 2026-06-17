// src/ui/qml/ProjectsPanel.qml
// GCP OAuth projects list — used for Data API v3 fallback
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
                text: "OAUTH PROJECTS"
                color: Theme.accent
                font.pixelSize: 18
                font.bold: true
                Layout.fillWidth: true
                Layout.minimumWidth: 0
                elide: Text.ElideRight
            }
            Item { Layout.fillWidth: false; Layout.preferredWidth: 0 }
            Label {
                text: (projectModel ? projectModel.rowCount() : 0) + " / ?"
                color: Theme.textMuted
                font.pixelSize: 14
                Layout.alignment: Qt.AlignVCenter
            }
            IconButton {
                iconName: "play"
                iconSize: 12
                Layout.preferredWidth: 28
                Layout.preferredHeight: 24
                ToolTip.text: "Test tất cả project"
                ToolTip.visible: hovered
                ToolTip.delay: 400
                onClicked: projectModel.test_all(backend)
            }
            IconButton {
                iconName: "retry"
                iconSize: 12
                Layout.preferredWidth: 28
                Layout.preferredHeight: 24
                ToolTip.text: "Sửa tất cả project lỗi"
                ToolTip.visible: hovered
                ToolTip.delay: 400
                onClicked: projectModel.batch_repair(backend)
            }
        }

        ListView {
            Layout.fillWidth: true
            Layout.fillHeight: true
            Layout.minimumHeight: 100
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
                        Layout.maximumWidth: 70
                        visible: (model.errorText || "") !== ""
                        Icon {
                            name: "warning"
                            size: 11
                            color: Theme.error
                        }
                        Label {
                            text: model.errorText || ""
                            color: Theme.error
                            font.pixelSize: 12
                            elide: Text.ElideRight
                            Layout.fillWidth: true
                            Layout.maximumWidth: 50
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
                visible: !projectModel || projectModel.rowCount() === 0
                text: "Chưa có project nào — OAuth Flow để thêm"
                color: Theme.textMuted
                font.pixelSize: 15
            }
        }
    }
}
