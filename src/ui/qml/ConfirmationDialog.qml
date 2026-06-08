// src/ui/qml/ConfirmationDialog.qml
// Generic confirmation dialog — openFor(id, name, onAccept) → user confirms → runs callback
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
    property var onAcceptCallback: null

    function openFor(id, name, callback) {
        targetId = id
        targetName = name
        onAcceptCallback = callback
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
        if (onAcceptCallback) {
            onAcceptCallback(targetId, targetName)
        }
    }
}
