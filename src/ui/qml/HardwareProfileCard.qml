// src/ui/qml/HardwareProfileCard.qml
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

SettingsCard {
    title: "HARDWARE PROFILE"
    Layout.preferredHeight: 200

    ColumnLayout {
        width: parent.width
        spacing: 8

        Label {
            text: "Detected: " + hwProfile.detectedGpuName + " · " + hwProfile.detectedVramGb + "GB VRAM · " + hwProfile.detectedRamGb + "GB RAM"
            color: Theme.textMuted
            font.pixelSize: 10
        }

        GridLayout {
            Layout.fillWidth: true
            columns: 5
            rowSpacing: 6
            columnSpacing: 6

            Repeater {
                model: hwProfile.presets()
                delegate: Rectangle {
                    property bool compatible: modelData.vramGB <= hwProfile.detectedVramGb
                    Layout.fillWidth: true
                    Layout.preferredHeight: 56
                    color: modelData.id === hwProfile.activeId ? Theme.hoverBg : Theme.cardBg
                    border.color: modelData.id === hwProfile.activeId ? Theme.accent : Theme.border
                    border.width: 1
                    opacity: compatible ? 1.0 : 0.4

                    ColumnLayout {
                        anchors.fill: parent
                        anchors.margins: 4
                        Label {
                            text: modelData.label
                            color: modelData.id === hwProfile.activeId ? Theme.accent : Theme.text
                            font.pixelSize: 11
                            font.bold: true
                        }
                        Label {
                            text: modelData.vramGB + "GB · " + modelData.ramGB + "GB"
                            color: Theme.textMuted
                            font.pixelSize: 9
                        }
                        Label {
                            text: modelData.sessions + " sess · " + modelData.chunkWorkers + " wk"
                            color: Theme.textMuted
                            font.pixelSize: 8
                        }
                    }
                    MouseArea {
                        anchors.fill: parent
                        cursorShape: compatible ? Qt.PointingHandCursor : Qt.ArrowCursor
                        onClicked: {
                            if (compatible) {
                                hwProfile.select_preset(backend, modelData.id)
                            }
                        }
                    }
                }
            }
        }
    }
}
