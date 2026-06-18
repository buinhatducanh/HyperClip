// src/ui/qml/HardwareProfileCard.qml
// Detected GPU + selectable quality preset.
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

SettingsCard {
    id: container
    title: "PHẦN CỨNG"

    Label {
        Layout.fillWidth: true
        text: hwProfile
              ? hwProfile.detectedGpuName + "  ·  " + hwProfile.detectedVramGb + " GB VRAM  ·  " + hwProfile.detectedRamGb + " GB RAM"
              : "Đang tải thông tin phần cứng..."
        color: Theme.textMuted
        font.pixelSize: Theme.textMd
        elide: Text.ElideRight
        Layout.bottomMargin: Theme.spacingXs
    }

    // --- SKELETON LOADER STATE ---
    RowLayout {
        Layout.fillWidth: true
        spacing: Theme.spacingSm
        visible: !hwProfile || hwProfile.isBusy

        Repeater {
            model: 5
            delegate: Rectangle {
                Layout.fillWidth: true
                Layout.preferredHeight: 80 // Match actual content state height
                color: Theme.inputBg
                radius: Theme.radiusLg
                border.color: Theme.border
                border.width: 1

                Rectangle {
                    anchors.fill: parent
                    anchors.margins: 1
                    color: Theme.hoverBg
                    radius: Theme.radiusLg - 1

                    SequentialAnimation on opacity {
                        loops: Animation.Infinite
                        running: !hwProfile || hwProfile.isBusy
                        NumberAnimation { from: 0.15; to: 0.45; duration: 800; easing.type: Easing.InOutQuad }
                        NumberAnimation { from: 0.45; to: 0.15; duration: 800; easing.type: Easing.InOutQuad }
                    }
                }
            }
        }
    }

    // --- ACTUAL CONTENT STATE ---
    RowLayout {
        Layout.fillWidth: true
        spacing: Theme.spacingSm
        visible: hwProfile && !hwProfile.isBusy

        Repeater {
            model: hwProfile ? hwProfile.presets() : []
            delegate: Rectangle {
                id: presetCard
                readonly property bool isActive: hwProfile && modelData && modelData.id === hwProfile.activeId
                readonly property bool compatible: hwProfile && modelData
                    ? (hwProfile.detectedVramGb === 0 || modelData.vramGB <= hwProfile.detectedVramGb) : false

                Layout.fillWidth: true
                Layout.preferredHeight: 80 // Increased height from 64 to 80 to prevent any font clipping or overflow on high DPI

                // Glassmorphic premium card styling
                color: isActive 
                    ? Qt.rgba(0, 180, 255, 0.15)
                    : (compatible ? Theme.inputBg : Qt.rgba(255, 68, 68, 0.03))

                border.color: isActive 
                    ? Theme.accent 
                    : (compatible ? (mouseArea.containsMouse ? Qt.rgba(0, 180, 255, 0.3) : Theme.border) : Qt.rgba(255, 68, 68, 0.2))
                border.width: isActive ? 2 : 1
                radius: Theme.radiusLg
                opacity: compatible ? 1.0 : 0.5

                // Glow effect for active profile
                Rectangle {
                    anchors.fill: parent
                    radius: parent.radius
                    color: "transparent"
                    border.color: Theme.accent
                    border.width: 1
                    opacity: isActive ? 0.3 : 0.0
                    visible: isActive
                }

                // Smooth hover transition
                Rectangle {
                    anchors.fill: parent
                    color: Qt.rgba(255, 255, 255, 0.02)
                    visible: mouseArea.containsMouse && compatible && !isActive
                    radius: parent.radius
                }

                ColumnLayout {
                    anchors.fill: parent
                    anchors.margins: Theme.spacingSm // Reduced margin from Md (12) to Sm (8) to allow maximum vertical space
                    spacing: Theme.spacingXs // Very small spacing to prevent label overlapping

                    RowLayout {
                        Layout.fillWidth: true
                        spacing: Theme.spacingXs

                        Label {
                            text: modelData ? modelData.label : "—"
                            color: isActive ? "#FFFFFF" : (compatible ? Theme.text : Theme.textMuted)
                            font.pixelSize: Theme.textMd
                            font.bold: true
                            elide: Text.ElideRight
                            Layout.fillWidth: true
                        }

                        // Status pill instead of simple dot
                        Rectangle {
                            width: 42
                            height: 16
                            radius: 8
                            color: isActive ? Theme.accent : "transparent"
                            border.color: isActive ? "transparent" : (compatible ? "#333" : "transparent")
                            border.width: 1
                            visible: isActive || !compatible
                            Label {
                                anchors.centerIn: parent
                                text: isActive ? "ACTIVE" : "YẾU"
                                font.pixelSize: 8
                                font.bold: true
                                color: isActive ? "#FFFFFF" : Theme.error
                            }
                        }
                    }

                    Label {
                        Layout.fillWidth: true
                        text: {
                            if (!modelData) return ""
                            if (!compatible) {
                                return "Cần " + modelData.vramGB + " GB VRAM"
                            }
                            return modelData.vramGB + " GB VRAM  ·  " + modelData.sessions + " luồng"
                        }
                        color: !compatible ? Theme.error : (isActive ? Qt.rgba(255, 255, 255, 0.7) : Theme.textMuted)
                        font.pixelSize: Theme.textSm
                        font.bold: !compatible
                        wrapMode: Text.WordWrap
                        maximumLineCount: 2
                        elide: Text.ElideRight
                    }
                }

                MouseArea {
                    id: mouseArea
                    anchors.fill: parent
                    hoverEnabled: true
                    enabled: compatible && hwProfile && !hwProfile.isBusy
                    cursorShape: enabled ? Qt.PointingHandCursor : Qt.ArrowCursor
                    onClicked: {
                        if (compatible && hwProfile && modelData) {
                            hwProfile.select_preset(backend, settings, modelData.id)
                        }
                    }
                }
            }
        }
    }
}
