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
            backend.send_command("channel:add", {"url": url})
            activityModel.add_entry("channel", "Adding: " + url, "info")
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
                if (model.paused) {
                    backend.send_command("channel:resume", {"id": model.channelId})
                } else {
                    backend.send_command("channel:pause", {"id": model.channelId})
                }
                channelListModel.toggle_pause(model.channelId)
            }
            onDeleteClicked: confirmDelete.openFor(model.channelId, model.name)
            onCompareClicked: compareModal.openFor(model.channelId, model.name)
        }
        Label {
            anchors.centerIn: parent
            visible: chList.count === 0
            text: "Chưa có channel nào"
            color: Theme.textMuted
            font.pixelSize: 10
        }
    }

    ConfirmationDialog {
        id: confirmDelete
    }
    VideoCompareModal {
        id: compareModal
    }
}
