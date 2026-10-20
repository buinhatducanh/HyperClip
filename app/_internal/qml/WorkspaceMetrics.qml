// src/ui/qml/WorkspaceMetrics.qml
// Read-only metrics: DOWNLOAD METRICS / RENDER METRICS / SYSTEM
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

ColumnLayout {
    id: root
    property var workspaceData: ({})
    spacing: 8

    // Đọc qua slot model — QML không được biết số role (Qt.UserRole + N):
    // bản cũ hard-code +1/+2/+3/+8/+16, đổi thứ tự role trong Python là vỡ câm.
    function getSplitPartsFor(parentId) {
        if (!parentId) return [];
        return workspaceModel.split_parts_of(parentId)
    }

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
            Label { text: "FPS (thực tế)"; color: Theme.textMuted; font.pixelSize: Theme.textXs }
            Label { text: workspaceData.renderFps ? workspaceData.renderFps.toFixed(1) + " fps" : "—"; color: Theme.text; font.pixelSize: Theme.textXs; font.family: "monospace" }
            Label { text: "Workers"; color: Theme.textMuted; font.pixelSize: Theme.textXs }
            Label { text: workspaceData.renderWorkers ? "" + workspaceData.renderWorkers : "—"; color: Theme.text; font.pixelSize: Theme.textXs; font.family: "monospace" }
            Label { text: "Preset"; color: Theme.textMuted; font.pixelSize: Theme.textXs }
            Label { text: workspaceData.renderPreset || "—"; color: Theme.text; font.pixelSize: Theme.textXs; font.family: "monospace" }
            Label { text: "Codec"; color: Theme.textMuted; font.pixelSize: Theme.textXs }
            Label { text: workspaceData.renderCodec || "—"; color: Theme.text; font.pixelSize: Theme.textXs; font.family: "monospace" }
            Label {
                text: "Đầu ra"
                color: Theme.textMuted
                font.pixelSize: Theme.textXs
                visible: root.getSplitPartsFor(workspaceData.id).length === 0
            }
            Label {
                text: {
                    if (workspaceData.status === "error" || workspaceData.status === "failed") {
                        return "— (Lỗi: " + (workspaceData.error || "Không rõ nguyên nhân") + ")";
                    }
                    return (workspaceData.renderedPath || workspaceData.outputPath || "—");
                }
                color: (workspaceData.status === "error" || workspaceData.status === "failed")
                    ? Theme.error
                    : ((workspaceData.renderedPath || workspaceData.outputPath) ? Theme.accent : Theme.text)
                font.pixelSize: Theme.textXs
                font.family: "monospace"
                font.underline: !!(workspaceData.renderedPath || workspaceData.outputPath) && workspaceData.status !== "error" && workspaceData.status !== "failed"
                elide: Text.ElideMiddle
                Layout.fillWidth: true
                visible: root.getSplitPartsFor(workspaceData.id).length === 0

                MouseArea {
                    anchors.fill: parent
                    enabled: !!(workspaceData.renderedPath || workspaceData.outputPath) && workspaceData.status !== "error" && workspaceData.status !== "failed"
                    cursorShape: Qt.PointingHandCursor
                    onClicked: {
                        var p = workspaceData.renderedPath || workspaceData.outputPath;
                        if (p) {
                            backend.send_command_async("system:openFolder", {"path": p})
                        }
                    }
                }
            }

            // Split parts layout
            ColumnLayout {
                Layout.columnSpan: 2
                Layout.fillWidth: true
                spacing: 4
                visible: root.getSplitPartsFor(workspaceData.id).length > 0

                Repeater {
                    model: root.getSplitPartsFor(workspaceData.id)
                    delegate: RowLayout {
                        Layout.fillWidth: true
                        spacing: 8
                        Label {
                            text: "Đầu ra (" + (modelData.title || modelData.id) + ")"
                            color: Theme.textMuted
                            font.pixelSize: Theme.textXs
                            Layout.preferredWidth: 120
                            elide: Text.ElideRight
                        }
                        Label {
                            text: {
                                if (modelData.status === "error" || modelData.status === "failed" || (modelData.error && modelData.error !== "")) {
                                    return "— (Lỗi: " + (modelData.error || "Không rõ nguyên nhân") + ")";
                                }
                                return modelData.renderedPath || "— (đang render...)";
                            }
                            color: (modelData.status === "error" || modelData.status === "failed" || (modelData.error && modelData.error !== ""))
                                ? Theme.error
                                : (modelData.renderedPath ? Theme.accent : Theme.textMuted)
                            font.pixelSize: Theme.textXs
                            font.family: "monospace"
                            font.underline: !!modelData.renderedPath && modelData.status !== "error" && modelData.status !== "failed"
                            elide: Text.ElideMiddle
                            Layout.fillWidth: true

                            MouseArea {
                                anchors.fill: parent
                                enabled: !!modelData.renderedPath && modelData.status !== "error" && modelData.status !== "failed"
                                cursorShape: Qt.PointingHandCursor
                                onClicked: {
                                    if (modelData.renderedPath) {
                                        backend.send_command_async("system:openFolder", {"path": modelData.renderedPath})
                                    }
                                }
                            }
                        }
                    }
                }
            }
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
