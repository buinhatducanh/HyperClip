// src/ui/qml/HardwareProfileCard.qml
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Rectangle {
    color: Theme.bg
    border.color: Theme.border
    border.width: 1
    Layout.preferredHeight: 200

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 12
        spacing: 8

        RowLayout {
            Layout.fillWidth: true
            Label {
                text: "HARDWARE PROFILE"
                color: Theme.accent
                font.pixelSize: 13
                font.bold: true
                Layout.fillWidth: true
            }
            Label {
                text: hwProfile.activeLabel
                color: hwProfile.activeId ? Theme.success : Theme.textMuted
                font.pixelSize: 12
                font.bold: true
            }
        }

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
                    Layout.fillWidth: true
                    Layout.preferredHeight: 56
                    color: modelData.id === hwProfile.activeId ? "#1F2A33" : "#1A1A1A"
                    border.color: modelData.id === hwProfile.activeId ? Theme.accent : Theme.border
                    border.width: 1

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
                        cursorShape: Qt.PointingHandCursor
                        onClicked: hwProfile.select_preset(backend, modelData.id)
                    }
                }
            }
        }
    }
}
