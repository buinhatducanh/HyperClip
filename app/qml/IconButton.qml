// src/ui/qml/IconButton.qml
// Consistent icon button with auto-tooltip, enhanced hitboxes, variants and modern hover states.
import QtQuick
import QtQuick.Controls

Rectangle {
    id: btn
    property string iconName: "play"
    property string label: ""
    property string tooltipText: ""
    property string variant: "default" // "default" | "accent" | "danger" | "success" | "ghost"
    property int iconSize: 14
    property int padding: 7
    property int radiusVal: Theme.radiusMd
    property int minWidth: label !== "" ? 64 : 32
    property int minHeight: 32

    // Base colors per variant
    property color colorIdle: {
        if (variant === "accent") return Theme.accent + "22"
        if (variant === "danger") return Theme.error + "20"
        if (variant === "success") return Theme.success + "20"
        if (variant === "ghost") return "transparent"
        return "transparent"
    }
    property color colorHover: {
        if (variant === "accent") return Theme.accent + "44"
        if (variant === "danger") return Theme.error + "38"
        if (variant === "success") return Theme.success + "38"
        return Theme.hoverBg
    }
    property color colorPressed: {
        if (variant === "accent") return Theme.accent
        if (variant === "danger") return Theme.error
        if (variant === "success") return Theme.success
        return Theme.accent + "33"
    }
    property color colorDisabled: "transparent"

    property color iconColorIdle: {
        if (variant === "accent") return Theme.accent
        if (variant === "danger") return Theme.error
        if (variant === "success") return Theme.success
        return Theme.text
    }
    property color iconColorHover: {
        if (variant === "accent" || variant === "danger" || variant === "success") return "#FFFFFF"
        return Theme.text
    }
    property color iconColorDisabled: Theme.textMuted

    property bool flat: variant === "ghost"
    property bool hovered: false
    signal clicked()

    color: {
        if (!enabled) return colorDisabled
        if (mouse.pressed) return colorPressed
        if (hovered) return colorHover
        return colorIdle
    }
    border.color: {
        if (!enabled) return "transparent"
        if (flat) return "transparent"
        if (hovered) {
            if (variant === "accent") return Theme.accent
            if (variant === "danger") return Theme.error
            return Theme.cardBorderHover
        }
        if (variant === "accent") return Theme.accent + "66"
        if (variant === "danger") return Theme.error + "66"
        return Theme.border
    }
    border.width: flat ? 0 : 1
    radius: radiusVal

    implicitWidth: Math.max(minWidth, padding * 2 + (label !== "" ? iconSize + 8 + labelContent.implicitWidth : iconSize))
    implicitHeight: Math.max(minHeight, padding * 2 + iconSize)

    Behavior on color { ColorAnimation { duration: 120 } }
    Behavior on border.color { ColorAnimation { duration: 120 } }

    MouseArea {
        id: mouse
        anchors.fill: parent
        hoverEnabled: true
        cursorShape: btn.enabled ? Qt.PointingHandCursor : Qt.ArrowCursor
        onClicked: if (btn.enabled) btn.clicked()
        onEntered: btn.hovered = true
        onExited: btn.hovered = false
    }

    ToolTip.visible: btn.enabled && btn.hovered && (btn.tooltipText !== "" || (btn.label === "" && btn.iconName !== ""))
    ToolTip.text: {
        if (btn.tooltipText !== "") return btn.tooltipText
        if (btn.label !== "") return btn.label
        // Default smart tooltip fallback
        switch (btn.iconName) {
            case "trash": return "Xóa"
            case "delete": return "Xóa"
            case "play": return "Phát / Chạy"
            case "pause": return "Tạm dừng"
            case "retry": return "Thử lại"
            case "refresh": return "Làm mới"
            case "edit": return "Chỉnh sửa"
            case "render": return "Render video"
            case "download": return "Tải về"
            case "folder": return "Mở thư mục"
            case "settings": return "Cài đặt"
            case "close": return "Đóng"
            case "check": return "Chọn"
            case "bolt": return "Ưu tiên"
            default: return ""
        }
    }
    ToolTip.delay: 400
    ToolTip.timeout: 4000

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
            font.bold: btn.variant === "accent" || btn.variant === "danger"
            anchors.verticalCenter: parent.verticalCenter
        }
    }
}
