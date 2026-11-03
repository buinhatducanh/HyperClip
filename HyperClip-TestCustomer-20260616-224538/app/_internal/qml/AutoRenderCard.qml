// src/ui/qml/AutoRenderCard.qml
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

SettingsCard {
    title: "TỰ ĐỘNG RENDER"

    RowLayout {
        Layout.fillWidth: true
        spacing: Theme.spacingMd
        Label {
            text: "Tự động render"
            color: Theme.text
            font.pixelSize: Theme.textMd
            Layout.fillWidth: true
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
 
        ColumnLayout {
            spacing: 2
            Layout.fillWidth: true
            Label {
                text: "Độ phân giải"
                color: Theme.text
                font.pixelSize: Theme.textMd
                font.bold: true
            }
            Label {
                text: "Độ phân giải video dọc đầu ra (ví dụ 1080p, 720p)."
                color: Theme.textMuted
                font.pixelSize: 11
                wrapMode: Text.WordWrap
                Layout.fillWidth: true
            }
        }
        ComboBox {
            Layout.preferredWidth: 180
            Layout.alignment: Qt.AlignRight
            font.pixelSize: Theme.textMd
            model: ["1080p", "720p", "480p", "360p"]
            currentIndex: settings ? Math.max(0, model.indexOf(settings.autoRenderResolution)) : 0
            onActivated: if (settings) settings.autoRenderResolution = model[currentIndex]
        }
 
        ColumnLayout {
            spacing: 2
            Layout.fillWidth: true
            Label {
                text: "Khung hình (FPS)"
                color: Theme.text
                font.pixelSize: Theme.textMd
                font.bold: true
            }
            Label {
                text: "Tốc độ khung hình đầu ra (30 hoặc 60 fps)."
                color: Theme.textMuted
                font.pixelSize: 11
                wrapMode: Text.WordWrap
                Layout.fillWidth: true
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
 
        ColumnLayout {
            spacing: 2
            Layout.fillWidth: true
            Label {
                text: "Tốc độ phát (Speed)"
                color: Theme.text
                font.pixelSize: Theme.textMd
                font.bold: true
            }
            Label {
                text: "Tự động tăng tốc độ video (lách bản quyền và tăng độ cuốn)."
                color: Theme.textMuted
                font.pixelSize: 11
                wrapMode: Text.WordWrap
                Layout.fillWidth: true
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
 
        ColumnLayout {
            spacing: 2
            Layout.fillWidth: true
            Label {
                text: "Tự động tách video"
                color: Theme.text
                font.pixelSize: Theme.textMd
                font.bold: true
            }
            Label {
                text: "Part 1 tải + render xong trước với toàn bộ tài nguyên, sau đó tự tải tiếp và render lần lượt part 2, part 3 (tối đa 3 phần)."
                color: Theme.textMuted
                font.pixelSize: 11
                wrapMode: Text.WordWrap
                Layout.fillWidth: true
            }
        }
        Switch {
            Layout.alignment: Qt.AlignRight
            checked: settings ? settings.autoSplitEnabled : false
            onToggled: {
                if (!settings) return
                settings.autoSplitEnabled = checked
                // Ghi ngược giá trị sàn ngay khi bật — SpinBox chỉ hiển thị
                // clamp chứ không tự lưu, để nguyên parts=1/minutes=0 là
                // split không bao giờ chạy.
                if (checked) {
                    if (settings.autoSplitParts < 2) settings.autoSplitParts = 2
                    if (settings.autoSplitMinutes < 1) settings.autoSplitMinutes = 5
                }
            }
        }

        ColumnLayout {
            visible: settings ? settings.autoSplitEnabled : false
            spacing: 2
            Layout.fillWidth: true
            Label {
                text: "Chế độ tách"
                color: Theme.text
                font.pixelSize: Theme.textMd
                font.bold: true
            }
            Label {
                text: "Tách theo số lượng phần cố định hoặc theo số phút mỗi phần."
                color: Theme.textMuted
                font.pixelSize: 11
                wrapMode: Text.WordWrap
                Layout.fillWidth: true
            }
        }
        ComboBox {
            visible: settings ? settings.autoSplitEnabled : false
            Layout.preferredWidth: 180
            Layout.alignment: Qt.AlignRight
            font.pixelSize: Theme.textMd
            model: ["Tách theo số phần", "Tách theo thời lượng (phút)"]
            currentIndex: settings ? (settings.autoSplitMode === "minutes" ? 1 : 0) : 0
            onActivated: if (settings) settings.autoSplitMode = currentIndex === 1 ? "minutes" : "parts"
        }

        ColumnLayout {
            visible: settings ? (settings.autoSplitEnabled && settings.autoSplitMode === "parts") : false
            spacing: 2
            Layout.fillWidth: true
            Label {
                text: "Số phần tách"
                color: Theme.text
                font.pixelSize: Theme.textMd
                font.bold: true
            }
            Label {
                text: "Cắt video gốc thành N phần bằng nhau (tối đa 3 phần)."
                color: Theme.textMuted
                font.pixelSize: 11
                wrapMode: Text.WordWrap
                Layout.fillWidth: true
            }
        }
        SpinBox {
            visible: settings ? (settings.autoSplitEnabled && settings.autoSplitMode === "parts") : false
            Layout.preferredWidth: 180
            Layout.alignment: Qt.AlignRight
            font.pixelSize: Theme.textMd
            from: 2; to: 3
            value: settings ? settings.autoSplitParts : 2
            editable: true
            onValueModified: if (settings) settings.autoSplitParts = value
            onActiveFocusChanged: {
                if (!activeFocus) {
                    var val = valueFromText(contentItem.text, locale)
                    val = Math.max(from, Math.min(to, val))
                    value = val
                    if (settings) settings.autoSplitParts = val
                }
            }
        }

        ColumnLayout {
            visible: settings ? (settings.autoSplitEnabled && settings.autoSplitMode === "minutes") : false
            spacing: 2
            Layout.fillWidth: true
            Label {
                text: "Số phút / phần"
                color: Theme.text
                font.pixelSize: Theme.textMd
                font.bold: true
            }
            Label {
                text: "Mỗi phần dài N phút — part 1 chỉ tải N phút đầu để render nhanh nhất; ví dụ video 8:34 cắt 5p → part 1 = 5:00, part 2 = 3:34."
                color: Theme.textMuted
                font.pixelSize: 11
                wrapMode: Text.WordWrap
                Layout.fillWidth: true
            }
        }
        SpinBox {
            visible: settings ? (settings.autoSplitEnabled && settings.autoSplitMode === "minutes") : false
            Layout.preferredWidth: 180
            Layout.alignment: Qt.AlignRight
            font.pixelSize: Theme.textMd
            from: 1; to: 120
            value: settings ? settings.autoSplitMinutes : 5
            editable: true
            onValueModified: if (settings) settings.autoSplitMinutes = value
            onActiveFocusChanged: {
                if (!activeFocus) {
                    var val = valueFromText(contentItem.text, locale)
                    val = Math.max(from, Math.min(to, val))
                    value = val
                    if (settings) settings.autoSplitMinutes = val
                }
            }
        }
 
        ColumnLayout {
            spacing: 2
            Layout.fillWidth: true
            Label {
                // Pass 85: nhãn cũ "Mẫu đặt tên file" nói SAI việc ô này làm —
                // backend nướng chuỗi này vào THANH DƯỚI của video (drawtext),
                // không đặt tên file. Khách 15/08 thấy "có chữ trong video" mà
                // không biết chữ đến từ đâu, và không có chỗ nào tắt.
                text: "Chữ trên thanh dưới video"
                color: Theme.text
                font.pixelSize: Theme.textMd
                font.bold: true
            }
            Label {
                text: "Nướng vào khung dưới của video dọc (thẻ {title}, {channel}, {part}). Tắt công tắc để thanh dưới chỉ còn nền, không chữ."
                color: Theme.textMuted
                font.pixelSize: 11
                wrapMode: Text.WordWrap
                Layout.fillWidth: true
            }
        }
        RowLayout {
            spacing: 8
            Layout.alignment: Qt.AlignRight
            Switch {
                id: overlaySwitch
                checked: (settings && typeof settings.renderTitleOverlay !== "undefined") ? Boolean(settings.renderTitleOverlay) : true
                onToggled: if (settings) settings.renderTitleOverlay = checked
                ToolTip.text: checked ? "Đang nướng chữ vào video. Bấm để tắt." : "Đang TẮT chữ — thanh dưới chỉ còn nền."
                ToolTip.visible: hovered
                ToolTip.delay: 400
            }
            TextField {
                Layout.preferredWidth: 180
                enabled: overlaySwitch.checked
                opacity: enabled ? 1.0 : 0.45
                font.pixelSize: Theme.textMd
                color: Theme.text
                placeholderTextColor: Theme.textMuted
                text: settings ? settings.autoRenderTitleTemplate : ""
                onEditingFinished: if (settings) settings.autoRenderTitleTemplate = text
                background: Rectangle {
                    color: Theme.inputBg
                    border.color: parent.activeFocus ? Theme.accent : Theme.border
                    border.width: 1
                    radius: Theme.radiusMd
                }
            }
        }
 
        ColumnLayout {
            spacing: 2
            Layout.fillWidth: true
            Label {
                text: "Render song song"
                color: Theme.text
                font.pixelSize: Theme.textMd
                font.bold: true
            }
            Label {
                text: "Số lượng tiến trình render FFmpeg chạy đồng thời (khuyên dùng 2)."
                color: Theme.textMuted
                font.pixelSize: 11
                wrapMode: Text.WordWrap
                Layout.fillWidth: true
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

        // Pass 119 — HAI NÚM E2E TRƯỚC ĐÂY CHỈ CÓ Ở CARD SHORTS.
        //
        // Pass 105 đưa `renderMaxrateMbps` + `tiktokFastDone` ra UI, nhưng đặt
        // trong ShortsSettingsCard. Từ Pass 104 trang Cài đặt chỉ hiện card của
        // LÀN ĐANG BẬT, nên máy chạy làn Video dài (Shorts=TẮT) KHÔNG BAO GIỜ
        // bấm tới được hai núm này — đúng cái bẫy mà Pass 105 sinh ra để chữa:
        // thứ gì ảnh hưởng e2e phải có trong UI, và "có trong UI" nghĩa là có ở
        // làn mà máy đó đang chạy.
        ColumnLayout {
            spacing: 2
            Layout.fillWidth: true
            Label {
                text: "Trần bitrate render (Mbps)"
                color: Theme.text; font.pixelSize: Theme.textMd; font.bold: true
            }
            Label {
                text: "0 = tự động theo card. Với part video dài, đây là đòn bẩy ĐO ĐƯỢC: "
                      + "file 120 MB thì TikTok xử lý 2,9s, còn 57–91 MB chỉ 1,1–2,0s. "
                      + "Đặt 3 rồi XEM THỬ video đầu — TikTok vốn nén lại còn ~1 Mbps. "
                      + "Nấc 1 dành cho khi cần ép giây tối đa: PHẢI xem thử bằng mắt trước, "
                      + "720p ở 1 Mbps dễ lộ khối ở cảnh chuyển động."
                color: Theme.textMuted; font.pixelSize: 11
                wrapMode: Text.WordWrap; Layout.fillWidth: true
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

        ColumnLayout {
            spacing: 2
            Layout.fillWidth: true
            Label {
                text: "Đăng TikTok: xong ngay khi gửi lệnh đăng"
                color: Theme.text; font.pixelSize: Theme.textMd; font.bold: true
            }
            Label {
                text: "Không chờ TikTok chuyển trang xác nhận. Đo trên máy khách: chặng "
                      + "xác nhận 1,5–2,1s xuống còn 0,5–0,7s. Đánh đổi: nếu TikTok hỏng "
                      + "SAU cú bấm Đăng thì app đã báo xong — log ghi rõ \"fastDone\"."
                color: Theme.textMuted; font.pixelSize: 11
                wrapMode: Text.WordWrap; Layout.fillWidth: true
            }
        }
        Switch {
            Layout.alignment: Qt.AlignRight
            checked: (settings && typeof settings.tiktokFastDone !== "undefined") ? Boolean(settings.tiktokFastDone) : true
            onToggled: if (settings) settings.tiktokFastDone = checked
        }
    }
}
