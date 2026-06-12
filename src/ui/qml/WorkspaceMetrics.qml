// src/ui/qml/WorkspaceMetrics.qml
// Read-only metrics: DOWNLOAD METRICS / RENDER METRICS / SYSTEM
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

ColumnLayout {
    id: root
    property var workspaceData: ({})
    spacing: 8

    // Download section
    GroupBox {
        Layout.fillWidth: true
        title: "TẢI XUỐNG"
        background: Rectangle { color: Theme.bg; border.color: Theme.border; border.width: 1 }
        label: Label { text: parent.title; color: Theme.accent; font.pixelSize: Theme.textSm; font.bold: true }

        GridLayout {
            columns: 2; columnSpacing: 16; rowSpacing: 4; anchors.fill: parent
            Label { text: "Thời gian"; color: Theme.textMuted; font.pixelSize: Theme.textXs }
            Label { text: workspaceData.downloadTime || "—"; color: Theme.text; font.pixelSize: Theme.textXs; font.family: "monospace" }
            Label { text: "Tốc độ"; color: Theme.textMuted; font.pixelSize: Theme.textXs }
            Label { text: workspaceData.downloadSpeed || "—"; color: Theme.text; font.pixelSize: Theme.textXs; font.family: "monospace" }
            Label { text: "Dung lượng"; color: Theme.textMuted; font.pixelSize: Theme.textXs }
            Label { text: workspaceData.fileSizeStr || workspaceData.fileSize || "—"; color: Theme.text; font.pixelSize: Theme.textXs; font.family: "monospace" }
            Label { text: "Chất lượng"; color: Theme.textMuted; font.pixelSize: Theme.textXs }
            Label { text: (workspaceData.quality || 1080) + "p"; color: Theme.text; font.pixelSize: Theme.textXs; font.family: "monospace" }
            Label { text: "Nguồn"; color: Theme.textMuted; font.pixelSize: Theme.textXs }
            Label { text: workspaceData.source || "yt-dlp"; color: Theme.text; font.pixelSize: Theme.textXs; font.family: "monospace" }
        }
    }

    // Render section
    GroupBox {
        Layout.fillWidth: true
        title: "RENDER"
        background: Rectangle { color: Theme.bg; border.color: Theme.border; border.width: 1 }
        label: Label { text: parent.title; color: Theme.accent; font.pixelSize: Theme.textSm; font.bold: true }

        GridLayout {
            columns: 2; columnSpacing: 16; rowSpacing: 4; anchors.fill: parent
            Label { text: "FPS"; color: Theme.textMuted; font.pixelSize: Theme.textXs }
            Label { text: (workspaceData.renderFps || 0).toFixed(1); color: Theme.text; font.pixelSize: Theme.textXs; font.family: "monospace" }
            Label { text: "Workers"; color: Theme.textMuted; font.pixelSize: Theme.textXs }
            Label { text: workspaceData.renderWorkers || 1; color: Theme.text; font.pixelSize: Theme.textXs; font.family: "monospace" }
            Label { text: "Preset"; color: Theme.textMuted; font.pixelSize: Theme.textXs }
            Label { text: workspaceData.renderPreset || "p1"; color: Theme.text; font.pixelSize: Theme.textXs; font.family: "monospace" }
            Label { text: "Codec"; color: Theme.textMuted; font.pixelSize: Theme.textXs }
            Label { text: workspaceData.renderCodec || "hevc_nvenc"; color: Theme.text; font.pixelSize: Theme.textXs; font.family: "monospace" }
            Label { text: "Đầu ra"; color: Theme.textMuted; font.pixelSize: Theme.textXs }
            Label { text: workspaceData.outputPath || "—"; color: Theme.text; font.pixelSize: Theme.textXs; font.family: "monospace"; elide: Text.ElideMiddle; Layout.fillWidth: true }
        }
    }

    // System section
    GroupBox {
        Layout.fillWidth: true
        title: "HỆ THỐNG"
        background: Rectangle { color: Theme.bg; border.color: Theme.border; border.width: 1 }
        label: Label { text: parent.title; color: Theme.accent; font.pixelSize: Theme.textSm; font.bold: true }

        GridLayout {
            columns: 2; columnSpacing: 16; rowSpacing: 4; anchors.fill: parent
            Label { text: "GPU"; color: Theme.textMuted; font.pixelSize: Theme.textXs }
            Label { text: statsModel.gpu_name; color: Theme.text; font.pixelSize: Theme.textXs; font.family: "monospace" }
            Label { text: "VRAM"; color: Theme.textMuted; font.pixelSize: Theme.textXs }
            Label { text: statsModel.ram_label; color: Theme.text; font.pixelSize: Theme.textXs; font.family: "monospace" }
            Label { text: "Workers"; color: Theme.textMuted; font.pixelSize: Theme.textXs }
            Label { text: statsModel.active_workers + " / " + statsModel.max_workers; color: Theme.text; font.pixelSize: Theme.textXs; font.family: "monospace" }
        }
    }
}
