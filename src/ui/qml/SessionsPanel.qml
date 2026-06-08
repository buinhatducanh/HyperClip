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
            Label {
                text: "CHROME SESSIONS"
                color: Theme.accent
                font.pixelSize: 13
                font.bold: true
                Layout.fillWidth: true
            }
            Button { text: "Thêm"; onClicked: sessionModel.add_session(backend) }
            Button { text: "Sao chép"; onClicked: sessionModel.clone_one(backend) }
            Button { text: "Làm mới"; onClicked: sessionModel.refresh_all(backend) }
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

                    Rectangle {
                        Layout.preferredWidth: 10
                        Layout.preferredHeight: 10
                        radius: 5
                        color: model.loggedIn ? Theme.success : Theme.error
                    }
                    Label {
                        text: model.name
                        color: Theme.text
                        font.pixelSize: 11
                        font.bold: true
                        Layout.preferredWidth: 100
                        elide: Text.ElideRight
                    }
                    Rectangle {
                        Layout.preferredWidth: 10
                        Layout.preferredHeight: 10
                        radius: 5
                        color: model.consented ? Theme.accent : Theme.textMuted
                    }
                    Label {
                        text: model.consented ? "OK" : "Chưa đồng ý"
                        color: Theme.textMuted
                        font.pixelSize: 9
                    }
                    Label {
                        text: model.usedToday + "× hôm nay"
                        color: Theme.textMuted
                        font.pixelSize: 9
                        font.family: "monospace"
                    }
                    Item { Layout.fillWidth: true }
                    Button {
                        text: "Đăng nhập"
                        onClicked: sessionModel.open_login(backend, model.id)
                    }
                }
            }
            Label {
                anchors.centerIn: parent
                visible: !sessionModel || sessionModel.rowCount === 0
                text: "Chưa có session nào — bấm Thêm để tạo"
                color: Theme.textMuted
                font.pixelSize: 10
            }
        }
    }
}
