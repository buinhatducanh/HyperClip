// src/ui/qml/OnboardingStepProjects.qml
// Bước cấu hình Google Cloud.
//
// Pass 56: bước này từ "tùy chọn dự phòng" thành BẮT BUỘC. Lõi phát hiện video
// chạy hoàn toàn bằng YouTube Data API v3 — không có project thì app không quét
// được gì cả. Văn bản cũ ("Innertube miễn phí, GCP chỉ là dự phòng, quota tiêu
// ~0") giờ vừa sai vừa nguy hiểm: nó dạy khách bỏ qua đúng bước duy nhất mà
// thiếu nó thì mọi thứ khác vô nghĩa.
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Item {
    GcpWizard {
        id: wizard
        onProjectAdded: if (quota) quota.refresh_from_backend(backend)
    }

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 24
        spacing: Theme.spacingMd

        RowLayout {
            Layout.fillWidth: true
            spacing: 10
            Label {
                text: "3. Kết nối Google Cloud"
                color: Theme.text
                font.pixelSize: 26
                font.bold: true
            }
            Rectangle {
                Layout.preferredHeight: 22
                Layout.preferredWidth: reqLbl.implicitWidth + 16
                radius: 11
                color: (quota && quota.projectCount > 0 ? Theme.success : Theme.error) + "20"
                border.color: quota && quota.projectCount > 0 ? Theme.success : Theme.error
                border.width: 1
                Label {
                    id: reqLbl
                    anchors.centerIn: parent
                    text: quota && quota.projectCount > 0 ? "ĐÃ SẴN SÀNG" : "BẮT BUỘC"
                    color: quota && quota.projectCount > 0 ? Theme.success : Theme.error
                    font.pixelSize: 10
                    font.bold: true
                }
            }
            Item { Layout.fillWidth: true }
        }

        Label {
            text: "HyperClip phát hiện video mới bằng YouTube Data API v3. Cần ít nhất một Google Cloud Project — không có thì app không quét được kênh nào.\n\nMỗi project cho 10.000 units/ngày. Nhờ cách gộp 50 kênh vào một lệnh, một project đủ theo dõi hàng chục kênh; thêm project chỉ cần khi bạn muốn quét dày hơn."
            color: Theme.textMuted
            font.pixelSize: Theme.textMd
            wrapMode: Text.WordWrap
            Layout.fillWidth: true
            lineHeight: 1.25
        }

        QuotaPoolCard {
            Layout.fillWidth: true
            Layout.fillHeight: true
            onAddProjectRequested: wizard.open()
        }
    }
}
