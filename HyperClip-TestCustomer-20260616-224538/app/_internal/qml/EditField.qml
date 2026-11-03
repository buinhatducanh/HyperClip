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
    Layout.preferredHeight: 36

    RowLayout {
        anchors.fill: parent; anchors.margins: 8; spacing: 8
        Label { text: root.label; color: "#888"; font.pixelSize: 16; Layout.preferredWidth: 80 }
        TextField {
            text: root.value !== null ? root.value.toString() : ""
            Layout.fillWidth: true
            onEditingFinished: root.valueModified(text)
            color: "#fff"; font.pixelSize: 16
            background: Rectangle { color: "#1e1e1e"; border.color: "#333"; radius: 2 }
        }
        Label { text: root.unit; color: "#888"; font.pixelSize: 16; visible: root.unit !== "" }
    }
}