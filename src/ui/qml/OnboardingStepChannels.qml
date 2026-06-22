// src/ui/qml/OnboardingStepChannels.qml
// Step 2: Add channels
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Item {
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

        AddChannelForm {
            Layout.fillWidth: true
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
                    if (model.paused) {
                        backend.send_command("channel:resume", {"id": model.channelId})
                        if (toastService) toastService.show("Kênh đã tiếp tục", model.name, "info")
                    } else {
                        backend.send_command("channel:pause", {"id": model.channelId})
                        if (toastService) toastService.show("Kênh đã tạm dừng", model.name, "info")
                    }
                    channelListModel.toggle_pause(model.channelId)
                }
                onDeleteClicked: confirmDelete.openFor(model.channelId, model.name, function(id, name) {
                    backend.send_command("channel:remove", {"id": id})
                    activityModel.add_entry("channel", "Đã xóa: " + name, "info")
                    channelListModel.remove_channel(id)
                    toastService.show("Đã xóa", "Kênh " + name + " đã được xóa", "info")
                })
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
