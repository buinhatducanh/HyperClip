// src/ui/qml/ProxySettingsCard.qml
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

SettingsCard {
    title: "CẤU HÌNH PROXY & CHỐNG CHẶN IP"

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

        // ─── Công tắc phân luồng API / Download ───
        RowLayout {
            Layout.fillWidth: true
            spacing: Theme.spacingLg
            visible: settings ? settings.proxyEnabled : true

            RowLayout {
                spacing: 6
                CheckBox {
                    id: chkApi
                    checked: (settings && settings.apiProxyEnabled !== undefined) ? settings.apiProxyEnabled : true
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
                    checked: (settings && settings.downloadProxyEnabled !== undefined) ? settings.downloadProxyEnabled : true
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
                text: "URL Proxy riêng cho API (Tùy chọn — hỗ trợ HTTP/HTTPS/SOCKS5):"
                color: Theme.textMuted
                font.pixelSize: 11
            }
            TextField {
                Layout.fillWidth: true
                font.pixelSize: Theme.textMd
                color: Theme.text
                placeholderText: "http://user:pass@host:port hoặc socks5://host:port (để trống sẽ dùng cấu hình bên dưới)"
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
            TextField {
                Layout.fillWidth: true
                font.pixelSize: Theme.textMd
                color: Theme.text
                echoMode: TextInput.Password
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
        }
    }
}
