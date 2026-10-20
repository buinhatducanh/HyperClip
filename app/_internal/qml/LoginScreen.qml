// src/ui/qml/LoginScreen.qml
// Blocking overlay + elevated card — page content bị chặn hoàn toàn bởi overlay tối,
// card nổi lên nhờ shadow + border neon, KHÔNG hòa vào background
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Rectangle {
    id: root
    // Overlay backdrop
    color: Theme.overlay
    anchors.fill: parent
    z: 999

    function close() { visible = false }
    function show() { visible = true }

    // ─── Card shadow layer ─────────────────────────────────────────
    Rectangle {
        x: card.x + 4
        y: card.y + 4
        width: card.width
        height: card.height
        radius: Theme.radiusLg
        color: "#000000"
        opacity: Theme.isLight ? 0.12 : 0.6
    }
    Rectangle {
        x: card.x - 2
        y: card.y - 2
        width: card.width + 4
        height: card.height + 4
        radius: Theme.radiusLg + 2
        color: "transparent"
        border.color: Theme.accent
        border.width: 1
        opacity: Theme.isLight ? 0.25 : 0.15
    }

    // ─── Center card ────────────────────────────────────────────────
    Rectangle {
        id: card
        width: 440
        height: 480
        radius: Theme.radiusLg
        color: Theme.cardBg
        border.color: Theme.border
        border.width: 1

        anchors.centerIn: parent

        ColumnLayout {
            anchors.fill: parent
            anchors.margins: 40
            spacing: 0

            // ─── Icon / Logo ─────────────────────────────────────
            Rectangle {
                Layout.alignment: Qt.AlignHCenter
                Layout.preferredWidth: 64
                Layout.preferredHeight: 64
                radius: 32
                color: Theme.isLight ? "#E0F2FE" : "#0A2A3A"
                border.color: Theme.accent
                border.width: 1
                Label {
                    anchors.centerIn: parent
                    text: (typeof isShortEdition !== "undefined" && isShortEdition) ? "HS" : "HC"
                    color: Theme.accent
                    font.pixelSize: 30
                    font.bold: true
                }
            }

            Item { Layout.preferredHeight: 24; Layout.fillWidth: true }

            Label {
                text: (typeof isShortEdition !== "undefined" && isShortEdition) ? "HyperShort" : "HyperClip"
                color: Theme.text
                font.pixelSize: 38
                font.bold: true
                font.letterSpacing: 3
                Layout.alignment: Qt.AlignHCenter
            }

            Item { Layout.preferredHeight: 6; Layout.fillWidth: true }

            Label {
                text: (typeof isShortEdition !== "undefined" && isShortEdition)
                    ? "24/7 Shorts Auto-Capture & NVENC Pipeline"
                    : "24/7 YouTube Auto-Capture Pipeline"
                color: Theme.textMuted
                font.pixelSize: 14
                font.letterSpacing: 1
                Layout.alignment: Qt.AlignHCenter
            }

            Item { Layout.preferredHeight: 28; Layout.fillWidth: true }

            // ─── Separator ───────────────────────────────────────
            Rectangle {
                Layout.fillWidth: true
                Layout.preferredHeight: 1
                color: Theme.border
            }

            Item { Layout.preferredHeight: 24; Layout.fillWidth: true }

            // ─── Status indicator ─────────────────────────────────
            Rectangle {
                Layout.fillWidth: true
                Layout.preferredHeight: 80
                radius: Theme.radiusMd
                color: (auth && auth.isReady) ? (Theme.isLight ? "#E8F8EE" : "#0A1F14")
                     : (auth && auth.cookieCritical) ? (Theme.isLight ? "#FDE8E8" : "#1F0A0A")
                     : Theme.inputBg
                border.color: (auth && auth.isReady) ? Theme.success
                            : (auth && auth.cookieCritical) ? Theme.error
                            : Theme.border
                border.width: 1

                ColumnLayout {
                    anchors.fill: parent
                    anchors.margins: 16
                    spacing: 8

                    RowLayout {
                        Layout.fillWidth: true
                        spacing: 10

                        Rectangle {
                            Layout.preferredWidth: 10
                            Layout.preferredHeight: 10
                            radius: 5
                            color: (auth && auth.isReady) ? Theme.success
                                 : (auth && auth.cookieCritical) ? Theme.error
                                 : Theme.textMuted
                        }
                        Label {
                            text: (auth && auth.isReady) ? "Đã xác thực YouTube"
                                 : (auth && auth.cookieCritical) ? "Cookies không hợp lệ"
                                 : "Chưa xác thực"
                            color: (auth && auth.isReady) ? Theme.success
                                 : (auth && auth.cookieCritical) ? Theme.error
                                 : Theme.text
                            font.pixelSize: 16
                            font.bold: true
                        }
                        Item { Layout.fillWidth: true }
                    }

                    RowLayout {
                        Layout.fillWidth: true
                        spacing: 8
                        Label {
                            text: "Account:"
                            color: Theme.textMuted
                            font.pixelSize: 14
                        }
                        Label {
                            text: auth ? (auth.accountName || "—") : "—"
                            color: Theme.text
                            font.pixelSize: 14
                            elide: Text.ElideRight
                            Layout.fillWidth: true
                        }
                        Label {
                            text: "Cookies: " + (auth ? auth.cookieCount : 0)
                            color: Theme.textMuted
                            font.pixelSize: 14
                        }
                    }
                }
            }

            Item { Layout.preferredHeight: 24; Layout.fillWidth: true }

            // ─── Buttons ─────────────────────────────────────────
            Button {
                id: mainBtn
                Layout.fillWidth: true
                Layout.preferredHeight: 42

                background: Rectangle {
                    radius: Theme.radiusMd
                    color: mainBtn.enabled ? Theme.accent : (Theme.isLight ? "#E5E5EA" : "#0A2A3A")
                    border.color: Theme.accent
                    border.width: mainBtn.enabled ? 1 : 0
                }
                contentItem: Label {
                    text: mainBtn.text
                    color: mainBtn.enabled ? "#FFFFFF" : Theme.textMuted
                    font.pixelSize: 18
                    font.bold: true
                    horizontalAlignment: Text.AlignHCenter
                    verticalAlignment: Text.AlignVCenter
                }

                text: (auth && auth.isReady) ? "Tiếp tục →" : "Đăng nhập YouTube"
                onClicked: {
                    if (auth && auth.isReady) root.close()
                    else if (auth) auth.start_oauth(backend)
                }
                enabled: auth ? !auth.cookieCritical : false
            }

            Item { Layout.preferredHeight: 10; Layout.fillWidth: true }

            Button {
                id: skipBtn
                Layout.fillWidth: true
                Layout.preferredHeight: 36

                background: Rectangle {
                    radius: Theme.radiusMd
                    color: "transparent"
                    border.color: Theme.border
                    border.width: 1
                }
                contentItem: Label {
                    text: skipBtn.text
                    color: Theme.textMuted
                    font.pixelSize: 14
                    horizontalAlignment: Text.AlignHCenter
                    verticalAlignment: Text.AlignVCenter
                }

                text: "Bỏ qua — dùng cookies thủ công"
                onClicked: root.close()
            }

            Item { Layout.fillHeight: true; Layout.fillWidth: true }
        }
    }

    // ─── Auth error banner (dưới card) ────────────────────────────
    Rectangle {
        anchors.top: card.bottom
        anchors.topMargin: 16
        anchors.horizontalCenter: parent.horizontalCenter
        width: card.width
        height: (auth && auth.cookieCritical) ? 36 : 0
        visible: auth && auth.cookieCritical
        color: Theme.isLight ? "#FDE8E8" : "#2A1010"
        border.color: Theme.error
        border.width: 1
        radius: Theme.radiusMd
        Label {
            anchors.centerIn: parent
            text: auth ? (auth.cookieError || "Cookie invalid") : "Cookie invalid"
            color: Theme.error
            font.pixelSize: 14
            elide: Text.ElideRight
            leftPadding: 12
            rightPadding: 12
        }
    }
}
