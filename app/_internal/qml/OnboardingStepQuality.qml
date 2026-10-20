// src/ui/qml/OnboardingStepQuality.qml
// Step 4: GPU profile + render quality
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Item {
    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 24
        spacing: Theme.spacingMd

        Label {
            text: "4. Cấu hình hiệu năng phần cứng"
            color: Theme.text; font.pixelSize: 26; font.bold: true
        }
        
        Label {
            text: "Hệ thống render của HyperClip tối ưu hóa phần cứng bằng cách sử dụng trực tiếp nhân đồ họa NVIDIA (NVENC/NVDEC) và RAM Disk để xử lý video mà không ghi vào HDD. Hãy lựa chọn preset phù hợp với dòng card đồ họa của bạn bên dưới:"
            color: Theme.textMuted
            font.pixelSize: Theme.textMd
            wrapMode: Text.WordWrap
            Layout.fillWidth: true
            lineHeight: 1.2
        }
        
        HardwareProfileCard { 
            Layout.fillWidth: true; 
            Layout.preferredHeight: 240 
        }
    }
}
