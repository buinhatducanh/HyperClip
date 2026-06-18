// src/ui/qml/SystemCard.qml
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

SettingsCard {
    title: "HỆ THỐNG"

    ColumnLayout {
        Layout.fillWidth: true
        spacing: 16

        // Quick Stats Row
        RowLayout {
            Layout.fillWidth: true
            spacing: 12

            // GPU Card info
            Rectangle {
                Layout.fillWidth: true
                Layout.preferredHeight: 80
                color: Theme.inputBg
                border.color: Theme.border
                radius: Theme.radiusLg

                RowLayout {
                    anchors.fill: parent
                    anchors.margins: 12
                    spacing: 12

                    // Icon/Indicator
                    Rectangle {
                        width: 36
                        height: 36
                        radius: 18
                        color: Qt.rgba(0, 180, 255, 0.1)
                        Icon {
                            anchors.centerIn: parent
                            name: "settings"
                            size: 18
                            color: Theme.accent
                        }
                    }

                    ColumnLayout {
                        spacing: 2
                        Layout.fillWidth: true
                        Label {
                            text: "GPU Đồ họa"
                            color: Theme.textMuted
                            font.pixelSize: Theme.textSm
                            font.bold: true
                        }
                        Label {
                            text: statsModel ? statsModel.gpu_name : "—"
                            color: Theme.text
                            font.pixelSize: Theme.textMd
                            font.bold: true
                            elide: Text.ElideRight
                            Layout.fillWidth: true
                        }
                    }
                }
            }

            // GPU Tier Card
            Rectangle {
                Layout.fillWidth: true
                Layout.preferredHeight: 80
                color: Theme.inputBg
                border.color: Theme.border
                radius: Theme.radiusLg

                RowLayout {
                    anchors.fill: parent
                    anchors.margins: 12
                    spacing: 12

                    Rectangle {
                        width: 36
                        height: 36
                        radius: 18
                        color: statsModel && statsModel.gpu_tier === "high" ? Qt.rgba(0, 255, 136, 0.1) : Qt.rgba(0, 180, 255, 0.1)
                        Icon {
                            anchors.centerIn: parent
                            name: "render"
                            size: 18
                            color: statsModel && statsModel.gpu_tier === "high" ? Theme.success : Theme.accent
                        }
                    }

                    ColumnLayout {
                        spacing: 2
                        Layout.fillWidth: true
                        Label {
                            text: "Cấp VRAM"
                            color: Theme.textMuted
                            font.pixelSize: Theme.textSm
                            font.bold: true
                        }
                        Label {
                            text: statsModel ? statsModel.gpu_tier.toUpperCase() : "—"
                            color: statsModel && statsModel.gpu_tier === "high" ? Theme.success
                                 : statsModel && statsModel.gpu_tier === "mid" ? Theme.accent : Theme.textMuted
                            font.pixelSize: Theme.textMd
                            font.bold: true
                        }
                    }
                }
            }
        }

        // Stats grid
        GridLayout {
            columns: 4
            columnSpacing: 24
            rowSpacing: 12
            Layout.fillWidth: true

            Label { text: "Nhiệt độ GPU"; color: Theme.textMuted; font.pixelSize: Theme.textLg }
            Label {
                text: statsModel ? statsModel.gpu_temp + "°C" : "—"
                color: statsModel && statsModel.gpu_temp > 80 ? Theme.error : Theme.text
                font.pixelSize: Theme.textLg
                font.bold: true
            }

            Label { text: "Workers"; color: Theme.textMuted; font.pixelSize: Theme.textLg }
            Label {
                text: statsModel ? statsModel.active_workers + " / " + statsModel.max_workers : "—"
                color: Theme.text
                font.pixelSize: Theme.textLg
                font.bold: true
            }

            Label { text: "Bộ nhớ RAM"; color: Theme.textMuted; font.pixelSize: Theme.textLg }
            Label {
                text: statsModel ? statsModel.ram_label : "—"
                color: Theme.text
                font.pixelSize: Theme.textLg
                font.bold: true
                elide: Text.ElideRight
                Layout.fillWidth: true
            }

            Label { text: "Địa chỉ IP"; color: Theme.textMuted; font.pixelSize: Theme.textLg }
            Label {
                text: statsModel ? statsModel.network_ip : "—"
                color: Theme.text
                font.pixelSize: Theme.textLg
                font.bold: true
            }
        }
    }
}
