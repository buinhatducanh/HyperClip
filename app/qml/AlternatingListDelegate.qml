// src/ui/qml/AlternatingListDelegate.qml
// Reusable delegate pattern for lists with alternating row colors
import QtQuick
import QtQuick.Controls

Rectangle {
    id: root

    property bool isSelected: false
    property bool isHovered: false
    property color selectedColor: Qt.rgba(0, 0.47, 0.75, 0.25) // Theme.highlight-like
    property color hoverColor: Theme.hoverBg
    property color evenColor: Theme.rowEven
    property color oddColor: Theme.rowOdd

    width: ListView.view ? ListView.view.width : parent.width
    color: isSelected ? selectedColor
         : isHovered ? hoverColor
         : (index % 2 === 0 ? evenColor : oddColor)

    HoverHandler {
        cursorShape: Qt.PointingHandCursor
        onHoveredChanged: root.isHovered = hovered
    }

    default property alias content: body.data

    Item {
        id: body
        anchors.fill: parent
        anchors.margins: 4
    }
}
