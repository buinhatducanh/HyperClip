// src/ui/qml/ChannelList.qml
// Channel list container — input form + scrollable list
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

ColumnLayout {
    spacing: 4
    Layout.fillWidth: true
    Layout.fillHeight: true

    AddChannelForm {
        id: addForm
        onAddClicked: function(url) {
            channelListModel.add_channel(url)
            activityModel.add_entry("channel", "Đang thêm: " + url, "info")
            if (toastService) toastService.show("Đang thêm kênh", url, "info")
        }
    }

    ListView {
        id: chList
        Layout.fillWidth: true
        Layout.fillHeight: true
        model: channelListModel
        clip: true
        spacing: 1
        delegate: ChannelItem {
            width: chList.width
            isPaused: model.paused
            newCount: model.newCount
            onPauseClicked: {
                // toggle_pause đã gửi channel:togglePause + cập nhật UI lạc quan.
                // Trước đây còn gửi thêm channel:pause/resume trực tiếp → 2 lệnh
                // ngược nhau, net = không đổi (nút pause "không ăn"). Bỏ lệnh
                // trực tiếp, chỉ dùng model slot (đã async).
                if (toastService) toastService.show(model.paused ? "Kênh đã tiếp tục" : "Kênh đã tạm dừng", model.name, "info")
                channelListModel.toggle_pause(model.id)
            }
            onDeleteClicked: confirmDelete.openFor(model.id, model.name, function(id, name) {
                // remove_channel đã gửi channel:remove — bỏ lệnh trực tiếp trùng.
                activityModel.add_entry("channel", "Đã xóa: " + name, "info")
                channelListModel.remove_channel(id)
                toastService.show("Đã xóa", "Kênh " + name + " đã được xóa", "info")
            })
            onCompareClicked: compareModal.openFor(model.channelId, model.name)
        }
        Label {
            anchors.centerIn: parent
            visible: chList.count === 0
            text: "Chưa có kênh nào"
            color: Theme.textMuted
            font.pixelSize: 15
        }
    }

    ConfirmationDialog {
        id: confirmDelete
    }
    VideoCompareModal {
        id: compareModal
    }
}
