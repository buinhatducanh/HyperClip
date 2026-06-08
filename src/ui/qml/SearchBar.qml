// src/ui/qml/SearchBar.qml
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Rectangle {
    color: Theme.bg
    border.color: input.activeFocus ? Theme.accent : Theme.border
    border.width: 1
    Layout.fillWidth: true
    Layout.preferredHeight: 28

    property alias placeholderText: input.placeholderText
    signal searchChanged(string searchText)
    signal clearClicked()

    RowLayout {
        anchors.fill: parent
        anchors.margins: 4
        spacing: 4
        Label { text: "\U0001F50D"; font.pixelSize: 11 }
        TextField {
            id: input
            Layout.fillWidth: true
            placeholderText: "Tìm kiếm..."
            color: Theme.text
            font.pixelSize: 11
            background: Rectangle { color: "transparent"; border.width: 0 }
            onTextChanged: parent.parent.searchChanged(text)
        }
        Button {
            text: "×"
            visible: input.text.length > 0
            Layout.preferredWidth: 20
            Layout.preferredHeight: 20
            onClicked: {
                input.text = ""
                parent.parent.clearClicked()
            }
        }
    }
}
