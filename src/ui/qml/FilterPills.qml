// FilterPills.qml
// Status filter pills row — uses named root + explicit current binding
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

RowLayout {
    id: rootPill
    spacing: 4
    Layout.fillWidth: true

    property string current: "all"
    signal filterChanged(string value)

    function createPill(value, label, color, iconName) {
        return rectComp.createObject(null, {
            pillValue: value,
            pillLabel: label,
            pillColor: color,
            pillIcon: iconName
        })
    }

    Component {
        id: rectComp
        Rectangle {
            id: pillRect
            property string pillValue: "all"
            property string pillLabel: "ALL"
            property var pillColor: Theme.accent
            property string pillIcon: "circle"
            Layout.preferredHeight: 22
            Layout.preferredWidth: pillLabel.length * 7 + 16 + (pillIcon !== "" ? 16 : 0)
            radius: 11
            color: rootPill.current === pillValue ? pillColor : Theme.cardBg
            border.color: rootPill.current === pillValue ? pillColor : Theme.border
            border.width: 1
            Row {
                anchors.centerIn: pillRect
                spacing: 4
                Icon {
                    visible: pillRect.pillIcon !== ""
                    name: pillRect.pillIcon
                    size: 10
                    color: rootPill.current === pillRect.pillValue ? "white" : Theme.textMuted
                    anchors.verticalCenter: parent.verticalCenter
                }
                Label {
                    text: pillRect.pillLabel
                    color: rootPill.current === pillRect.pillValue ? "white" : Theme.textMuted
                    font.pixelSize: 11
                    font.bold: rootPill.current === pillRect.pillValue
                    anchors.verticalCenter: parent.verticalCenter
                }
            }
            MouseArea {
                anchors.fill: parent
                cursorShape: Qt.PointingHandCursor
                onClicked: rootPill.filterChanged(pillRect.pillValue)
            }
        }
    }

    Loader {
        sourceComponent: rectComp
        onLoaded: { item.pillValue = "all"; item.pillLabel = "Tất cả"; item.pillIcon = "circle" }
    }
    Loader {
        sourceComponent: rectComp
        onLoaded: { item.pillValue = "ready"; item.pillLabel = "Sẵn sàng"; item.pillColor = Theme.success; item.pillIcon = "ready" }
    }
    Loader {
        sourceComponent: rectComp
        onLoaded: { item.pillValue = "rendering"; item.pillLabel = "Render"; item.pillColor = Theme.accent; item.pillIcon = "rendering" }
    }
    Loader {
        sourceComponent: rectComp
        onLoaded: { item.pillValue = "downloading"; item.pillLabel = "Tải"; item.pillColor = "#FFA500"; item.pillIcon = "downloading" }
    }
    Loader {
        sourceComponent: rectComp
        onLoaded: { item.pillValue = "error"; item.pillLabel = "Lỗi"; item.pillColor = Theme.error; item.pillIcon = "error" }
    }
    Item { Layout.fillWidth: true }
}
