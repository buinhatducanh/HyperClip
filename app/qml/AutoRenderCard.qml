// src/ui/qml/AutoRenderCard.qml
// Card tùy chọn render nâng cao (FPS, Speed, Bitrate, Render song song)
// Các mục trùng (Độ phân giải, Chia Part, Mẫu tiêu đề, TikTok FastDone) đã gom vào QuickPipelineCard
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls
import QtQuick.Dialogs

SettingsCard {
    title: "TÙY CHỌN RENDER NÂNG CAO"

    RowLayout {
        Layout.fillWidth: true
        spacing: Theme.spacingMd
        Label {
            text: "Tự động render"
            color: Theme.text
            font.pixelSize: Theme.textMd
            font.bold: true
            Layout.fillWidth: true
        }
        HelpTip {
            text: "Tự động gửi video vào hàng đợi render ngay sau khi tải xong theo mẫu đã định."
        }
        Switch {
            checked: settings ? settings.autoRender : true
            onToggled: if (settings) settings.autoRender = checked
        }
    }

    GridLayout {
        columns: 2
        columnSpacing: Theme.spacingLg
        rowSpacing: Theme.spacingMd
        Layout.fillWidth: true

        // ─── KHUNG HÌNH (FPS) ─────────────────────────────────────────
        RowLayout {
            spacing: 6
            Layout.fillWidth: true
            Label {
                text: "Khung hình (FPS)"
                color: Theme.text
                font.pixelSize: Theme.textMd
                font.bold: true
            }
            HelpTip {
                text: "Tốc độ khung hình đầu ra của video (30 hoặc 60 fps). 60fps mượt mà hơn nhưng tốn thêm GPU/CPU."
            }
        }
        ComboBox {
            Layout.preferredWidth: 180
            Layout.alignment: Qt.AlignRight
            font.pixelSize: Theme.textMd
            model: [30, 60]
            currentIndex: settings ? Math.max(0, [30, 60].indexOf(settings.autoRenderFPS)) : 0
            onActivated: if (settings) settings.autoRenderFPS = model[currentIndex]
        }

        // ─── TỐC ĐỘ PHÁT (SPEED) ──────────────────────────────────────
        RowLayout {
            spacing: 6
            Layout.fillWidth: true
            Label {
                text: "Tốc độ phát (Speed)"
                color: Theme.text
                font.pixelSize: Theme.textMd
                font.bold: true
            }
            HelpTip {
                text: "Tăng nhẹ tốc độ video (1.0x - 2.0x) để lách nhận diện bản quyền âm thanh/hình ảnh và tăng độ cuốn người xem."
            }
        }
        RowLayout {
            Layout.preferredWidth: 180
            Layout.alignment: Qt.AlignRight
            spacing: Theme.spacingSm
            Slider {
                Layout.fillWidth: true
                from: 1.0; to: 2.0; stepSize: 0.1
                value: settings ? settings.autoRenderSpeed : 1.0
                onValueChanged: if (settings) settings.autoRenderSpeed = value
            }
            Label {
                text: (settings ? settings.autoRenderSpeed : 1.0).toFixed(1) + "x"
                color: Theme.text
                font.pixelSize: Theme.textMd
                Layout.preferredWidth: 32
            }
        }

        // ─── RENDER SONG SONG ─────────────────────────────────────────
        RowLayout {
            spacing: 6
            Layout.fillWidth: true
            Label {
                text: "Render song song"
                color: Theme.text
                font.pixelSize: Theme.textMd
                font.bold: true
            }
            HelpTip {
                text: "Số lượng tiến trình render FFmpeg chạy đồng thời (khuyên dùng 2 trên CPU 6+ nhân)."
            }
        }
        SpinBox {
            Layout.preferredWidth: 180
            Layout.alignment: Qt.AlignRight
            font.pixelSize: Theme.textMd
            from: 1; to: 16
            value: settings ? settings.maxConcurrentRenders : 2
            editable: true
            onValueModified: if (settings) settings.maxConcurrentRenders = value
            onActiveFocusChanged: {
                if (!activeFocus) {
                    var val = valueFromText(contentItem.text, locale)
                    val = Math.max(from, Math.min(to, val))
                    value = val
                    if (settings) settings.maxConcurrentRenders = val
                }
            }
        }

        // ─── TRẦN BITRATE RENDER (MBPS) ───────────────────────────────
        RowLayout {
            spacing: 6
            Layout.fillWidth: true
            Label {
                text: "Trần bitrate render (Mbps)"
                color: Theme.text
                font.pixelSize: Theme.textMd
                font.bold: true
            }
            HelpTip {
                text: "0 = tự động theo card đồ họa. Đặt 3-4 Mbps giúp giảm dung lượng file xuống 50MB, đẩy nhanh tốc độ tải và đăng TikTok chỉ mất 1-2 giây."
            }
        }
        SpinBox {
            Layout.preferredWidth: 180
            Layout.alignment: Qt.AlignRight
            font.pixelSize: Theme.textMd
            from: 0; to: 12; stepSize: 1
            editable: true
            value: settings ? settings.renderMaxrateMbps : 0
            onValueModified: if (settings) settings.renderMaxrateMbps = value
            onActiveFocusChanged: {
                if (!activeFocus) {
                    var v = Math.max(from, Math.min(to, valueFromText(contentItem.text, locale)))
                    value = v
                    if (settings) settings.renderMaxrateMbps = v
                }
            }
        }

        // ─── ẢNH NỀN CANVAS (2 QUY TẮC) ─────────────────────────────
        RowLayout {
            spacing: 6
            Layout.fillWidth: true
            Label {
                text: "Ảnh nền Canvas (100%)"
                color: Theme.text
                font.pixelSize: Theme.textMd
                font.bold: true
            }
            HelpTip {
                text: "2 Quy tắc nền Canvas:\n1. Mặc định: Tự động lấy Thumbnail của chính video đó phủ kín 100% canvas.\n2. Tùy chọn: Chọn file ảnh riêng (.jpg/.png) từ máy tính."
            }
        }
        RowLayout {
            Layout.preferredWidth: 260
            Layout.alignment: Qt.AlignRight
            spacing: 6

            Rectangle {
                id: autoBgThumbBtn
                width: autoBgThumbLbl.implicitWidth + 12
                height: 24
                radius: 3
                readonly property bool isSel: !settings || !settings.canvasBackgroundMode || settings.canvasBackgroundMode === "thumbnail"
                color: isSel ? Theme.accent : Theme.surface
                border.color: isSel ? Theme.accent : Theme.border
                border.width: 1
                Label {
                    id: autoBgThumbLbl
                    anchors.centerIn: parent
                    text: "🖼️ 1. Thumbnail"
                    font.pixelSize: 10
                    font.bold: autoBgThumbBtn.isSel
                    color: autoBgThumbBtn.isSel ? "#000" : Theme.text
                }
                MouseArea {
                    anchors.fill: parent
                    cursorShape: Qt.PointingHandCursor
                    onClicked: {
                        if (settings) settings.canvasBackgroundMode = "thumbnail"
                        if (typeof backend !== "undefined" && backend) {
                            try {
                                backend.send_command_async("settings:update", {
                                    "canvasBackgroundMode": "thumbnail"
                                });
                            } catch(e) {}
                        }
                    }
                }
            }

            Rectangle {
                id: autoBgCustomBtn
                width: autoBgCustomLbl.implicitWidth + 12
                height: 24
                radius: 3
                readonly property bool isSel: settings && settings.canvasBackgroundMode === "custom"
                color: isSel ? Theme.accent : Theme.surface
                border.color: isSel ? Theme.accent : Theme.border
                border.width: 1
                Label {
                    id: autoBgCustomLbl
                    anchors.centerIn: parent
                    text: "📁 2. Ảnh riêng"
                    font.pixelSize: 10
                    font.bold: autoBgCustomBtn.isSel
                    color: autoBgCustomBtn.isSel ? "#000" : Theme.text
                }
                MouseArea {
                    anchors.fill: parent
                    cursorShape: Qt.PointingHandCursor
                    onClicked: autoBgFileDialog.open()
                }
            }
        }
    }

    FileDialog {
        id: autoBgFileDialog
        title: "Chọn ảnh nền Canvas (Background)"
        nameFilters: ["Ảnh (*.jpg *.png *.jpeg)"]
        onAccepted: {
            var rawPath = selectedFile.toString().replace("file:///", "");
            if (rawPath.indexOf(":") === -1 && rawPath.charAt(0) === "/") {
                rawPath = rawPath.substring(1);
            }
            if (settings) {
                settings.canvasBackgroundMode = "custom";
                settings.customBgPath = rawPath;
            }
            if (typeof backend !== "undefined" && backend) {
                try {
                    backend.send_command_async("settings:update", {
                        "canvasBackgroundMode": "custom",
                        "customBgPath": rawPath
                    });
                } catch(e) {}
            }
        }
    }
}
