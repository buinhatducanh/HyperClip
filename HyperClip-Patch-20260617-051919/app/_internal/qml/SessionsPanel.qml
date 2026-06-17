// src/ui/qml/SessionsPanel.qml
// Chrome session management — login/logout, refresh, clone
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Rectangle {
    id: panel
    color: Theme.bg
    border.color: Theme.border
    border.width: 1
    clip: true
    Layout.preferredHeight: 320
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
                text: "CHROME SESSIONS"
                color: Theme.accent
                font.pixelSize: 18
                font.bold: true
                Layout.fillWidth: true
                Layout.minimumWidth: 0
                elide: Text.ElideRight
            }
            Item { Layout.fillWidth: false; Layout.preferredWidth: 0 }
            IconButton {
                iconName: "add"
                iconSize: 12
                Layout.preferredWidth: 28
                Layout.preferredHeight: 24
                ToolTip.text: "Thêm session"
                ToolTip.visible: hovered
                ToolTip.delay: 400
                onClicked: sessionModel.add_session(backend)
            }
            IconButton {
                iconName: "folder"
                iconSize: 12
                Layout.preferredWidth: 28
                Layout.preferredHeight: 24
                ToolTip.text: "Sao chép session"
                ToolTip.visible: hovered
                ToolTip.delay: 400
                onClicked: sessionModel.clone_one(backend)
            }
            IconButton {
                iconName: "refresh"
                iconSize: 12
                Layout.preferredWidth: 28
                Layout.preferredHeight: 24
                ToolTip.text: "Làm mới tất cả"
                ToolTip.visible: hovered
                ToolTip.delay: 400
                onClicked: sessionModel.refresh_all(backend)
            }
        }

        ListView {
            Layout.fillWidth: true
            Layout.fillHeight: true
            Layout.minimumHeight: 100
            model: sessionModel
            clip: true
            spacing: 1
            delegate: Rectangle {
                width: ListView.view.width
                height: 40
                color: index % 2 === 0 ? Theme.rowEven : Theme.rowOdd

                RowLayout {
                    anchors.fill: parent
                    anchors.margins: 4
                    spacing: 8

                    StatusDot {
                        state: model.loggedIn ? "running" : "error"
                        size: 8
                        showRing: model.loggedIn
                    }
                    Label {
                        text: model.name
                        color: Theme.text
                        font.pixelSize: 16
                        font.bold: true
                        Layout.minimumWidth: 60
                        Layout.maximumWidth: 140
                        elide: Text.ElideRight
                    }
                    StatusDot {
                        state: model.consented ? "ready" : "idle"
                        size: 8
                        showRing: false
                    }
                    Label {
                        text: model.consented ? "OK" : "Chưa đồng ý"
                        color: Theme.textMuted
                        font.pixelSize: 14
                        Layout.minimumWidth: 50
                    }
                    RowLayout {
                        spacing: 2
                        Icon {
                            name: "clock"
                            size: 11
                            color: Theme.textMuted
                        }
                        Label {
                            text: model.usedToday + "× hôm nay"
                            color: Theme.textMuted
                            font.pixelSize: 14
                            font.family: "monospace"
                        }
                    }
                    Item { Layout.fillWidth: true; Layout.minimumWidth: 4 }
                    IconButton {
                        iconName: "play"
                        iconSize: 12
                        Layout.preferredWidth: 28
                        Layout.preferredHeight: 24
                        ToolTip.text: "Đăng nhập session này"
                        ToolTip.visible: hovered
                        ToolTip.delay: 400
                        onClicked: sessionModel.open_login(backend, model.id)
                    }
                }
            }
            Label {
                anchors.centerIn: parent
                visible: !sessionModel || sessionModel.rowCount() === 0
                text: "Chưa có session nào — bấm Thêm để tạo"
                color: Theme.textMuted
                font.pixelSize: 15
            }
        }
    }
}
