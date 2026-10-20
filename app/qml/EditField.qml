// src/ui/qml/EditField.qml
// Standardized inline editable field conforming to Theme tokens.
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Rectangle {
    id: root
    property string label: ""
    property var value: null
    property string unit: ""
    signal valueModified(var newValue)

    color: "transparent"
    Layout.fillWidth: true
    Layout.preferredHeight: 34

    RowLayout {
        anchors.fill: parent
        anchors.margins: 4
        spacing: 8

        Label {
            text: root.label
            color: Theme.textMuted
            font.pixelSize: Theme.textSm
            Layout.preferredWidth: 80
        }

        TextField {
            id: inputField
            text: root.value !== null ? root.value.toString() : ""
            Layout.fillWidth: true
            onEditingFinished: root.valueModified(text)
            color: Theme.text
            font.pixelSize: Theme.textSm
            background: Rectangle {
                color: Theme.inputBg
                border.color: inputField.activeFocus ? Theme.accent : Theme.border
                border.width: 1
                radius: Theme.radiusSm
            }
        }

        Label {
            text: root.unit
            color: Theme.textMuted
            font.pixelSize: Theme.textSm
            visible: root.unit !== ""
        }
    }
}
