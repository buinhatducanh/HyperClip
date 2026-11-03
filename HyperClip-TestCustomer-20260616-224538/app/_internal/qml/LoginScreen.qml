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

    property bool isWaitingChrome: false
    property bool dismissed: false

    function close() { dismissed = true; visible = false }
    function show() { dismissed = false; visible = true }

    // ─── Auto-poll backend while login overlay is visible ─────────
    Timer {
        id: pollTimer
        interval: 1500
        running: root.visible && (!auth || !auth.isReady)
        repeat: true
        onTriggered: {
            if (auth) {
                auth.refresh_from_backend(backend)
            }
        }
    }

    // ─── Auto-close after successful login ────────────────────────
    Connections {
        target: auth
        function onChanged() {
            if (auth && auth.isReady && root.visible) {
                autoCloseTimer.start()
            }
        }
    }

    Timer {
        id: autoCloseTimer
        interval: 800
        running: false
        repeat: false
        onTriggered: {
            root.close()
            if (typeof toastService !== "undefined" && toastService) {
                toastService.show("YouTube", "Đã kết nối tài khoản YouTube thành công!", "success")
            }
        }
    }

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
        border.color: (auth && auth.isReady) ? "#00FF88" : "#00B4FF"
        border.width: 1
        opacity: 0.25
    }

    // ─── Center card ────────────────────────────────────────────────
    Rectangle {
        id: card
        width: 460
        height: 520
        radius: 10
        color: "#161616"
        border.color: (auth && auth.isReady) ? "#00FF88" : "#2A2A2A"
        border.width: 1

        anchors.centerIn: parent

        ColumnLayout {
            anchors.fill: parent
            anchors.margins: 36
            spacing: 0

            // ─── Icon / Logo ─────────────────────────────────────
            Rectangle {
                Layout.alignment: Qt.AlignHCenter
                Layout.preferredWidth: 64
                Layout.preferredHeight: 64
                radius: 32
                color: (auth && auth.isReady) ? "#0A2A1E" : "#0A2A3A"
                border.color: (auth && auth.isReady) ? "#00FF88" : "#00B4FF"
                border.width: 1
                Label {
                    anchors.centerIn: parent
                    text: (auth && auth.isReady) ? "✓" : "HC"
                    color: (auth && auth.isReady) ? "#00FF88" : "#00B4FF"
                    font.pixelSize: 32
                    font.bold: true
                }
            }

            Item { Layout.preferredHeight: 18; Layout.fillWidth: true }

            Label {
                text: "HyperClip"
                color: "#FFFFFF"
                font.pixelSize: 36
                font.bold: true
                font.letterSpacing: 3
                Layout.alignment: Qt.AlignHCenter
            }

            Item { Layout.preferredHeight: 4; Layout.fillWidth: true }

            Label {
                text: "24/7 YouTube Auto-Capture Pipeline"
                color: "#777777"
                font.pixelSize: 14
                font.letterSpacing: 1
                Layout.alignment: Qt.AlignHCenter
            }

            Item { Layout.preferredHeight: 20; Layout.fillWidth: true }

            // ─── Separator ───────────────────────────────────────
            Rectangle {
                Layout.fillWidth: true
                Layout.preferredHeight: 1
                color: "#2A2A2A"
            }

            Item { Layout.preferredHeight: 18; Layout.fillWidth: true }

            // ─── Status indicator ─────────────────────────────────
            Rectangle {
                Layout.fillWidth: true
                Layout.preferredHeight: 90
                radius: 6
                color: (auth && auth.isReady) ? "#0A2416"
                     : isWaitingChrome ? "#0A1F2E"
                     : (auth && auth.cookieCritical) ? "#240A0A"
                     : "#1C1C1C"
                border.color: (auth && auth.isReady) ? "#00FF88"
                            : isWaitingChrome ? "#00B4FF"
                            : (auth && auth.cookieCritical) ? "#FF4444"
                            : "#333333"
                border.width: 1

                ColumnLayout {
                    anchors.fill: parent
                    anchors.margins: 14
                    spacing: 6

                    RowLayout {
                        Layout.fillWidth: true
                        spacing: 10

                        Rectangle {
                            Layout.preferredWidth: 10
                            Layout.preferredHeight: 10
                            radius: 5
                            color: (auth && auth.isReady) ? "#00FF88"
                                 : isWaitingChrome ? "#00B4FF"
                                 : (auth && auth.cookieCritical) ? "#FF4444"
                                 : "#888888"
                        }
                        Label {
                            text: (auth && auth.isReady) ? "Đã xác thực thành công (Ready)"
                                 : isWaitingChrome ? "Đang chờ đăng nhập trên Chrome..."
                                 : (auth && auth.cookieCritical) ? "Cookies không hợp lệ"
                                 : "Chưa đăng nhập YouTube"
                            color: (auth && auth.isReady) ? "#00FF88"
                                 : isWaitingChrome ? "#00B4FF"
                                 : (auth && auth.cookieCritical) ? "#FF4444"
                                 : "#DDDDDD"
                            font.pixelSize: 16
                            font.bold: true
                        }
                        Item { Layout.fillWidth: true }
                    }

                    RowLayout {
                        Layout.fillWidth: true
                        spacing: 8
                        Label {
                            text: (auth && auth.isReady) ? "Đang tự động chuyển vào bàn làm việc..."
                                 : isWaitingChrome ? "Hoàn tất đăng nhập trên cửa sổ Chrome vừa mở."
                                 : "Đăng nhập YouTube qua Chrome để tải video giới hạn độ tuổi."
                            color: "#888888"
                            font.pixelSize: 13
                            elide: Text.ElideRight
                            Layout.fillWidth: true
                        }
                        Label {
                            text: "Cookies: " + (auth ? auth.cookieCount : 0)
                            color: (auth && auth.cookieCount > 0) ? "#00FF88" : "#666666"
                            font.pixelSize: 13
                        }
                    }
                }
            }

            Item { Layout.preferredHeight: 18; Layout.fillWidth: true }

            // ─── Buttons ─────────────────────────────────────────
            Button {
                id: mainBtn
                Layout.fillWidth: true
                Layout.preferredHeight: 44

                background: Rectangle {
                    radius: 4
                    color: (auth && auth.isReady) ? "#00B86B"
                         : isWaitingChrome ? "#0A2A3A"
                         : mainBtn.enabled ? "#00B4FF" : "#0A2A3A"
                    border.color: (auth && auth.isReady) ? "#00FF88"
                                : isWaitingChrome ? "#00B4FF"
                                : "#00B4FF"
                    border.width: 1
                }
                contentItem: Label {
                    text: (auth && auth.isReady) ? "Vào ứng dụng ngay →"
                        : isWaitingChrome ? "🔄 Kiểm tra lại đăng nhập"
                        : "Đăng nhập YouTube qua Chrome"
                    color: "#FFFFFF"
                    font.pixelSize: 17
                    font.bold: true
                    horizontalAlignment: Text.AlignHCenter
                    verticalAlignment: Text.AlignVCenter
                }

                onClicked: {
                    if (auth && auth.isReady) {
                        root.close()
                    } else if (isWaitingChrome) {
                        if (auth) auth.refresh_from_backend(backend)
                    } else if (auth) {
                        isWaitingChrome = true
                        auth.start_oauth(backend)
                    }
                }
                enabled: Boolean(auth)
            }

            RowLayout {
                Layout.fillWidth: true
                visible: isWaitingChrome && (!auth || !auth.isReady)
                spacing: 10

                Button {
                    Layout.fillWidth: true
                    Layout.preferredHeight: 32
                    background: Rectangle {
                        radius: 4
                        color: "#1E1E1E"
                        border.color: "#00B4FF"
                        border.width: 1
                    }
                    contentItem: Label {
                        text: "🌐 Mở lại Chrome"
                        color: "#00B4FF"
                        font.pixelSize: 12
                        horizontalAlignment: Text.AlignHCenter
                        verticalAlignment: Text.AlignVCenter
                    }
                    onClicked: {
                        if (auth) auth.start_oauth(backend)
                    }
                }

                Button {
                    Layout.fillWidth: true
                    Layout.preferredHeight: 32
                    background: Rectangle {
                        radius: 4
                        color: "#1E1E1E"
                        border.color: "#555555"
                        border.width: 1
                    }
                    contentItem: Label {
                        text: "✕ Đặt lại"
                        color: "#AAAAAA"
                        font.pixelSize: 12
                        horizontalAlignment: Text.AlignHCenter
                        verticalAlignment: Text.AlignVCenter
                    }
                    onClicked: {
                        root.isWaitingChrome = false
                    }
                }
            }

            Item { Layout.preferredHeight: 10; Layout.fillWidth: true }

            Button {
                id: skipBtn
                Layout.fillWidth: true
                Layout.preferredHeight: 38

                background: Rectangle {
                    radius: 4
                    color: "#1E1E1E"
                    border.color: "#3A3A3A"
                    border.width: 1
                }
                contentItem: Label {
                    text: "Bỏ qua & Vào bàn làm việc"
                    color: "#AAAAAA"
                    font.pixelSize: 14
                    font.bold: true
                    horizontalAlignment: Text.AlignHCenter
                    verticalAlignment: Text.AlignVCenter
                }

                onClicked: root.close()
            }

            Item { Layout.preferredHeight: 8; Layout.fillWidth: true }

            Label {
                text: "💡 Quét kênh & bắt video mới chạy 100% bằng GCP API, không cần đăng nhập."
                color: "#666666"
                font.pixelSize: 12
                Layout.alignment: Qt.AlignHCenter
                wrapMode: Text.WordWrap
                horizontalAlignment: Text.AlignHCenter
                Layout.fillWidth: true
            }

            Item { Layout.fillHeight: true; Layout.fillWidth: true }
        }
    }

    // ─── Auth error banner (dưới card) ────────────────────────────
    Rectangle {
        anchors.top: card.bottom
        anchors.topMargin: 12
        anchors.horizontalCenter: parent.horizontalCenter
        width: card.width
        height: (auth && auth.cookieCritical) ? 36 : 0
        visible: auth && auth.cookieCritical
        color: "#2A1010"
        border.color: "#FF4444"
        border.width: 1
        radius: 4
        Label {
            anchors.centerIn: parent
            text: auth ? (auth.cookieError || "Cookie invalid") : "Cookie invalid"
            color: "#FF4444"
            font.pixelSize: 14
            elide: Text.ElideRight
            leftPadding: 12
            rightPadding: 12
        }
    }
}

