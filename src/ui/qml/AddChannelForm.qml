// src/ui/qml/AddChannelForm.qml
// Input field for adding new channel (URL or @handle)
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Rectangle {
    Layout.fillWidth: true
    Layout.preferredHeight: 32
    color: Theme.bg
    border.color: addInput.activeFocus ? Theme.accent : Theme.border
    border.width: 1

    property alias text: addInput.text
    signal addClicked(string url)

    RowLayout {
        anchors.fill: parent
        anchors.margins: 4
        spacing: 4

        TextField {
            id: addInput
            Layout.fillWidth: true
            placeholderText: "@handle or URL"
            color: Theme.text
            font.pixelSize: 11
            background: Rectangle { color: "transparent"; border.width: 0 }
            onAccepted: addBtn.clicked()
        }
        Button {
            id: addBtn
            text: "+"
            Layout.preferredWidth: 24
            Layout.preferredHeight: 24
            onClicked: {
                if (addInput.text.length === 0) return
                let url = addInput.text.trim()
                if (url.startsWith("@")) {
                    url = "https://www.youtube.com/" + url
                } else if (!url.startsWith("http")) {
                    url = "https://www.youtube.com/" + (url.startsWith("@") ? url : "@" + url)
                }
                parent.parent.addClicked(url)
                addInput.text = ""
            }
        }
    }
}
