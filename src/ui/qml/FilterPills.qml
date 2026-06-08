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

    function createPill(value, label, color) {
        return rectComp.createObject(null, {
            pillValue: value,
            pillLabel: label,
            pillColor: color
        })
    }

    Component {
        id: rectComp
        Rectangle {
            property string pillValue: "all"
            property string pillLabel: "ALL"
            property var pillColor: Theme.accent
            Layout.preferredHeight: 22
            Layout.preferredWidth: pillLabel.length * 7 + 16
            radius: 11
            color: rootPill.current === pillValue ? pillColor : Theme.cardBg
            border.color: rootPill.current === pillValue ? pillColor : Theme.border
            border.width: 1
            Label {
                anchors.centerIn: parent
                text: parent.pillLabel
                color: rootPill.current === parent.pillValue ? "white" : Theme.textMuted
                font.pixelSize: 9
                font.bold: rootPill.current === parent.pillValue
            }
            MouseArea {
                anchors.fill: parent
                cursorShape: Qt.PointingHandCursor
                onClicked: rootPill.filterChanged(parent.pillValue)
            }
        }
    }

    Loader {
        sourceComponent: rectComp
        onLoaded: { item.pillValue = "all"; item.pillLabel = "Tất cả" }
    }
    Loader {
        sourceComponent: rectComp
        onLoaded: { item.pillValue = "ready"; item.pillLabel = "Sẵn sàng"; item.pillColor = Theme.success }
    }
    Loader {
        sourceComponent: rectComp
        onLoaded: { item.pillValue = "rendering"; item.pillLabel = "Render"; item.pillColor = Theme.accent }
    }
    Loader {
        sourceComponent: rectComp
        onLoaded: { item.pillValue = "downloading"; item.pillLabel = "Tải"; item.pillColor = "#FFA500" }
    }
    Loader {
        sourceComponent: rectComp
        onLoaded: { item.pillValue = "error"; item.pillLabel = "Lỗi"; item.pillColor = Theme.error }
    }
    Item { Layout.fillWidth: true }
}
