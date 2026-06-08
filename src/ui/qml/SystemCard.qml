// src/ui/qml/SystemCard.qml
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

SettingsCard {
    title: "HỆ THỐNG"
    Layout.preferredHeight: 200

    ColumnLayout {
        width: parent.width
        spacing: 8

        GridLayout {
            columns: 4
            columnSpacing: 24
            rowSpacing: 8
            Layout.fillWidth: true

            Label { text: "GPU"; color: Theme.textMuted; font.pixelSize: 11 }
            Label { text: statsModel.gpu_name; color: Theme.text; font.pixelSize: 11; Layout.fillWidth: true }
            Label { text: "Cấp VRAM"; color: Theme.textMuted; font.pixelSize: 11 }
            Label {
                text: statsModel.gpu_tier
                color: statsModel.gpu_tier === "high" ? Theme.success
                     : statsModel.gpu_tier === "mid" ? Theme.accent : Theme.textMuted
                font.pixelSize: 11
                font.bold: true
            }

            Label { text: "Nhiệt độ"; color: Theme.textMuted; font.pixelSize: 11 }
            Label {
                text: statsModel.gpu_temp + "°C"
                color: statsModel.gpu_temp > 80 ? Theme.error : Theme.text
                font.pixelSize: 11
            }
            Label { text: "Workers"; color: Theme.textMuted; font.pixelSize: 11 }
            Label {
                text: statsModel.active_workers + " / " + statsModel.max_workers
                color: Theme.text
                font.pixelSize: 11
            }

            Label { text: "RAM"; color: Theme.textMuted; font.pixelSize: 11 }
            Label { text: statsModel.ram_label; color: Theme.text; font.pixelSize: 11; Layout.fillWidth: true }
            Label { text: "IP"; color: Theme.textMuted; font.pixelSize: 11 }
            Label { text: statsModel.network_ip; color: Theme.text; font.pixelSize: 11 }
        }
    }
}
