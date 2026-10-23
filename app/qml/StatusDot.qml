// src/ui/qml/StatusDot.qml
// Status indicator — distinct visual treatment per state.
//   "running"     → green + pulse animation
//   "success"     → green + subtle
//   "paused"      → gray (static)
//   "idle"        → gray
//   "warning"     → yellow + subtle blink
//   "error"       → red + strong pulse
//   "connecting"  → blue + slow pulse
//   "ready"       → blue
// Usage: StatusDot { state: poller.active ? "running" : "paused"; size: 8 }
import QtQuick

Item {
    id: root
    property string state: "idle"
    property int size: 8
    property bool showRing: true   // outer ring around dot for emphasis
    implicitWidth: size
    implicitHeight: size

    // Base color from state
    property color baseColor: {
        switch (state) {
            case "running":    return Theme.success
            case "success":    return Theme.success
            case "paused":     return Theme.textMuted
            case "idle":       return Theme.textMuted
            case "warning":    return "#FFD93D"
            case "error":      return Theme.error
            case "connecting": return Theme.accent
            case "ready":      return Theme.accent
            default:           return Theme.textMuted
        }
    }

    // Whether this state should pulse
    property bool shouldPulse: state === "running" || state === "connecting"

    // Whether this state should blink (warning/error)
    property bool shouldBlink: state === "warning" || state === "error"

    // Pulse animation (opacity + scale)
    SequentialAnimation on opacity {
        running: root.shouldPulse
        loops: Animation.Infinite
        NumberAnimation { from: 1.0; to: 0.45; duration: 800; easing.type: Easing.InOutQuad }
        NumberAnimation { from: 0.45; to: 1.0; duration: 800; easing.type: Easing.InOutQuad }
    }

    Rectangle {
        id: core
        anchors.centerIn: parent
        width: parent.size
        height: parent.size
        radius: width / 2
        color: baseColor

        Behavior on color { ColorAnimation { duration: 200 } }
    }

    // Outer ring (glow) for emphasis
    Rectangle {
        id: ring
        anchors.centerIn: parent
        width: parent.size + 6
        height: parent.size + 6
        radius: width / 2
        color: "transparent"
        border.color: baseColor
        border.width: 1
        opacity: 0.25
        visible: root.showRing

        // Ring pulses outward for "running"
        SequentialAnimation on scale {
            running: root.shouldPulse
            loops: Animation.Infinite
            NumberAnimation { from: 1.0; to: 1.6; duration: 1200; easing.type: Easing.OutQuad }
        }
        SequentialAnimation on opacity {
            running: root.shouldPulse
            loops: Animation.Infinite
            NumberAnimation { from: 0.5; to: 0.0; duration: 1200; easing.type: Easing.OutQuad }
        }
    }

    // Blink overlay for warning/error
    Rectangle {
        id: blinkOverlay
        anchors.centerIn: parent
        width: parent.size
        height: parent.size
        radius: width / 2
        color: "white"
        opacity: 0
        visible: root.shouldBlink

        SequentialAnimation on opacity {
            running: root.shouldBlink
            loops: Animation.Infinite
            NumberAnimation { from: 0.6; to: 0.0; duration: 400 }
            NumberAnimation { from: 0.0; to: 0.0; duration: 800 }
        }
    }
}
