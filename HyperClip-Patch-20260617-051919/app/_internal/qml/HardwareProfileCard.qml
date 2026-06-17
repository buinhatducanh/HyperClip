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
                Layout.preferredHeight: 64
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
                Layout.preferredHeight: 64

                // Glassmorphic accent/disabled styling
                color: isActive 
                    ? Qt.rgba(0, 180, 255, 0.12)
                    : (compatible ? Theme.inputBg : "#141414")

                border.color: isActive 
                    ? Theme.accent 
                    : (compatible ? Theme.border : "#222222")
                border.width: isActive ? 1.5 : 1
                radius: Theme.radiusLg
                opacity: compatible ? 1.0 : 0.5

                // Smooth hover transition
                Rectangle {
                    anchors.fill: parent
                    color: Qt.rgba(255, 255, 255, 0.03)
                    visible: mouseArea.containsMouse && compatible && !isActive
                    radius: parent.radius
                }

                ColumnLayout {
                    anchors.fill: parent
                    anchors.margins: Theme.spacingMd
                    spacing: 4

                    RowLayout {
                        Layout.fillWidth: true
                        spacing: Theme.spacingXs

                        Label {
                            text: modelData ? modelData.label : "—"
                            color: isActive ? Theme.accent : (compatible ? Theme.text : Theme.textMuted)
                            font.pixelSize: Theme.textMd
                            font.bold: true
                            elide: Text.ElideRight
                            Layout.fillWidth: true
                        }

                        // Neon active indicator dot
                        Rectangle {
                            width: 6
                            height: 6
                            radius: 3
                            color: Theme.accent
                            visible: isActive
                            Layout.alignment: Qt.AlignVCenter
                        }
                    }

                    Label {
                        Layout.fillWidth: true
                        text: {
                            if (!modelData) return ""
                            if (!compatible) {
                                return "Cần " + modelData.vramGB + " GB VRAM"
                            }
                            return modelData.vramGB + " GB  ·  " + modelData.sessions + " luồng"
                        }
                        color: !compatible ? Theme.error : Theme.textMuted
                        font.pixelSize: Theme.textSm
                        font.bold: !compatible
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
