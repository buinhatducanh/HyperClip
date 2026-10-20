// src/ui/qml/ProxySettingsCard.qml
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

SettingsCard {
    title: "CẤU HÌNH PROXY & CHỐNG CHẶN IP"

    property string testStatus: "idle" // "idle" | "testing" | "success" | "error"
    property string testMessage: ""
    property int latencyMs: 0
    property string egressIp: ""
    property bool showPassword: false

    function applyQuickProxy(raw) {
        if (!raw || !raw.trim()) return
        var resp = backend.send_command("proxy:parse", {"proxy": raw.trim()})
        if (resp && resp.ok && resp.result && resp.result.success) {
            var r = resp.result
            if (settings) {
                settings.proxyEnabled = true
                settings.proxyHost = r.host
                settings.proxyPort = r.port
                settings.proxyUsername = r.user
                settings.proxyPassword = r.pass
                settings.apiProxyUrl = r.normalized
            }
            quickProxyInput.text = ""
            testStatus = "idle"
            if (typeof toastService !== "undefined" && toastService) {
                var info = "Host: " + r.host + ":" + r.port + (r.user ? (" (User: " + r.user + ")") : "")
                toastService.show("Đã nhận diện Proxy", info, "success")
            }
        } else {
            var err = (resp && resp.result && resp.result.error) || (resp && resp.error) || "Không thể nhận diện định dạng proxy!"
            if (typeof toastService !== "undefined" && toastService) {
                toastService.show("Lỗi định dạng", err, "error")
            }
        }
    }

    function testCurrentProxy() {
        testStatus = "testing"
        testMessage = "Đang kiểm tra kết nối qua proxy tới Google..."
        Qt.callLater(function() {
            var pVal = (settings && settings.apiProxyUrl) ? settings.apiProxyUrl : ""
            var resp = backend.send_command("proxy:test", {"proxy": pVal, "timeoutSec": 6})
            if (resp && resp.ok && resp.result && resp.result.success) {
                testStatus = "success"
                latencyMs = resp.result.pingMs || resp.result.latencyMs || 0
                egressIp = resp.result.egress || ""
                testMessage = "Kết nối Google OK! Độ trễ: " + latencyMs + "ms — IP đường ra: " + egressIp
                if (typeof toastService !== "undefined" && toastService) {
                    toastService.show("Proxy dùng tốt", testMessage, "success")
                }
            } else {
                testStatus = "error"
                var errMsg = (resp && resp.result && resp.result.error) || (resp && resp.error) || "Không thể kết nối qua proxy!"
                testMessage = errMsg
                if (typeof toastService !== "undefined" && toastService) {
                    toastService.show("Lỗi kết nối Proxy", errMsg, "error")
                }
            }
        })
    }

    function clearProxySettings() {
        if (settings) {
            settings.proxyEnabled = false
            settings.proxyHost = ""
            settings.proxyPort = 0
            settings.proxyUsername = ""
            settings.proxyPassword = ""
            settings.apiProxyUrl = ""
        }
        quickProxyInput.text = ""
        testStatus = "idle"
        testMessage = ""
        if (typeof toastService !== "undefined" && toastService) {
            toastService.show("Đã xóa Proxy", "Đã quay về kết nối Direct (IP máy)", "info")
        }
    }

    ColumnLayout {
        Layout.fillWidth: true
        spacing: Theme.spacingMd

        // ─── Hàng công tắc chính ───
        RowLayout {
            Layout.fillWidth: true
            spacing: Theme.spacingMd
            ColumnLayout {
                spacing: 2
                Layout.fillWidth: true
                Label {
                    text: "Bật sử dụng Proxy"
                    color: Theme.text
                    font.pixelSize: Theme.textMd
                    font.bold: true
                }
                Label {
                    text: "Định tuyến lưu lượng qua máy chủ Proxy để tránh chặn IP, tránh rate limit 429 và vượt tường lửa."
                    color: Theme.textMuted
                    font.pixelSize: 11
                    wrapMode: Text.WordWrap
                    Layout.fillWidth: true
                }
            }
            Switch {
                checked: settings ? settings.proxyEnabled : false
                onToggled: if (settings) settings.proxyEnabled = checked
            }
        }

        // ─── Khung Dán Nhanh Thông Minh (Quick Smart Paste) ───
        Rectangle {
            Layout.fillWidth: true
            Layout.preferredHeight: quickCol.implicitHeight + 20
            color: Theme.inputBg
            border.color: Theme.border
            border.width: 1
            radius: Theme.radiusMd

            ColumnLayout {
                id: quickCol
                anchors.fill: parent
                anchors.margins: 10
                spacing: 8

                RowLayout {
                    Layout.fillWidth: true
                    spacing: 6
                    Icon {
                        name: "bolt"
                        size: 14
                        color: Theme.accent
                    }
                    Label {
                        text: "Dán nhanh thông tin Proxy (Tự động nhận diện):"
                        color: Theme.accent
                        font.pixelSize: 12
                        font.bold: true
                    }
                }

                RowLayout {
                    Layout.fillWidth: true
                    spacing: 8

                    TextField {
                        id: quickProxyInput
                        Layout.fillWidth: true
                        font.pixelSize: Theme.textMd
                        color: Theme.text
                        placeholderText: "Dán định dạng IP:Port:User:Pass hoặc IP:Port hoặc link http/socks5..."
                        placeholderTextColor: Theme.textMuted
                        onAccepted: applyQuickProxy(text)
                        background: Rectangle {
                            color: Theme.cardBg
                            border.color: parent.activeFocus ? Theme.accent : Theme.border
                            border.width: 1
                            radius: Theme.radiusMd
                        }
                    }

                    IconButton {
                        iconName: "check"
                        iconSize: 12
                        label: "Tự điền"
                        variant: "accent"
                        Layout.preferredHeight: 32
                        ToolTip.text: "Bóc tách Host, Port, User, Pass và điền vào cấu hình bên dưới"
                        ToolTip.visible: hovered
                        ToolTip.delay: 300
                        onClicked: applyQuickProxy(quickProxyInput.text)
                    }

                    IconButton {
                        iconName: "delete"
                        iconSize: 12
                        label: "Xóa cấu hình"
                        variant: "ghost"
                        Layout.preferredHeight: 32
                        ToolTip.text: "Xóa toàn bộ thông tin proxy và quay lại dùng Direct IP"
                        ToolTip.visible: hovered
                        ToolTip.delay: 300
                        onClicked: clearProxySettings()
                    }
                }

                Label {
                    text: "💡 Mẹo: Hỗ trợ mọi định dạng nhà cung cấp (IP:Port:User:Pass | User:Pass@IP:Port | danh sách nhiều dòng tự lấy dòng đầu)."
                    color: Theme.textMuted
                    font.pixelSize: 11
                    wrapMode: Text.WordWrap
                    Layout.fillWidth: true
                }
            }
        }

        // ─── Hàng Kiểm tra kết nối & Trạng thái ───
        RowLayout {
            Layout.fillWidth: true
            spacing: Theme.spacingMd
            visible: settings ? settings.proxyEnabled : true

            IconButton {
                iconName: "retry"
                iconSize: 12
                label: "Kiểm tra kết nối Proxy"
                variant: "accent"
                Layout.preferredHeight: 30
                enabled: testStatus !== "testing"
                ToolTip.text: "Thử gửi kết nối kiểm chứng qua proxy tới Google để đo độ trễ và phát hiện IP đầu ra"
                ToolTip.visible: hovered
                ToolTip.delay: 300
                onClicked: testCurrentProxy()
            }

            Item { Layout.fillWidth: true }
        }

        // ─── Hộp thông báo kết quả kiểm tra ───
        Rectangle {
            Layout.fillWidth: true
            Layout.preferredHeight: 36
            visible: testStatus !== "idle" && (settings ? settings.proxyEnabled : true)
            color: testStatus === "testing" ? (Theme.accent + "18")
                 : (testStatus === "success" ? (Theme.success + "1C") : (Theme.error + "1C"))
            border.color: testStatus === "testing" ? Theme.accent
                        : (testStatus === "success" ? Theme.success : Theme.error)
            border.width: 1
            radius: Theme.radiusMd

            RowLayout {
                anchors.fill: parent
                anchors.leftMargin: 12
                anchors.rightMargin: 12
                spacing: 8

                Icon {
                    name: testStatus === "testing" ? "pending"
                        : (testStatus === "success" ? "check" : "warning")
                    size: 13
                    color: testStatus === "testing" ? Theme.accent
                         : (testStatus === "success" ? Theme.success : Theme.error)
                }

                Label {
                    Layout.fillWidth: true
                    text: testMessage
                    color: testStatus === "testing" ? Theme.accent
                         : (testStatus === "success" ? Theme.success : Theme.error)
                    font.pixelSize: 11
                    elide: Text.ElideRight
                }
            }
        }

        // ─── Công tắc phân luồng API / Download ───
        RowLayout {
            Layout.fillWidth: true
            spacing: Theme.spacingLg
            visible: settings ? settings.proxyEnabled : true

            RowLayout {
                spacing: 6
                CheckBox {
                    id: chkApi
                    checked: Boolean(settings && settings.apiProxyEnabled !== undefined ? settings.apiProxyEnabled : true)
                    onToggled: if (settings) settings.apiProxyEnabled = checked
                }
                Label {
                    text: "Áp dụng cho Quét API (Google Data API v3)"
                    color: Theme.text
                    font.pixelSize: Theme.textSm
                    MouseArea {
                        anchors.fill: parent
                        onClicked: chkApi.toggle()
                    }
                }
            }

            RowLayout {
                spacing: 6
                CheckBox {
                    id: chkDl
                    checked: Boolean(settings && settings.downloadProxyEnabled !== undefined ? settings.downloadProxyEnabled : true)
                    onToggled: if (settings) settings.downloadProxyEnabled = checked
                }
                Label {
                    text: "Áp dụng cho Tải video (yt-dlp)"
                    color: Theme.text
                    font.pixelSize: Theme.textSm
                    MouseArea {
                        anchors.fill: parent
                        onClicked: chkDl.toggle()
                    }
                }
            }
        }

        // ─── Ô nhập URL Proxy API riêng (nếu có) ───
        ColumnLayout {
            Layout.fillWidth: true
            spacing: 4
            visible: settings ? (settings.proxyEnabled && settings.apiProxyEnabled) : true

            Label {
                text: "URL Proxy đầy đủ (Hệ thống tự đồng bộ từ cấu hình bên dưới hoặc ô dán nhanh):"
                color: Theme.textMuted
                font.pixelSize: 11
            }
            TextField {
                Layout.fillWidth: true
                font.pixelSize: Theme.textMd
                color: Theme.text
                placeholderText: "http://user:pass@host:port hoặc socks5://host:port"
                placeholderTextColor: Theme.textMuted
                text: (settings && settings.apiProxyUrl) ? settings.apiProxyUrl : ""
                onEditingFinished: if (settings) settings.apiProxyUrl = text.trim()
                background: Rectangle {
                    color: Theme.inputBg
                    border.color: parent.activeFocus ? Theme.accent : Theme.border
                    border.width: 1
                    radius: Theme.radiusMd
                }
            }
        }

        // ─── Bảng cấu hình Host / Port / User / Pass chung ───
        GridLayout {
            columns: 4
            columnSpacing: Theme.spacingMd
            rowSpacing: Theme.spacingSm
            Layout.fillWidth: true
            visible: settings ? settings.proxyEnabled : true

            // Host
            Label {
                text: "Địa chỉ Host/IP:"
                color: Theme.textMuted
                font.pixelSize: 12
                Layout.alignment: Qt.AlignVCenter
            }
            TextField {
                Layout.fillWidth: true
                Layout.preferredWidth: 160
                font.pixelSize: Theme.textMd
                color: Theme.text
                placeholderText: "127.0.0.1 hoặc proxy.com"
                placeholderTextColor: Theme.textMuted
                text: settings ? settings.proxyHost : ""
                onEditingFinished: if (settings) settings.proxyHost = text.trim()
                background: Rectangle {
                    color: Theme.inputBg
                    border.color: parent.activeFocus ? Theme.accent : Theme.border
                    border.width: 1
                    radius: Theme.radiusMd
                }
            }

            // Port
            Label {
                text: "Port:"
                color: Theme.textMuted
                font.pixelSize: 12
                Layout.alignment: Qt.AlignVCenter
            }
            SpinBox {
                Layout.preferredWidth: 110
                font.pixelSize: Theme.textMd
                from: 0
                to: 65535
                value: settings ? settings.proxyPort : 0
                editable: true
                onValueModified: if (settings) settings.proxyPort = value
                onActiveFocusChanged: {
                    if (!activeFocus) {
                        var val = valueFromText(contentItem.text, locale)
                        val = Math.max(from, Math.min(to, val))
                        value = val
                        if (settings) settings.proxyPort = val
                    }
                }
            }

            // Username
            Label {
                text: "Username (nếu có):"
                color: Theme.textMuted
                font.pixelSize: 12
                Layout.alignment: Qt.AlignVCenter
            }
            TextField {
                Layout.fillWidth: true
                font.pixelSize: Theme.textMd
                color: Theme.text
                placeholderText: "Tài khoản proxy"
                placeholderTextColor: Theme.textMuted
                text: settings ? settings.proxyUsername : ""
                onEditingFinished: if (settings) settings.proxyUsername = text.trim()
                background: Rectangle {
                    color: Theme.inputBg
                    border.color: parent.activeFocus ? Theme.accent : Theme.border
                    border.width: 1
                    radius: Theme.radiusMd
                }
            }

            // Password
            Label {
                text: "Password (nếu có):"
                color: Theme.textMuted
                font.pixelSize: 12
                Layout.alignment: Qt.AlignVCenter
            }
            RowLayout {
                Layout.fillWidth: true
                spacing: 4

                TextField {
                    id: pwdField
                    Layout.fillWidth: true
                    font.pixelSize: Theme.textMd
                    color: Theme.text
                    echoMode: showPassword ? TextInput.Normal : TextInput.Password
                    placeholderText: "Mật khẩu proxy"
                    placeholderTextColor: Theme.textMuted
                    text: settings ? settings.proxyPassword : ""
                    onEditingFinished: if (settings) settings.proxyPassword = text.trim()
                    background: Rectangle {
                        color: Theme.inputBg
                        border.color: parent.activeFocus ? Theme.accent : Theme.border
                        border.width: 1
                        radius: Theme.radiusMd
                    }
                }

                IconButton {
                    iconName: showPassword ? "lock" : "search"
                    iconSize: 12
                    variant: "ghost"
                    Layout.preferredWidth: 28
                    Layout.preferredHeight: 28
                    ToolTip.text: showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"
                    ToolTip.visible: hovered
                    ToolTip.delay: 300
                    onClicked: showPassword = !showPassword
                }
            }
        }
    }
}
