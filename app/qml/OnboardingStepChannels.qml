// src/ui/qml/OnboardingStepChannels.qml
// Step 2: Add channels
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Item {
    id: root

    // Chạy NGOÀI context delegate (xem chú thích tại onDeleteClicked): toast
    // trước, mutate model sau — mutate làm ListView huỷ delegate đang gọi.
    function doDeleteChannel(id, name) {
        if (activityModel) activityModel.add_entry("channel", "Đã xóa: " + name, "info")
        if (toastService) toastService.show("Đã xóa", "Kênh " + name + " đã được xóa", "info")
        Qt.callLater(function() { channelListModel.remove_channel(id) })
    }

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 24
        spacing: Theme.spacingMd

        Label {
            text: "2. Danh sách kênh cần theo dõi"
            color: Theme.text; font.pixelSize: 26; font.bold: true
        }
        
        Label {
            text: "Nhập đường dẫn kênh (URL) hoặc ID kênh YouTube bạn muốn tự động bắt video. Hệ thống sẽ quét song song tất cả các kênh này cứ sau mỗi 5 giây (có độ lệch ngẫu nhiên để tránh Google phát hiện bot) và tải ngay khi có video mới xuất bản."
            color: Theme.textMuted
            font.pixelSize: Theme.textMd
            wrapMode: Text.WordWrap
            Layout.fillWidth: true
            lineHeight: 1.2
        }

        // Pass 130: AddChannelForm phát signal addClicked nhưng TRƯỚC ĐÂY không
        // nơi nào nối — bấm "+" ở bước onboarding chỉ xoá trắng ô nhập, không
        // gửi lệnh nào xuống backend. Đây là màn hình ĐẦU TIÊN khách mới gặp.
        AddChannelForm {
            Layout.fillWidth: true
            onAddClicked: function(url) {
                if (!url || url.length === 0) return
                channelListModel.add_channel(url)
                if (toastService) toastService.show("Đang thêm kênh", url, "info")
            }
        }

        Connections {
            target: channelListModel
            function onAddResult(ok, message) {
                if (!toastService) return
                if (ok) toastService.show("Đã thêm kênh", "", "success")
                else toastService.show("Không thêm được kênh", message, "warning")
            }
        }

        ListView {
            id: chList
            Layout.fillWidth: true
            Layout.fillHeight: true
            model: channelListModel
            clip: true
            spacing: 2
            delegate: ChannelItem {
                width: chList.width
                isPaused: model.paused
                newCount: model.newCount
                onPauseClicked: {
                    // toggle_pause (Python) tự chọn channel:pause / channel:resume
                    // theo trạng thái hiện tại + cập nhật UI lạc quan — QML không
                    // gửi thêm lệnh trực tiếp (2 lệnh ngược nhau → nút không ăn).
                    if (toastService) toastService.show(model.paused ? "Kênh đã tiếp tục" : "Kênh đã tạm dừng", model.name, "info")
                    channelListModel.toggle_pause(model.id)
                }
                // Callback là hàm ở GỐC file, không phải closure khai trong
                // delegate: remove_channel chạy beginResetModel/endResetModel
                // ngay trong thân callback → ListView huỷ delegate đã sinh ra
                // closure đó, dòng kế tiếp đọc vào object đã chết (ReferenceError
                // — đúng lớp lỗi ghi ở CODE_MAP mục 11).
                onDeleteClicked: confirmDelete.openFor(model.id, model.name, root.doDeleteChannel)
                onCompareClicked: compareModal.openFor(model.channelId, model.name)
            }
            
            ScrollBar.vertical: ScrollBar {
                active: true
            }
        }
    }

    ConfirmationDialog {
        id: confirmDelete
    }
    VideoCompareModal {
        id: compareModal
    }
}
