// src/ui/qml/HelpTip.qml
// Nút icon [?] gọn gàng hiển thị giải thích chi tiết khi hover chuột (ToolTip)
import QtQuick
import QtQuick.Controls

Rectangle {
    id: tip
    property string text: ""
    property int badgeSize: 16

    width: badgeSize
    height: badgeSize
    radius: badgeSize / 2
    color: ma.containsMouse ? (Theme.accent + "33") : "transparent"
    border.color: ma.containsMouse ? Theme.accent : (Theme.textMuted + "66")
    border.width: 1

    Label {
        anchors.centerIn: parent
        text: "?"
        font.pixelSize: 10
        font.bold: true
        color: ma.containsMouse ? Theme.accent : Theme.textMuted
    }

    MouseArea {
        id: ma
        anchors.fill: parent
        hoverEnabled: true
        cursorShape: Qt.WhatsThisCursor

        ToolTip.visible: containsMouse && tip.text !== ""
        ToolTip.text: tip.text
        ToolTip.delay: 150
        ToolTip.timeout: 10000
    }
}
