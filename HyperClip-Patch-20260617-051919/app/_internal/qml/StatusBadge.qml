// src/ui/qml/StatusBadge.qml
// Status badge — label + colored dot (uses StatusDot) + optional icon.
// "STATE | Label" — e.g. "ĐANG CHẠY | 5000ms" with green pulse
import QtQuick
import QtQuick.Layouts

RowLayout {
    id: root
    property string state: "idle"
    property string text: ""
    property string icon: ""        // optional icon name
    property int dotSize: 6
    spacing: 6

    StatusDot {
        state: root.state
        size: root.dotSize
        Layout.alignment: Qt.AlignVCenter
    }

    Label {
        text: root.text
        color: {
            switch (root.state) {
                case "running":    return Theme.success
                case "success":    return Theme.success
                case "error":      return Theme.error
                case "warning":    return "#FFD93D"
                case "ready":      return Theme.accent
                case "connecting": return Theme.accent
                default:           return Theme.textMuted
            }
        }
        font.pixelSize: 12
        font.bold: true
        Layout.alignment: Qt.AlignVCenter
    }

    Icon {
        visible: root.icon !== ""
        name: root.icon
        size: 12
        color: Theme.textMuted
    }
}
