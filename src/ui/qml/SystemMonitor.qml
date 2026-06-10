// src/ui/qml/SystemMonitor.qml
// Compact system stats with consistent icons.
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Rectangle {
    color: Theme.bg
    border.color: Theme.border
    border.width: 1
    width: 200
    height: 130

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 6
        spacing: 3

        // Header
        RowLayout {
            spacing: 4
            Icon { name: "settings"; size: 11; color: Theme.textMuted }
            Label {
                text: "HỆ THỐNG"
                color: Theme.textMuted
                font.pixelSize: 10
                font.bold: true
            }
            Item { Layout.fillWidth: true }
            StatusDot {
                state: statsModel.is_online ? "running" : "error"
                size: 6
                showRing: false
            }
        }

        // GPU row
        RowLayout {
            spacing: 4
            Icon { name: "render"; size: 11; color: Theme.textMuted }
            Label {
                text: "GPU: " + (statsModel.gpu_name || "—")
                color: statsModel.gpu_tier === "high" ? Theme.success
                     : statsModel.gpu_tier === "mid" ? Theme.accent
                     : Theme.textMuted
                font.pixelSize: 12
                elide: Text.ElideRight
                Layout.fillWidth: true
            }
        }

        // Temp row
        RowLayout {
            spacing: 4
            Icon {
                name: "warning"
                size: 11
                color: statsModel.gpu_temp > 80 ? Theme.error : Theme.textMuted
            }
            Label {
                text: "Temp: " + statsModel.gpu_temp + "°C"
                color: statsModel.gpu_temp > 80 ? Theme.error : Theme.text
                font.pixelSize: 12
            }
        }

        // RAM row
        RowLayout {
            spacing: 4
            Icon { name: "circle"; size: 10; color: Theme.textMuted }
            Label {
                text: "RAM: " + statsModel.ram_label
                color: Theme.text
                font.pixelSize: 12
            }
        }

        // Workers row
        RowLayout {
            spacing: 4
            Icon { name: "info"; size: 11; color: Theme.textMuted }
            Label {
                text: "Workers: " + statsModel.active_workers + "/" + statsModel.max_workers
                color: Theme.text
                font.pixelSize: 12
            }
        }

        // IP row
        RowLayout {
            spacing: 4
            Icon { name: "circle"; size: 10; color: Theme.textMuted }
            Label {
                text: "IP: " + statsModel.network_ip
                color: Theme.textMuted
                font.pixelSize: 11
                font.family: "monospace"
                elide: Text.ElideRight
                Layout.fillWidth: true
            }
        }
    }
}
