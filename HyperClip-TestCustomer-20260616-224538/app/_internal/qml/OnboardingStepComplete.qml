// src/ui/qml/OnboardingStepComplete.qml
// Step 5: Done!
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Item {
    ColumnLayout {
        anchors.centerIn: parent
        spacing: Theme.spacingLg
        width: 500

        Label {
            text: "🎉"
            font.pixelSize: 72
            Layout.alignment: Qt.AlignHCenter
        }
        Label {
            text: "Thiết lập thành công!"
            color: Theme.success; font.pixelSize: 28; font.bold: true
            Layout.alignment: Qt.AlignHCenter
        }
        
        // Summary Card
        Rectangle {
            Layout.fillWidth: true
            Layout.preferredHeight: 160
            color: Theme.cardBg
            border.color: Theme.border
            border.width: 1
            radius: Theme.radiusLg

            ColumnLayout {
                anchors.fill: parent
                anchors.margins: 16
                spacing: Theme.spacingSm

                Label {
                    text: "🚀 TẤT CẢ HỆ THỐNG ĐÃ SẴN SÀNG:"
                    color: Theme.accent; font.pixelSize: 12; font.bold: true
                }
                
                RowLayout {
                    spacing: 8
                    Icon { name: "check"; size: 12; color: Theme.success }
                    Label { text: "Cookie Chrome: Tự động trích xuất để bypass Quota."; color: Theme.text; font.pixelSize: Theme.textMd }
                }
                RowLayout {
                    spacing: 8
                    Icon { name: "check"; size: 12; color: Theme.success }
                    Label { text: "Danh sách kênh: Đã cấu hình và sẵn sàng giám sát."; color: Theme.text; font.pixelSize: Theme.textMd }
                }
                RowLayout {
                    spacing: 8
                    Icon { name: "check"; size: 12; color: Theme.success }
                    Label { text: "GPU Acceleration: Đã tối ưu hóa luồng render CUDA."; color: Theme.text; font.pixelSize: Theme.textMd }
                }
                
                Label {
                    text: "Bây giờ bạn có thể bật chức năng 'Tự động render' trong Cài đặt để quy trình chạy hoàn toàn tự động."
                    color: Theme.textMuted
                    font.pixelSize: Theme.textSm
                    wrapMode: Text.WordWrap
                    Layout.fillWidth: true
                }
            }
        }

        Label {
            text: "Bấm 'Hoàn tất' ở bên dưới để đóng bảng thiết lập và đi tới Dashboard chính."
            color: Theme.textMuted; font.pixelSize: 14
            Layout.alignment: Qt.AlignHCenter
            horizontalAlignment: Text.AlignHCenter
            wrapMode: Text.WordWrap
            Layout.preferredWidth: 440
        }
    }
}
