// src/ui/qml/SessionsPanel.qml
// Chrome session management — login/logout, refresh, clone
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Rectangle {
    color: Theme.bg
    border.color: Theme.border
    border.width: 1
    Layout.preferredHeight: 320

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
                    text: "CHROME SESSIONS"
                    color: Theme.accent
                    font.pixelSize: 20
                    font.bold: true
                }
            }
            Item { Layout.fillWidth: true }
            IconButton {
                iconName: "add"
                label: "Thêm"
                iconSize: 12
                Layout.minimumWidth: 60
                onClicked: sessionModel.add_session(backend)
            }
            IconButton {
                iconName: "folder"
                label: "Sao chép"
                iconSize: 12
                Layout.minimumWidth: 80
                onClicked: sessionModel.clone_one(backend)
            }
            IconButton {
                iconName: "refresh"
                label: "Làm mới"
                iconSize: 12
                Layout.minimumWidth: 80
                onClicked: sessionModel.refresh_all(backend)
            }
        }

        ListView {
            Layout.fillWidth: true
            Layout.fillHeight: true
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
                        label: "Đăng nhập"
                        iconSize: 12
                        Layout.minimumWidth: 96
                        onClicked: sessionModel.open_login(backend, model.id)
                    }
                }
            }
            Label {
                anchors.centerIn: parent
                visible: !sessionModel || sessionModel.rowCount === 0
                text: "Chưa có session nào — bấm Thêm để tạo"
                color: Theme.textMuted
                font.pixelSize: 15
            }
        }
    }
}
