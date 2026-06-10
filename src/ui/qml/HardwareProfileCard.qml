// src/ui/qml/HardwareProfileCard.qml
// Detected GPU + selectable quality preset.
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

SettingsCard {
    title: "PHẦN CỨNG"

    ColumnLayout {
        Layout.fillWidth: true
        spacing: Theme.spacingMd

        Label {
            Layout.fillWidth: true
            text: hwProfile
                  ? hwProfile.detectedGpuName + "  ·  " + hwProfile.detectedVramGb + " GB VRAM  ·  " + hwProfile.detectedRamGb + " GB RAM"
                  : "Đang tải thông tin phần cứng..."
            color: Theme.textMuted
            font.pixelSize: Theme.textMd
            elide: Text.ElideRight
        }

        RowLayout {
            Layout.fillWidth: true
            spacing: Theme.spacingSm
            Repeater {
                model: hwProfile ? hwProfile.presets() : []
                delegate: Rectangle {
                    readonly property bool isActive: hwProfile && modelData && modelData.id === hwProfile.activeId
                    readonly property bool compatible: hwProfile && modelData
                        ? modelData.vramGB <= hwProfile.detectedVramGb : false
                    Layout.fillWidth: true
                    Layout.preferredHeight: 56
                    color: isActive ? Theme.hoverBg : Theme.inputBg
                    border.color: isActive ? Theme.accent : Theme.border
                    border.width: 1
                    radius: Theme.radiusMd
                    opacity: compatible ? 1.0 : 0.45

                    ColumnLayout {
                        anchors.fill: parent
                        anchors.margins: Theme.spacingSm
                        spacing: 2
                        Label {
                            Layout.fillWidth: true
                            text: modelData ? modelData.label : "—"
                            color: isActive ? Theme.accent : Theme.text
                            font.pixelSize: Theme.textMd
                            font.bold: true
                            elide: Text.ElideRight
                        }
                        Label {
                            Layout.fillWidth: true
                            text: modelData ? modelData.vramGB + " GB  ·  " + modelData.sessions + " sess" : ""
                            color: Theme.textMuted
                            font.pixelSize: Theme.textSm
                            elide: Text.ElideRight
                        }
                    }
                    MouseArea {
                        anchors.fill: parent
                        cursorShape: compatible ? Qt.PointingHandCursor : Qt.ArrowCursor
                        onClicked: { if (compatible && hwProfile && modelData) hwProfile.select_preset(backend, modelData.id) }
                    }
                }
            }
        }
    }
}
