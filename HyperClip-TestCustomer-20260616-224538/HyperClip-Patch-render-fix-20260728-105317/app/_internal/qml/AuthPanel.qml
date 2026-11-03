// src/ui/qml/AuthPanel.qml
// Auth/cookie status + OAuth flow + logout — dùng SettingsCard cho nhất quán.
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

SettingsCard {
    title: "XÁC THỰC"
    iconName: "check"

    // ─── Status row ────────────────────────────────────────
    RowLayout {
        Layout.fillWidth: true
        spacing: Theme.spacingSm

        StatusDot {
            state: (auth && auth.isReady) ? "running" : ((auth && auth.cookieCritical) ? "error" : "idle")
            size: 10
            showRing: auth && auth.isReady
            Layout.alignment: Qt.AlignVCenter
        }

        Label {
            text: "Trạng thái"
            color: Theme.textMuted
            font.pixelSize: Theme.textMd
            Layout.alignment: Qt.AlignVCenter
        }

        Label {
            text: (auth && auth.isReady) ? "Sẵn sàng" : ((auth && auth.loggedOut) ? "Đã đăng xuất" : "Chưa cấu hình")
            color: (auth && auth.isReady) ? Theme.success : Theme.text
            font.pixelSize: Theme.textMd
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
            enabled: auth && auth.isReady
            onClicked: if (auth) { auth.logout(backend) }
        }
    }

    // ─── Info grid ─────────────────────────────────────────
    GridLayout {
        columns: 2
        columnSpacing: Theme.spacingLg
        rowSpacing: Theme.spacingSm
        Layout.fillWidth: true

        Label { text: "Tài khoản"; color: Theme.textMuted; font.pixelSize: Theme.textMd }
        Label {
            text: (auth && auth.accountName) || "—"
            color: Theme.text; font.pixelSize: Theme.textMd
            elide: Text.ElideRight; Layout.fillWidth: true
        }

        Label { text: "Cookies"; color: Theme.textMuted; font.pixelSize: Theme.textMd }
        Label {
            text: auth ? auth.cookieCount : 0
            color: (auth && auth.cookieCount > 0) ? Theme.success : Theme.text
            font.pixelSize: Theme.textMd
        }

        Label { text: "OAuth"; color: Theme.textMuted; font.pixelSize: Theme.textMd }
        Label {
            text: (auth && auth.oauthReady) ? "Đã cấu hình" : "Chưa cấu hình"
            color: (auth && auth.oauthReady) ? Theme.success : Theme.text
            font.pixelSize: Theme.textMd
        }
    }

    // ─── Error ─────────────────────────────────────────────
    Label {
        text: auth ? auth.cookieError : ""
        color: Theme.error
        font.pixelSize: Theme.textSm
        visible: auth && auth.cookieCritical
        wrapMode: Text.WordWrap
        Layout.fillWidth: true
    }

    // ─── OAuth button ───────────────────────────────────────
    RowLayout {
        Layout.fillWidth: true
        IconButton {
            iconName: "play"
            label: "OAuth Flow"
            iconSize: 12
            Layout.minimumWidth: 96
            enabled: !auth || !auth.isReady
            onClicked: if (auth) { auth.start_oauth(backend) }
        }
        Item { Layout.fillWidth: true }
    }
}
