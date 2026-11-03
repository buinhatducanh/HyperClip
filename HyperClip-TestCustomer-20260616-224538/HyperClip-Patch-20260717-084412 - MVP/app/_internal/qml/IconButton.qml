// src/ui/qml/IconButton.qml
// Consistent icon button. Hover state, optional label, color per variant.
// Usage: IconButton { iconName: "add"; onClicked: ...; variant: "accent" }
import QtQuick
import QtQuick.Controls

Rectangle {
    id: btn
    property string iconName: "play"
    property string label: ""
    property int iconSize: 14
    property int padding: 6
    property int radiusVal: 4
    property color colorIdle: "transparent"
    property color colorHover: Theme.hoverBg
    property color colorPressed: Theme.accent + "30"
    property color colorDisabled: "transparent"
    property color iconColorIdle: Theme.text
    property color iconColorHover: Theme.text
    property color iconColorDisabled: Theme.textMuted
    property bool flat: false
    property bool hovered: false
    signal clicked()

    color: {
        if (!enabled) return colorDisabled
        if (mouse.pressed) return colorPressed
        if (hovered) return colorHover
        return colorIdle
    }
    border.color: flat ? "transparent" : Theme.border
    border.width: flat ? 0 : 1
    radius: radiusVal
    implicitWidth: padding * 2 + (label !== "" ? iconSize + 6 + labelContent.implicitWidth : iconSize)
    implicitHeight: padding * 2 + iconSize

    Behavior on color { ColorAnimation { duration: 100 } }

    MouseArea {
        id: mouse
        anchors.fill: parent
        hoverEnabled: true
        cursorShape: btn.enabled ? Qt.PointingHandCursor : Qt.ArrowCursor
        onClicked: if (btn.enabled) btn.clicked()
        onEntered: btn.hovered = true
        onExited: btn.hovered = false
    }

    Row {
        anchors.centerIn: parent
        spacing: 6

        Icon {
            name: btn.iconName
            size: btn.iconSize
            color: {
                if (!btn.enabled) return btn.iconColorDisabled
                if (btn.hovered) return btn.iconColorHover
                return btn.iconColorIdle
            }
            anchors.verticalCenter: parent.verticalCenter
        }
        Label {
            id: labelContent
            visible: btn.label !== ""
            text: btn.label
            color: btn.enabled ? (btn.hovered ? btn.iconColorHover : btn.iconColorIdle) : btn.iconColorDisabled
            font.pixelSize: 12
            anchors.verticalCenter: parent.verticalCenter
        }
    }
}
