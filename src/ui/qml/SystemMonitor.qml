// src/ui/qml/SystemMonitor.qml
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
        spacing: 2

        Label {
            text: "GPU: " + (statsModel.gpu_name || "—")
            color: statsModel.gpu_tier === "high" ? Theme.success
                 : statsModel.gpu_tier === "mid" ? Theme.accent
                 : Theme.textMuted
            font.pixelSize: 10
        }

        Label {
            text: "Temp: " + statsModel.gpu_temp + "°C"
            color: statsModel.gpu_temp > 80 ? Theme.error : Theme.textMuted
            font.pixelSize: 10
        }

        Label {
            text: "RAM: " + statsModel.ram_label
            color: Theme.textMuted
            font.pixelSize: 10
        }

        Label {
            text: "Workers: " + statsModel.active_workers + "/" + statsModel.max_workers
            color: Theme.textMuted
            font.pixelSize: 10
        }

        Label {
            text: "Online: " + (statsModel.is_online ? "✓" : "✗")
            color: statsModel.is_online ? Theme.success : Theme.error
            font.pixelSize: 10
        }

        Label {
            text: "IP: " + statsModel.network_ip
            color: Theme.textMuted
            font.pixelSize: 9
        }
    }
}
