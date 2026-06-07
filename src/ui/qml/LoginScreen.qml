// src/ui/qml/LoginScreen.qml
// OAuth login flow — full overlay when not authenticated
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Rectangle {
    id: root
    color: "#000000EE"
    anchors.fill: parent
    z: 999

    function close() { visible = false }
    function show() { visible = true }

    ColumnLayout {
        anchors.centerIn: parent
        spacing: 16
        width: 400

        Label {
            text: "HyperClip"
            color: Theme.accent
            font.pixelSize: 32
            font.bold: true
            Layout.alignment: Qt.AlignHCenter
        }
        Label {
            text: "Bạn cần đăng nhập YouTube để bắt đầu"
            color: Theme.text
            font.pixelSize: 13
            Layout.alignment: Qt.AlignHCenter
        }
        Label {
            text: "OAuth flow sẽ tự động mở Chrome để bạn đăng nhập"
            color: Theme.textMuted
            font.pixelSize: 11
            Layout.alignment: Qt.AlignHCenter
            wrapMode: Text.WordWrap
            Layout.preferredWidth: 360
            horizontalAlignment: Text.AlignHCenter
        }

        // Status panel
        Rectangle {
            Layout.fillWidth: true
            Layout.preferredHeight: 80
            color: Theme.bg
            border.color: Theme.border
            border.width: 1
            ColumnLayout {
                anchors.fill: parent
                anchors.margins: 12
                spacing: 4
                RowLayout {
                    Layout.fillWidth: true
                    Rectangle {
                        width: 10; height: 10; radius: 5
                        color: auth.isReady ? Theme.success
                             : auth.cookieCritical ? Theme.error : Theme.textMuted
                    }
                    Label {
                        text: auth.isReady ? "Authenticated" : (auth.cookieCritical ? "Cookies invalid" : "Not authenticated")
                        color: auth.isReady ? Theme.success : Theme.text
                        font.pixelSize: 11
                        font.bold: true
                    }
                    Item { Layout.fillWidth: true }
                }
                Label {
                    text: "Account: " + (auth.accountName || "—")
                    color: Theme.textMuted
                    font.pixelSize: 10
                }
                Label {
                    text: "Cookies: " + auth.cookieCount
                    color: Theme.textMuted
                    font.pixelSize: 10
                }
            }
        }

        // Buttons
        RowLayout {
            Layout.fillWidth: true
            Button {
                text: "OAuth Flow"
                Layout.preferredWidth: 200
                Layout.preferredHeight: 36
                onClicked: auth.start_oauth(backend)
            }
            Item { Layout.fillWidth: true }
            Button {
                text: "Skip"
                onClicked: root.close()
            }
        }

        Label {
            text: "Hoặc đặt cookie thủ công vào C:\\HyperClip-Data\\cookies"
            color: Theme.textMuted
            font.pixelSize: 9
            Layout.alignment: Qt.AlignHCenter
        }
    }
}
