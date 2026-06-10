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
            StatusDot {
                state: auth.isReady ? "running" : (auth.cookieCritical ? "error" : "idle")
                size: 10
                showRing: auth.isReady
                Layout.alignment: Qt.AlignVCenter
            }
            Item { Layout.fillWidth: true }
        }

        GridLayout {
            columns: 2
            columnSpacing: 16
            rowSpacing: 6
            Layout.fillWidth: true

            Label { text: "Trạng thái"; color: Theme.textMuted; font.pixelSize: 16 }
            Label {
                text: auth.isReady ? "Sẵn sàng" : (auth.loggedOut ? "Đã đăng xuất" : "Chưa cấu hình")
                color: auth.isReady ? Theme.success : Theme.text
                font.pixelSize: 16
            }

            Label { text: "Tài khoản"; color: Theme.textMuted; font.pixelSize: 16 }
            Label {
                text: auth.accountName || "—"
                color: Theme.text
                font.pixelSize: 16
                elide: Text.ElideRight
                Layout.fillWidth: true
            }

            Label { text: "Cookies"; color: Theme.textMuted; font.pixelSize: 16 }
            Label {
                text: auth.cookieCount
                color: auth.cookieCount > 0 ? Theme.success : Theme.text
                font.pixelSize: 16
            }

            Label { text: "OAuth"; color: Theme.textMuted; font.pixelSize: 16 }
            Label {
                text: auth.oauthReady ? "Đã cấu hình" : "Chưa cấu hình"
                color: auth.oauthReady ? Theme.success : Theme.text
                font.pixelSize: 16
            }
        }

        Label {
            text: auth.cookieError
            color: Theme.error
            font.pixelSize: 15
            visible: auth.cookieCritical
            wrapMode: Text.WordWrap
            Layout.fillWidth: true
        }

        RowLayout {
            Layout.fillWidth: true
            IconButton {
                iconName: "play"
                label: "OAuth Flow"
                iconSize: 12
                Layout.minimumWidth: 96
                enabled: !auth.isReady
                onClicked: auth.start_oauth(backend)
            }
            IconButton {
                iconName: "close"
                label: "Đăng xuất"
                iconSize: 12
                Layout.minimumWidth: 96
                enabled: auth.isReady
                onClicked: auth.logout(backend)
            }
            Item { Layout.fillWidth: true; Layout.minimumWidth: 4 }
        }
    }
}
