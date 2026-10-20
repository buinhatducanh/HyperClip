// src/ui/qml/LoadingScreen.qml
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Rectangle {
    id: root
    color: "#0B0B0C" // Premium deep background
    anchors.fill: parent
    z: 1000

    // Prevent interactions with lower components
    MouseArea {
        anchors.fill: parent
        hoverEnabled: true
        preventStealing: true
        onClicked: {}
    }

    // Background glow/gradient overlay
    Rectangle {
        id: accentGlow
        width: 600
        height: 600
        radius: 300
        color: "#00B4FF"
        opacity: 0.08
        anchors.centerIn: parent
        
        // Pulsing glow animation
        SequentialAnimation on opacity {
            loops: Animation.Infinite
            NumberAnimation { to: 0.14; duration: 2500; easing.type: Easing.InOutQuad }
            NumberAnimation { to: 0.08; duration: 2500; easing.type: Easing.InOutQuad }
        }
    }

    // Center container card
    Rectangle {
        id: card
        width: 480
        height: 320
        radius: 12
        color: "#141416"
        border.color: "#22ffffff"
        border.width: 1
        anchors.centerIn: parent

        // Glow ring border
        Rectangle {
            anchors.fill: parent
            anchors.margins: -1
            radius: 13
            color: "transparent"
            border.color: "#00B4FF"
            border.width: 1
            opacity: 0.25
        }

        ColumnLayout {
            anchors.fill: parent
            anchors.margins: 40
            spacing: 24

            // Logo & Title
            RowLayout {
                Layout.alignment: Qt.AlignHCenter
                spacing: 12

                // Spinning progress ring
                Rectangle {
                    width: 32
                    height: 32
                    color: "transparent"
                    border.color: "#00B4FF"
                    border.width: 3
                    radius: 16
                    
                    RotationAnimation on rotation {
                        from: 0
                        to: 360
                        duration: 1500
                        loops: Animation.Infinite
                    }

                    // Neon pulse center dot
                    Rectangle {
                        width: 8
                        height: 8
                        color: "#00FF88"
                        radius: 4
                        anchors.centerIn: parent
                    }
                }

                Text {
                    text: "HyperClip"
                    color: "#FFFFFF"
                    font.pixelSize: 26
                    font.bold: true
                    font.letterSpacing: 1.2
                }
            }

            // Progress labels
            ColumnLayout {
                Layout.fillWidth: true
                spacing: 8

                Text {
                    id: statusLabel
                    text: startup.statusText
                    color: "#E2E2E9"
                    font.pixelSize: 13
                    Layout.alignment: Qt.AlignHCenter
                    elide: Text.ElideRight
                    horizontalAlignment: Text.AlignHCenter
                }

                Text {
                    text: Math.round(startup.progress * 100) + "%"
                    color: "#00B4FF"
                    font.pixelSize: 15
                    font.bold: true
                    Layout.alignment: Qt.AlignHCenter
                }
            }

            // Glow progress bar
            Rectangle {
                Layout.fillWidth: true
                height: 6
                color: "#1E1E22"
                radius: 3

                Rectangle {
                    id: progressBarFill
                    height: parent.height
                    radius: 3
                    width: parent.width * startup.progress

                    gradient: Gradient {
                        orientation: Gradient.Horizontal
                        GradientStop { position: 0.0; color: "#00B4FF" }
                        GradientStop { position: 1.0; color: "#00FF88" }
                    }

                    Behavior on width {
                        NumberAnimation { duration: 250; easing.type: Easing.OutQuad }
                    }
                }
            }

            // Footer note
            Text {
                text: "Đang tự động tối ưu hóa trình duyệt & hiệu năng hệ thống"
                color: "#5C5C64"
                font.pixelSize: 11
                Layout.alignment: Qt.AlignHCenter
            }
        }
    }
}
