// src/ui/qml/ConfirmationDialog.qml
// Generic confirmation dialog — openFor(id, name) → user confirms → emits accepted
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Dialog {
    id: dlg
    title: "Xác nhận"
    modal: true
    standardButtons: Dialog.Yes | Dialog.No
    width: 360
    property string targetId: ""
    property string targetName: ""

    function openFor(id, name) {
        targetId = id
        targetName = name
        msgLabel.text = "Xóa \"" + name + "\"?"
        open()
    }

    Label {
        id: msgLabel
        text: "Xác nhận?"
        color: Theme.text
        font.pixelSize: 12
        wrapMode: Text.WordWrap
    }

    onAccepted: {
        if (targetId !== "") {
            backend.send_command("channel:remove", {"id": targetId})
            activityModel.add_entry("channel", "Removed: " + targetName, "info")
            channelListModel.remove_channel(targetId)
        }
    }
}
