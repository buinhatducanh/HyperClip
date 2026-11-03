// FilterPills.qml
// Standardized Queue Status Filter Pills with unified theme colors.
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

RowLayout {
    id: rootPill
    spacing: 4
    Layout.fillWidth: true

    property string current: "all"
    signal filterChanged(string value)

    Component {
        id: rectComp
        Rectangle {
            id: pillRect
            property string pillValue: "all"
            property string pillLabel: "Tất cả"
            property var pillColor: Theme.accent
            property string pillIcon: "circle"

            readonly property bool isSelected: rootPill.current === pillValue
            Layout.preferredHeight: 24
            Layout.preferredWidth: pillLabel.length * 7 + 18 + (pillIcon !== "" ? 14 : 0)
            radius: 12
            color: isSelected ? pillColor : (pillMa.containsMouse ? Theme.hoverBg : Theme.cardBg)
            border.color: isSelected ? pillColor : (pillMa.containsMouse ? Theme.cardBorderHover : Theme.border)
            border.width: 1

            Behavior on color { ColorAnimation { duration: 120 } }
            Behavior on border.color { ColorAnimation { duration: 120 } }

            Row {
                anchors.centerIn: pillRect
                spacing: 4
                Icon {
                    visible: pillRect.pillIcon !== ""
                    name: pillRect.pillIcon
                    size: 10
                    color: pillRect.isSelected ? "#FFFFFF" : pillRect.pillColor
                    anchors.verticalCenter: parent.verticalCenter
                }
                Label {
                    text: pillRect.pillLabel
                    color: pillRect.isSelected ? "#FFFFFF" : Theme.textMuted
                    font.pixelSize: 11
                    font.bold: pillRect.isSelected
                    anchors.verticalCenter: parent.verticalCenter
                }
            }
            MouseArea {
                id: pillMa
                anchors.fill: parent
                hoverEnabled: true
                cursorShape: Qt.PointingHandCursor
                onClicked: rootPill.filterChanged(pillRect.pillValue)
            }
        }
    }

    Loader {
        sourceComponent: rectComp
        onLoaded: { item.pillValue = "all"; item.pillLabel = "Tất cả"; item.pillColor = Theme.accent; item.pillIcon = "circle" }
    }
    Loader {
        sourceComponent: rectComp
        onLoaded: { item.pillValue = "pending"; item.pillLabel = "Chờ xử lý"; item.pillColor = Theme.statusWaiting; item.pillIcon = "waiting" }
    }
    Loader {
        sourceComponent: rectComp
        onLoaded: { item.pillValue = "downloading"; item.pillLabel = "Đang tải"; item.pillColor = Theme.statusDownloading; item.pillIcon = "downloading" }
    }
    Loader {
        sourceComponent: rectComp
        onLoaded: { item.pillValue = "rendering"; item.pillLabel = "Render"; item.pillColor = Theme.statusRendering; item.pillIcon = "rendering" }
    }
    Loader {
        sourceComponent: rectComp
        onLoaded: { item.pillValue = "ready"; item.pillLabel = "Hoàn thành"; item.pillColor = Theme.statusReady; item.pillIcon = "ready" }
    }
    Loader {
        sourceComponent: rectComp
        onLoaded: { item.pillValue = "error"; item.pillLabel = "Lỗi"; item.pillColor = Theme.statusError; item.pillIcon = "error" }
    }
    Item { Layout.fillWidth: true }
}
