// src/ui/qml/SystemMonitor.qml
// Compact system stats with premium card-style layout and high-DPI scaling resilience.
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Rectangle {
    id: systemMonitorRoot
    color: Theme.cardBg
    border.color: Theme.border
    border.width: 1
    radius: Theme.radiusLg
    implicitWidth: 200
    implicitHeight: mainLayout.implicitHeight + 20 // Margins account for top and bottom spacing

    gradient: Gradient {
        GradientStop { position: 0.0; color: Theme.cardBg }
        GradientStop { position: 1.0; color: "#161616" }
    }

    ColumnLayout {
        id: mainLayout
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        anchors.leftMargin: 10
        anchors.rightMargin: 10
        anchors.topMargin: 10
        spacing: 8

        // Header Row: Status and Section Title
        RowLayout {
            Layout.fillWidth: true
            spacing: 4

            Icon {
                name: "settings"
                size: 11
                color: Theme.accent
            }

            Label {
                text: "HỆ THỐNG"
                color: Theme.textMuted
                font.pixelSize: Theme.textXs
                font.bold: true
            }

            Item { Layout.fillWidth: true }

            RowLayout {
                spacing: 4
                Label {
                    text: (statsModel && statsModel.is_online) ? "ONLINE" : "OFFLINE"
                    color: (statsModel && statsModel.is_online) ? Theme.success : Theme.error
                    font.pixelSize: 8
                    font.bold: true
                }
                StatusDot {
                    state: (statsModel && statsModel.is_online) ? "running" : "error"
                    size: 6
                    showRing: false
                }
            }
        }

        // GPU Badge Card
        Rectangle {
            Layout.fillWidth: true
            height: 32
            color: Theme.inputBg
            border.color: Theme.border
            border.width: 1
            radius: Theme.radiusMd

            RowLayout {
                anchors.fill: parent
                anchors.leftMargin: 8
                anchors.rightMargin: 8
                spacing: 6

                Icon {
                    name: "render"
                    size: 11
                    color: (statsModel && statsModel.gpu_tier === "high") ? Theme.success
                         : (statsModel && statsModel.gpu_tier === "mid") ? Theme.accent
                         : Theme.textMuted
                }

                Label {
                    text: statsModel ? (statsModel.gpu_name || "—") : "—"
                    color: Theme.text
                    font.pixelSize: Theme.textSm
                    font.bold: true
                    elide: Text.ElideRight
                    Layout.fillWidth: true
                }
            }
        }

        // Stats Grid: Column 1 (Temp), Column 2 (Workers), Span (RAM), Span (IP)
        GridLayout {
            columns: 2
            Layout.fillWidth: true
            columnSpacing: 12
            rowSpacing: 6

            // Temp block
            ColumnLayout {
                spacing: 1
                Layout.fillWidth: true

                Label {
                    text: "NHIỆT ĐỘ"
                    color: Theme.textMuted
                    font.pixelSize: 8
                    font.bold: true
                }

                RowLayout {
                    spacing: 4
                    Layout.fillWidth: true

                    Icon {
                        name: "warning"
                        size: 10
                        color: (statsModel && statsModel.gpu_temp > 80) ? Theme.error : Theme.textMuted
                    }

                    Label {
                        text: (statsModel ? statsModel.gpu_temp : 0) + "°C"
                        color: (statsModel && statsModel.gpu_temp > 80) ? Theme.error : Theme.text
                        font.pixelSize: Theme.textSm
                        font.bold: true
                    }
                }
            }

            // Workers block
            ColumnLayout {
                spacing: 1
                Layout.fillWidth: true

                Label {
                    text: "WORKERS"
                    color: Theme.textMuted
                    font.pixelSize: 8
                    font.bold: true
                }

                RowLayout {
                    spacing: 4
                    Layout.fillWidth: true

                    Icon {
                        name: "info"
                        size: 10
                        color: Theme.textMuted
                    }

                    Label {
                        text: (statsModel ? statsModel.active_workers : 0) + "/" + (statsModel ? statsModel.max_workers : 0)
                        color: Theme.text
                        font.pixelSize: Theme.textSm
                        font.bold: true
                    }
                }
            }

            // RAM block (Spans both columns for length safety)
            ColumnLayout {
                spacing: 1
                Layout.fillWidth: true
                Layout.columnSpan: 2

                Label {
                    text: "BỘ NHỚ RAM"
                    color: Theme.textMuted
                    font.pixelSize: 8
                    font.bold: true
                }

                RowLayout {
                    spacing: 4
                    Layout.fillWidth: true

                    Icon {
                        name: "circle"
                        size: 8
                        color: Theme.accent
                    }

                    Label {
                        text: statsModel ? statsModel.ram_label : "—"
                        color: Theme.text
                        font.pixelSize: Theme.textSm
                        font.bold: true
                        elide: Text.ElideRight
                        Layout.fillWidth: true
                    }
                }
            }

            // Network IP block (Spans both columns for length safety)
            ColumnLayout {
                spacing: 1
                Layout.fillWidth: true
                Layout.columnSpan: 2

                Label {
                    text: "ĐỊA CHỈ IP"
                    color: Theme.textMuted
                    font.pixelSize: 8
                    font.bold: true
                }

                RowLayout {
                    spacing: 4
                    Layout.fillWidth: true

                    Icon {
                        name: "empty"
                        size: 8
                        color: Theme.textMuted
                    }

                    Label {
                        text: statsModel ? statsModel.network_ip : "—"
                        color: Theme.textMuted
                        font.pixelSize: Theme.textSm
                        font.family: "monospace"
                        elide: Text.ElideRight
                        Layout.fillWidth: true
                    }
                }
            }
        }
    }
}
