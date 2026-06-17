// src/ui/qml/ToastNotification.qml
// Chrome-style toast — bottom-right corner, auto-dismiss with progress bar,
// supports multiple levels (info/success/warn/error), and optional click action.
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Rectangle {
    id: toast

    property string title: ""
    property string message: ""
    property string level: "info"     // info | success | warn | error
    property string actionLabel: ""
    property var actionCallback: null
    property int autoCloseMs: 4000

    width: 340
    height: col.implicitHeight + 20
    radius: 6
    color: level === "error" ? "#1F1010"
         : level === "warn"  ? "#1F1A10"
         : level === "success" ? "#0F1F14"
         : "#1A1A1A"
    border.color: level === "error" ? "#FF4444"
               : level === "warn"  ? "#FFD93D"
               : level === "success" ? "#00FF88"
               : Theme.accent
    border.width: 1
    opacity: 0

    // Slide-in animation
    x: parent ? parent.width - width - 16 : 0
    y: parent ? parent.height - height - 16 - (toast.parent ? toast.parent.toastOffset || 0 : 0) : 0

    Behavior on x { NumberAnimation { duration: 250; easing.type: Easing.OutCubic } }
    Behavior on opacity { NumberAnimation { duration: 200 } }

    function show() {
        opacity = 1
        progressBar.width = 0
        progressAnim.restart()
        autoCloseTimer.interval = autoCloseMs
        autoCloseTimer.restart()
    }
    function dismiss() {
        autoCloseTimer.stop()
        opacity = 0
    }

    Timer {
        id: autoCloseTimer
        repeat: false
        onTriggered: toast.opacity = 0
    }

    // Auto-dismiss progress bar
    Rectangle {
        id: progressBar
        anchors.bottom: parent.bottom
        anchors.left: parent.left
        height: 2
        color: parent.border.color
        opacity: 0.6

        NumberAnimation on width {
            id: progressAnim
            from: toast.width
            to: 0
            duration: toast.autoCloseMs
            easing.type: Easing.Linear
        }
    }

    ColumnLayout {
        id: col
        anchors.fill: parent
        anchors.margins: 10
        spacing: 4

        RowLayout {
            Layout.fillWidth: true
            spacing: 8

            // Level icon
            Rectangle {
                Layout.preferredWidth: 18
                Layout.preferredHeight: 18
                radius: 9
                color: "transparent"
                border.color: toast.border.color
                border.width: 1
                Label {
                    anchors.centerIn: parent
                    text: toast.level === "error" ? "✕"
                        : toast.level === "warn" ? "!"
                        : toast.level === "success" ? "✓"
                        : "i"
                    color: toast.border.color
                    font.pixelSize: 15
                    font.bold: true
                }
            }

            Label {
                text: toast.title
                color: Theme.text
                font.pixelSize: 18
                font.bold: true
                elide: Text.ElideRight
                Layout.fillWidth: true
            }

            // Dismiss button
            Label {
                text: "✕"
                color: Theme.textMuted
                font.pixelSize: 18
                opacity: closeArea.containsMouse ? 1.0 : 0.5
                MouseArea {
                    id: closeArea
                    anchors.fill: parent
                    hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onClicked: toast.dismiss()
                }
            }
        }

        Label {
            text: toast.message
            color: Theme.text
            font.pixelSize: 16
            wrapMode: Text.WordWrap
            Layout.fillWidth: true
        }

        // Action button (optional)
        Item {
            visible: toast.actionLabel !== ""
            Layout.fillWidth: true
            Layout.preferredHeight: visible ? 22 : 0
            Button {
                anchors.right: parent.right
                text: toast.actionLabel
                flat: true
                font.pixelSize: 15
                contentItem: Label {
                    text: parent.text
                    color: Theme.accent
                    font.pixelSize: 15
                    font.bold: true
                }
                background: Rectangle { color: "transparent" }
                onClicked: {
                    if (toast.actionCallback) toast.actionCallback()
                    toast.dismiss()
                }
            }
        }
    }

    // Click anywhere on toast to dismiss (unless action button is hit)
    MouseArea {
        anchors.fill: parent
        acceptedButtons: Qt.LeftButton
        onClicked: toast.dismiss()
        z: -1
    }
}
