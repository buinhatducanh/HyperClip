// src/ui/qml/ActivityLogCard.qml
// Activity log — standalone card, no SettingsCard wrapper
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Rectangle {
    id: card
    color: Theme.cardBg
    border.color: Theme.border
    border.width: 1
    radius: Theme.radiusLg

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: Theme.spacingLg
        spacing: Theme.spacingSm

        // ─── Title + Clear button ─────────────────────────────
        RowLayout {
            Layout.fillWidth: true
            Layout.preferredHeight: 20

            Label {
                text: "ACTIVITY LOG"
                color: Theme.accent
                font.pixelSize: Theme.textLg
                font.bold: true
                font.letterSpacing: 0.8
                Layout.fillWidth: true
            }

            IconButton {
                iconName: "delete"
                label: "Clear"
                iconSize: 12
                Layout.minimumWidth: 80
                onClicked: activityModel.clear()
            }
        }

        // ─── Active Progress Section ─────────────────────────────
        ColumnLayout {
            id: activeProgressSection
            Layout.fillWidth: true
            spacing: 6
            visible: workspaceModel && workspaceModel.activeTasks && workspaceModel.activeTasks.length > 0

            Label {
                text: "TIẾN TRÌNH ĐANG CHẠY"
                color: Theme.textMuted
                font.pixelSize: 10
                font.bold: true
                font.letterSpacing: 0.5
            }

            ColumnLayout {
                Layout.fillWidth: true
                spacing: 4

                Repeater {
                    id: activeRepeater
                    model: workspaceModel ? workspaceModel.activeTasks : []
                    delegate: Rectangle {
                        Layout.fillWidth: true
                        height: 32
                        color: Theme.inputBg
                        border.color: Theme.border
                        border.width: 1
                        radius: Theme.radiusMd

                        RowLayout {
                            anchors.fill: parent
                            anchors.leftMargin: 10
                            anchors.rightMargin: 10
                            spacing: 8

                            Icon {
                                name: modelData.status === "downloading" ? "download" : "render"
                                size: 12
                                color: modelData.status === "downloading" ? "#FFA500" : Theme.accent
                            }

                            Label {
                                text: modelData.status === "downloading" ? "TẢI" : "RENDER"
                                color: modelData.status === "downloading" ? "#FFA500" : Theme.accent
                                font.pixelSize: 9
                                font.bold: true
                            }

                            Label {
                                text: modelData.title || "Video"
                                color: Theme.text
                                font.pixelSize: 12
                                font.bold: true
                                elide: Text.ElideRight
                                Layout.fillWidth: true
                            }

                            // Dynamic Speed/ETA info
                            Label {
                                text: modelData.status === "downloading" ? (modelData.speed ? modelData.speed : "Connecting...") : "Rendering..."
                                color: Theme.textMuted
                                font.pixelSize: 11
                                visible: true
                            }

                            // Custom Premium ProgressBar
                            Rectangle {
                                Layout.preferredWidth: 100
                                Layout.preferredHeight: 6
                                color: Theme.bg
                                radius: 3
                                clip: true

                                Rectangle {
                                    width: parent.width * (((typeof modelData.progress !== "undefined" && modelData.progress !== null) ? modelData.progress : 0) / 100.0)
                                    height: parent.height
                                    color: modelData.status === "downloading" ? "#FFA500" : Theme.accent
                                    radius: 3

                                    Behavior on width {
                                        NumberAnimation { duration: 150; easing.type: Easing.OutQuad }
                                    }
                                }
                            }

                            Label {
                                text: ((typeof modelData.progress !== "undefined" && modelData.progress !== null) ? modelData.progress.toFixed(0) : "0") + "%"
                                color: Theme.text
                                font.pixelSize: 11
                                font.bold: true
                                Layout.preferredWidth: 32
                                horizontalAlignment: Text.AlignRight
                            }
                        }
                    }
                }
            }

            // Small spacing divider
            Item { Layout.preferredHeight: 2 }
        }

        // ─── Log list ─────────────────────────────────────────
        ListView {
            id: logList
            Layout.fillWidth: true
            Layout.fillHeight: true
            Layout.minimumHeight: 80
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
                        font.pixelSize: 14
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
                        font.pixelSize: 14
                        font.bold: true
                        Layout.preferredWidth: 60
                    }
                    Label {
                        text: model.message
                        color: Theme.text
                        font.pixelSize: 14
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
                font.pixelSize: 15
            }
        }
    }
}
