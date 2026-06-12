// src/ui/qml/AuthPanel.qml
// Auth/cookie status + OAuth flow + logout — standalone card, no SettingsCard wrapper
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

        // ─── Title ──────────────────────────────────────────────
        Label {
            text: "XÁC THỰC"
            color: Theme.accent
            font.pixelSize: Theme.textLg
            font.bold: true
            font.letterSpacing: 0.8
            Layout.fillWidth: true
        }

        // ─── Status row ────────────────────────────────────────
        RowLayout {
            Layout.fillWidth: true
            Layout.preferredHeight: 20
            spacing: 8

            StatusDot {
                state: auth.isReady ? "running" : (auth.cookieCritical ? "error" : "idle")
                size: 10
                showRing: auth.isReady
                Layout.alignment: Qt.AlignVCenter
            }

            Label {
                text: "Trạng thái"
                color: Theme.textMuted
                font.pixelSize: 15
                Layout.alignment: Qt.AlignVCenter
            }

            Label {
                text: auth.isReady ? "Sẵn sàng" : (auth.loggedOut ? "Đã đăng xuất" : "Chưa cấu hình")
                color: auth.isReady ? Theme.success : Theme.text
                font.pixelSize: 15
                font.bold: true
                Layout.alignment: Qt.AlignVCenter
            }

            Item { Layout.fillWidth: true }

            IconButton {
                iconName: "close"
                label: "Đăng xuất"
                iconSize: 12
                Layout.minimumWidth: 90
                Layout.alignment: Qt.AlignVCenter
                enabled: auth.isReady
                onClicked: auth.logout(backend)
            }
        }

        // ─── Info grid ─────────────────────────────────────────
        GridLayout {
            columns: 2
            columnSpacing: 16
            rowSpacing: 6
            Layout.fillWidth: true
            Layout.preferredHeight: 90

            Label { text: "Tài khoản"; color: Theme.textMuted; font.pixelSize: 15 }
            Label {
                text: auth.accountName || "—"
                color: Theme.text; font.pixelSize: 15
                elide: Text.ElideRight; Layout.fillWidth: true
            }

            Label { text: "Cookies"; color: Theme.textMuted; font.pixelSize: 15 }
            Label {
                text: auth.cookieCount
                color: auth.cookieCount > 0 ? Theme.success : Theme.text
                font.pixelSize: 15
            }

            Label { text: "OAuth"; color: Theme.textMuted; font.pixelSize: 15 }
            Label {
                text: auth.oauthReady ? "Đã cấu hình" : "Chưa cấu hình"
                color: auth.oauthReady ? Theme.success : Theme.text
                font.pixelSize: 15
            }
        }

        // ─── Error ─────────────────────────────────────────────
        Label {
            text: auth.cookieError
            color: Theme.error
            font.pixelSize: 14
            visible: auth.cookieCritical
            wrapMode: Text.WordWrap
            Layout.fillWidth: true
        }

        // ─── OAuth button ───────────────────────────────────────
        RowLayout {
            Layout.fillWidth: true
            Layout.preferredHeight: 28
            IconButton {
                iconName: "play"
                label: "OAuth Flow"
                iconSize: 12
                Layout.minimumWidth: 96
                enabled: !auth.isReady
                onClicked: auth.start_oauth(backend)
            }
            Item { Layout.fillWidth: true; Layout.minimumWidth: 4 }
        }
    }
}
