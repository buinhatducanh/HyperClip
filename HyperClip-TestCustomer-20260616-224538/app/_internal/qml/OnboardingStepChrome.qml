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
                    text: "💡 CƠ CHẾ HOẠT ĐỘNG BẰNG COOKIE:"
                    color: Theme.accent; font.pixelSize: 12; font.bold: true
                }
                Label {
                    text: "HyperClip tự động giám sát 100+ kênh YouTube bằng cách giả lập kết nối qua 30 tài khoản Chrome cục bộ (Innertube API). Phương thức này hoàn toàn KHÔNG tốn Quota API của Google, giúp hệ thống hoạt động ổn định và phát hiện video mới trong vòng 5 giây."
                    color: Theme.text
                    font.pixelSize: Theme.textMd
                    wrapMode: Text.WordWrap
                    Layout.fillWidth: true
                    lineHeight: 1.2
                }
            }
        }

        // Critical Warning Card
        Rectangle {
            Layout.fillWidth: true
            Layout.preferredHeight: 100
            color: Qt.rgba(255, 68, 68, 0.08)
            border.color: Theme.error
            border.width: 1
            radius: Theme.radiusLg

            RowLayout {
                anchors.fill: parent
                anchors.margins: 14
                spacing: 12

                Text {
                    text: "⚠️"
                    font.pixelSize: 24
                    Layout.alignment: Qt.AlignVCenter
                }

                ColumnLayout {
                    Layout.fillWidth: true
                    spacing: 2
                    Label {
                        text: "LƯU Ý QUAN TRỌNG (ĐÓNG CHROME):"
                        color: Theme.error; font.pixelSize: 11; font.bold: true
                    }
                    Label {
                        text: "Vui lòng đóng hoàn toàn trình duyệt Chrome của bạn trước khi bắt đầu. Windows sẽ khóa file dữ liệu cookie nếu Chrome đang chạy, khiến HyperClip không thể trích xuất thông tin tài khoản."
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
            text: (auth && auth.isReady) ? "Tiếp tục →" : "Khởi động OAuth Flow"
            Layout.alignment: Qt.AlignHCenter
            Layout.preferredWidth: 220
            Layout.preferredHeight: 40
            highlighted: true
            onClicked: {
                if (auth && auth.isReady) {
                    page.next()
                } else if (auth) {
                    auth.start_oauth(backend)
                }
            }
            
            ToolTip.text: (auth && auth.isReady) ? "Tài khoản đã được liên kết. Đi tiếp sang bước tiếp theo." : "Mở trình duyệt để xác thực tài khoản YouTube chính của bạn"
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
