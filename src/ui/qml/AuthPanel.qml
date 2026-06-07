// src/ui/qml/AuthPanel.qml
// Auth/cookie status + OAuth flow + logout
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Rectangle {
    color: Theme.bg
    border.color: Theme.border
    border.width: 1
    Layout.preferredHeight: 220

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 12
        spacing: 8

        RowLayout {
            Layout.fillWidth: true
            Label {
                text: "AUTHENTICATION"
                color: Theme.accent
                font.pixelSize: 13
                font.bold: true
                Layout.fillWidth: true
            }
            Rectangle {
                width: 10; height: 10; radius: 5
                color: auth.isReady ? Theme.success
                     : auth.cookieCritical ? Theme.error
                     : Theme.textMuted
            }
        }

        GridLayout {
            columns: 2
            columnSpacing: 16
            rowSpacing: 6
            Layout.fillWidth: true

            Label { text: "Status"; color: Theme.textMuted; font.pixelSize: 11 }
            Label {
                text: auth.isReady ? "Ready" : (auth.loggedOut ? "Logged out" : "Not configured")
                color: auth.isReady ? Theme.success : Theme.text
                font.pixelSize: 11
            }

            Label { text: "Account"; color: Theme.textMuted; font.pixelSize: 11 }
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
                text: auth.oauthReady ? "Configured" : "Not configured"
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
                text: "Logout"
                enabled: auth.isReady
                onClicked: auth.logout(backend)
            }
            Item { Layout.fillWidth: true }
        }
    }
}
