// src/ui/qml/AuthPanel.qml
// Auth/cookie status + OAuth flow + logout
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

SettingsCard {
    title: "XÁC THỰC"
    Layout.preferredHeight: 220

    ColumnLayout {
        width: parent.width
        spacing: 8

        RowLayout {
            Layout.fillWidth: true
            Rectangle {
                width: 10; height: 10; radius: 5
                color: auth.isReady ? Theme.success
                     : auth.cookieCritical ? Theme.error
                     : Theme.textMuted
            }
            Item { Layout.fillWidth: true }
        }

        GridLayout {
            columns: 2
            columnSpacing: 16
            rowSpacing: 6
            Layout.fillWidth: true

            Label { text: "Trạng thái"; color: Theme.textMuted; font.pixelSize: 11 }
            Label {
                text: auth.isReady ? "Sẵn sàng" : (auth.loggedOut ? "Đã đăng xuất" : "Chưa cấu hình")
                color: auth.isReady ? Theme.success : Theme.text
                font.pixelSize: 11
            }

            Label { text: "Tài khoản"; color: Theme.textMuted; font.pixelSize: 11 }
            Label {
                text: auth.accountName || "—"
                color: Theme.text
                font.pixelSize: 11
                elide: Text.ElideRight
                Layout.fillWidth: true
            }

            Label { text: "Cookies"; color: Theme.textMuted; font.pixelSize: 11 }
            Label {
                text: auth.cookieCount
                color: auth.cookieCount > 0 ? Theme.success : Theme.text
                font.pixelSize: 11
            }

            Label { text: "OAuth"; color: Theme.textMuted; font.pixelSize: 11 }
            Label {
                text: auth.oauthReady ? "Đã cấu hình" : "Chưa cấu hình"
                color: auth.oauthReady ? Theme.success : Theme.text
                font.pixelSize: 11
            }
        }

        Label {
            text: auth.cookieError
            color: Theme.error
            font.pixelSize: 10
            visible: auth.cookieCritical
            wrapMode: Text.WordWrap
            Layout.fillWidth: true
        }

        RowLayout {
            Layout.fillWidth: true
            Button {
                text: "OAuth Flow"
                enabled: !auth.isReady
                onClicked: auth.start_oauth(backend)
            }
            Button {
                text: "Đăng xuất"
                enabled: auth.isReady
                onClicked: auth.logout(backend)
            }
            Item { Layout.fillWidth: true }
        }
    }
}
