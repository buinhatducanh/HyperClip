// src/ui/qml/LoginScreen.qml
// Blocking overlay + elevated card — page content bị chặn hoàn toàn bởi overlay tối,
// card nổi lên nhờ shadow + border neon, KHÔNG hòa vào background
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Rectangle {
    id: root
    // Opaque dark overlay — page không xuyên qua được, triệt tiêu hoàn toàn
    color: "#0D0D0D"
    anchors.fill: parent
    z: 999

    function close() { visible = false }
    function show() { visible = true }

    // ─── Card shadow layer (đổ bóng ra 4 phía) ────────────────────
    Rectangle {
        x: card.x + 4
        y: card.y + 4
        width: card.width
        height: card.height
        radius: 8
        color: "#000000"
        opacity: 0.6
    }
    Rectangle {
        x: card.x - 2
        y: card.y - 2
        width: card.width + 4
        height: card.height + 4
        radius: 10
        color: "transparent"
        border.color: "#00B4FF"
        border.width: 1
        opacity: 0.15
    }

    // ─── Center card ────────────────────────────────────────────────
    Rectangle {
        id: card
        width: 440
        height: 480
        radius: 8
        color: "#161616"
        border.color: "#2A2A2A"
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
                color: "#0A2A3A"
                border.color: "#00B4FF"
                border.width: 1
                Label {
                    anchors.centerIn: parent
                    text: "HC"
                    color: "#00B4FF"
                    font.pixelSize: 22
                    font.bold: true
                }
            }

            Item { Layout.preferredHeight: 24; Layout.fillWidth: true }

            Label {
                text: "HyperClip"
                color: "#FFFFFF"
                font.pixelSize: 28
                font.bold: true
                font.letterSpacing: 4
                Layout.alignment: Qt.AlignHCenter
            }

            Item { Layout.preferredHeight: 6; Layout.fillWidth: true }

            Label {
                text: "24/7 YouTube Auto-Capture Pipeline"
                color: "#666666"
                font.pixelSize: 10
                font.letterSpacing: 2
                Layout.alignment: Qt.AlignHCenter
            }

            Item { Layout.preferredHeight: 28; Layout.fillWidth: true }

            // ─── Separator ───────────────────────────────────────
            Rectangle {
                Layout.fillWidth: true
                Layout.preferredHeight: 1
                color: "#2A2A2A"
            }

            Item { Layout.preferredHeight: 24; Layout.fillWidth: true }

            // ─── Status indicator ─────────────────────────────────
            Rectangle {
                Layout.fillWidth: true
                Layout.preferredHeight: 80
                radius: 6
                color: auth.isReady ? "#0A1F14"
                     : auth.cookieCritical ? "#1F0A0A"
                     : "#1A1A1A"
                border.color: auth.isReady ? "#00FF88"
                           : auth.cookieCritical ? "#FF4444"
                           : "#2A2A2A"
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
                            color: auth.isReady ? "#00FF88"
                                 : auth.cookieCritical ? "#FF4444"
                                 : "#666666"
                        }
                        Label {
                            text: auth.isReady ? "Authenticated"
                                 : auth.cookieCritical ? "Cookies Invalid"
                                 : "Not Authenticated"
                            color: auth.isReady ? "#00FF88"
                                 : auth.cookieCritical ? "#FF4444"
                                 : "#CCCCCC"
                            font.pixelSize: 12
                            font.bold: true
                        }
                        Item { Layout.fillWidth: true }
                    }

                    RowLayout {
                        Layout.fillWidth: true
                        spacing: 8
                        Label {
                            text: "Account:"
                            color: "#888888"
                            font.pixelSize: 10
                        }
                        Label {
                            text: auth.accountName || "—"
                            color: "#FFFFFF"
                            font.pixelSize: 10
                            elide: Text.ElideRight
                            Layout.fillWidth: true
                        }
                        Label {
                            text: "Cookies: " + auth.cookieCount
                            color: "#888888"
                            font.pixelSize: 10
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
                    radius: 4
                    color: mainBtn.enabled ? "#00B4FF" : "#0A2A3A"
                    border.color: "#00B4FF"
                    border.width: mainBtn.enabled ? 1 : 0
                }
                contentItem: Label {
                    text: mainBtn.text
                    color: mainBtn.enabled ? "#FFFFFF" : "#555555"
                    font.pixelSize: 13
                    font.bold: true
                    horizontalAlignment: Text.AlignHCenter
                    verticalAlignment: Text.AlignVCenter
                }

                text: auth.isReady ? "Tiếp tục →" : "Đăng nhập YouTube"
                onClicked: {
                    if (auth.isReady) root.close()
                    else auth.start_oauth(backend)
                }
                enabled: !auth.cookieCritical
            }

            Item { Layout.preferredHeight: 10; Layout.fillWidth: true }

            Button {
                id: skipBtn
                Layout.fillWidth: true
                Layout.preferredHeight: 36

                background: Rectangle {
                    radius: 4
                    color: "transparent"
                    border.color: "#333333"
                    border.width: 1
                }
                contentItem: Label {
                    text: skipBtn.text
                    color: "#666666"
                    font.pixelSize: 10
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
        height: auth.cookieCritical ? 36 : 0
        visible: auth.cookieCritical
        color: "#2A1010"
        border.color: "#FF4444"
        border.width: 1
        radius: 4
        Label {
            anchors.centerIn: parent
            text: auth.cookieError || "Cookie invalid"
            color: "#FF4444"
            font.pixelSize: 10
            elide: Text.ElideRight
            leftPadding: 12
            rightPadding: 12
        }
    }
}
