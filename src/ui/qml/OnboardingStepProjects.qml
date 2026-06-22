// src/ui/qml/OnboardingStepProjects.qml
// Step 3: OAuth projects (optional fallback)
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Item {
    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 24
        spacing: Theme.spacingMd

        Label {
            text: "3. Cấu hình dự phòng API (Tùy chọn)"
            color: Theme.text; font.pixelSize: 26; font.bold: true
        }
        
        Label {
            text: "HyperClip ưu tiên sử dụng Innertube API (miễn phí, không giới hạn dung lượng/tần suất quét). Google Projects (Client ID, Client Secret, API Key) chỉ được sử dụng làm phương án DỰ PHÒNG khi các tài khoản Chrome bị lỗi hàng loạt. \n👉 Dù cấu hình dự phòng, hệ thống vẫn ưu tiên Innertube nên hạn ngạch của bạn bình thường sẽ tiêu hao ở mức ~0 quota."
            color: Theme.textMuted; font.pixelSize: Theme.textMd
            wrapMode: Text.WordWrap; Layout.fillWidth: true
            lineHeight: 1.2
        }
        
        ProjectsPanel { 
            Layout.fillWidth: true; 
            Layout.fillHeight: true 
        }
    }
}
