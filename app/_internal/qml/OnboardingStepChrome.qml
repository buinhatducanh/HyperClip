// src/ui/qml/OnboardingStepChrome.qml
// Step 1: Chrome OAuth login & cookie warnings
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Item {
    ColumnLayout {
        anchors.centerIn: parent
        spacing: Theme.spacingLg
        width: 540

        Label {
            text: "1. Đăng nhập YouTube"
            color: Theme.text; font.pixelSize: 26; font.bold: true
            Layout.alignment: Qt.AlignHCenter
        }

        // PO Explanation card
        Rectangle {
            Layout.fillWidth: true
            Layout.preferredHeight: 140
            color: Theme.cardBg
            border.color: Theme.border
            border.width: 1
            radius: Theme.radiusLg

            ColumnLayout {
                anchors.fill: parent
                anchors.margins: 14
                spacing: Theme.spacingSm

                Label {
                    text: "💡 VAI TRÒ CỦA ĐĂNG NHẬP CHROME:"
                    color: Theme.accent; font.pixelSize: 12; font.bold: true
                }
                Label {
                    text: "HyperClip dùng phiên đăng nhập Chrome để trích xuất cookie an toàn qua CDP, phục vụ việc tải video giới hạn độ tuổi và video hội viên. Luồng quét và phát hiện video mới chạy độc lập bằng YouTube Data API v3 gộp 50 kênh/lệnh theo project GCP."
                    color: Theme.text
                    font.pixelSize: Theme.textMd
                    wrapMode: Text.WordWrap
                    Layout.fillWidth: true
                    lineHeight: 1.2
                }
            }
        }

        // Chrome Login Guidance Card
        Rectangle {
            Layout.fillWidth: true
            Layout.preferredHeight: 90
            color: Qt.rgba(0, 180, 255, 0.08)
            border.color: Theme.accent
            border.width: 1
            radius: Theme.radiusLg

            RowLayout {
                anchors.fill: parent
                anchors.margins: 14
                spacing: 12

                Text {
                    text: "ℹ️"
                    font.pixelSize: 24
                    Layout.alignment: Qt.AlignVCenter
                }

                ColumnLayout {
                    Layout.fillWidth: true
                    spacing: 2
                    Label {
                        text: "HƯỚNG DẪN ĐĂNG NHẬP:"
                        color: Theme.accent; font.pixelSize: 11; font.bold: true
                    }
                    Label {
                        text: "Bấm nút bên dưới để HyperClip mở cửa sổ Chrome riêng biệt cho bạn đăng nhập. Quá trình trích xuất cookie sẽ tự động hoàn tất qua giao thức CDP mà không xung đột với các phiên Chrome khác."
                        color: Theme.text
                        font.pixelSize: Theme.textSm
                        wrapMode: Text.WordWrap
                        Layout.fillWidth: true
                        lineHeight: 1.15
                    }
                }
            }
        }

        Button {
            id: oauthBtn
            text: (auth && auth.isReady) ? "Tiếp tục →" : "Đăng nhập YouTube qua Chrome"
            Layout.alignment: Qt.AlignHCenter
            Layout.preferredWidth: 250
            Layout.preferredHeight: 40
            highlighted: true
            onClicked: {
                if (auth && auth.isReady) {
                    page.next()
                } else if (auth) {
                    auth.start_oauth(backend)
                }
            }
            
            ToolTip.text: (auth && auth.isReady) ? "Tài khoản đã được liên kết. Đi tiếp sang bước tiếp theo." : "Mở trình duyệt Chrome để đăng nhập tài khoản YouTube của bạn"
            ToolTip.visible: hovered
            ToolTip.delay: 300
        }

        RowLayout {
            Layout.alignment: Qt.AlignHCenter
            spacing: 8
            StatusDot {
                state: (auth && auth.isReady) ? "ready" : "idle"
                size: 8
            }
            Label {
                text: "Trạng thái xác thực: " + ((auth && auth.isReady) ? "Đã liên kết tài khoản" : "Chưa liên kết")
                color: (auth && auth.isReady) ? Theme.success : Theme.textMuted
                font.pixelSize: Theme.textMd
            }
        }
    }
}
