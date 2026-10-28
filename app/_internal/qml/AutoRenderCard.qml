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
                checked: Boolean(settings && settings.renderTitleOverlay !== undefined ? settings.renderTitleOverlay : true)
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
        // Cài đặt chất lượng video (Tăng/giảm để đánh đổi tốc độ upload & render)
        ColumnLayout {
            spacing: 2
            Layout.fillWidth: true
            Label {
                text: "Chất lượng video & Tốc độ"
                color: Theme.text; font.pixelSize: Theme.textMd; font.bold: true
            }
            Label {
                text: "Tăng chất lượng để hình ảnh sắc nét, mượt mà hơn (đánh đổi tốc độ render và thời gian upload). "
                      + "Giảm chất lượng để tối ưu tốc độ nhanh nhất (upload TikTok chỉ ~2.5s)."
                color: Theme.textMuted; font.pixelSize: 11
                wrapMode: Text.WordWrap; Layout.fillWidth: true
            }
        }
        ComboBox {
            id: qualityPresetCombo
            Layout.preferredWidth: 180
            Layout.alignment: Qt.AlignRight
            font.pixelSize: Theme.textMd
            model: [
                "⚡ Tốc độ tối đa",
                "⚖️ Cân bằng (2M)",
                "✨ Chất lượng cao (4M)",
                "🔥 Cực nét (8M)",
                "🛠️ Tuỳ chỉnh"
            ]

            function getQualityIndex(rate) {
                var r = (rate !== undefined && rate !== null) ? Math.round(rate) : 0
                if (r <= 0) return 0
                if (r === 2) return 1
                if (r === 4) return 2
                if (r === 8) return 3
                return 4
            }

            currentIndex: getQualityIndex(settings ? settings.renderMaxrateMbps : 0)
            onActivated: function(index) {
                if (!settings) return
                if (index === 0) settings.renderMaxrateMbps = 0
                else if (index === 1) settings.renderMaxrateMbps = 2
                else if (index === 2) settings.renderMaxrateMbps = 4
                else if (index === 3) settings.renderMaxrateMbps = 8
                // Khôi phục binding chống vỡ binding khi tương tác qua lại (Fix BUG-02)
                currentIndex = Qt.binding(function() {
                    return getQualityIndex(settings ? settings.renderMaxrateMbps : 0)
                })
            }
        }

        ColumnLayout {
            spacing: 2
            Layout.fillWidth: true
            Label {
                text: "Trần bitrate render (Mbps)"
                color: Theme.text; font.pixelSize: Theme.textMd; font.bold: true
            }
            Label {
                text: "0 = Tốc độ tối đa (~320k). Đặt 1-12 Mbps để nâng chất lượng hình ảnh theo ý muốn."
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
            value: settings ? Math.round(settings.renderMaxrateMbps) : 0
            onValueModified: if (settings) settings.renderMaxrateMbps = value
            onActiveFocusChanged: {
                if (!activeFocus) {
                    var v = Math.max(from, Math.min(to, valueFromText(contentItem.text, locale)))
                    value = v
                    if (settings) settings.renderMaxrateMbps = v
                }
            }
        }

        // Cảnh báo không tương thích Bitrate & Resolution (Fix BUG-06)
        Rectangle {
            Layout.columnSpan: 2
            Layout.fillWidth: true
            visible: Boolean(settings && (settings.autoRenderResolution === "1080p") && (!settings.renderMaxrateMbps || settings.renderMaxrateMbps <= 0.05))
            radius: Theme.radiusMd
            color: Qt.rgba(0.96, 0.62, 0.04, 0.12)
            border.color: "#F59E0B"
            border.width: 1
            implicitHeight: warnRow.implicitHeight + 14

            RowLayout {
                id: warnRow
                anchors.fill: parent
                anchors.margins: 8
                spacing: 8
                Label {
                    text: "⚠️"
                    font.pixelSize: 13
                }
                Label {
                    Layout.fillWidth: true
                    font.pixelSize: 11
                    color: "#FDE68A"
                    wrapMode: Text.WordWrap
                    text: "Cảnh báo chất lượng: Độ phân giải 1080p kết hợp mức Tốc độ tối đa (320k) có thể gây vỡ khối (QP pumping) ở cảnh chuyển động nhanh. Đề xuất nâng lên mức '⚖️ Cân bằng (2M)' để hình ảnh mượt mà."
                }
            }
        }

        // Bảng phân tích đánh đổi trực quan (Fix BUG-07: tính toán động theo thời lượng cắt thực tế)
        Rectangle {
            Layout.columnSpan: 2
            Layout.fillWidth: true
            Layout.topMargin: 2
            Layout.bottomMargin: 6
            radius: Theme.radiusMd
            color: Theme.surface
            border.color: Theme.border
            border.width: 1
            implicitHeight: qualityDetailCol.implicitHeight + 16

            readonly property int sampleDurationMins: {
                if (!settings) return 1
                if (settings.autoSplitEnabled && settings.autoSplitMinutes > 0) return settings.autoSplitMinutes
                if (settings.defaultTrimLimitMinutes > 0) return settings.defaultTrimLimitMinutes
                return 1
            }

            ColumnLayout {
                id: qualityDetailCol
                anchors.fill: parent
                anchors.margins: 10
                spacing: 6

                RowLayout {
                    Layout.fillWidth: true
                    spacing: 8

                    Rectangle {
                        Layout.preferredHeight: 22
                        Layout.preferredWidth: badgeLabel.implicitWidth + 14
                        radius: 11
                        readonly property real currentMbps: settings ? settings.renderMaxrateMbps : 0
                        color: currentMbps <= 0.05 ? Qt.rgba(0.06, 0.73, 0.51, 0.2)
                             : currentMbps <= 2.5  ? Qt.rgba(0.22, 0.74, 0.97, 0.2)
                             : currentMbps <= 5.0  ? Qt.rgba(0.96, 0.62, 0.04, 0.2)
                             : Qt.rgba(0.93, 0.28, 0.60, 0.2)
                        border.color: currentMbps <= 0.05 ? "#10B981"
                                    : currentMbps <= 2.5  ? "#38BDF8"
                                    : currentMbps <= 5.0  ? "#F59E0B"
                                    : "#EC4899"
                        border.width: 1

                        Label {
                            id: badgeLabel
                            anchors.centerIn: parent
                            font.pixelSize: 11
                            font.bold: true
                            readonly property real currentMbps: settings ? settings.renderMaxrateMbps : 0
                            color: currentMbps <= 0.05 ? "#10B981"
                                 : currentMbps <= 2.5  ? "#38BDF8"
                                 : currentMbps <= 5.0  ? "#F59E0B"
                                 : "#EC4899"
                            text: currentMbps <= 0.05 ? "⚡ TỐC ĐỘ TỐI ĐA"
                                : currentMbps <= 2.5  ? "⚖️ CÂN BẰNG NÉT CHUẨN"
                                : currentMbps <= 5.0  ? "✨ CHẤT LƯỢNG CAO (HQ)"
                                : "🔥 CỰC NÉT TỐI ĐA"
                        }
                    }

                    Label {
                        Layout.fillWidth: true
                        font.pixelSize: 11
                        font.bold: true
                        color: Theme.text
                        readonly property real currentMbps: settings ? settings.renderMaxrateMbps : 0
                        readonly property int mins: parent.parent.parent.sampleDurationMins
                        text: {
                            if (currentMbps <= 0.05) {
                                var mb = Math.max(2, Math.round(mins * 2.6))
                                var sec = (0.5 + mins * 0.4).toFixed(1)
                                return "Dung lượng (" + mins + " phút): ~" + mb + " MB  •  Upload TikTok: ~" + sec + "s  •  CQ 26 (Audio 48k)"
                            } else if (currentMbps <= 2.5) {
                                var mb = Math.max(7, Math.round(mins * 7.5))
                                var sec = (1.0 + mins * 0.9).toFixed(1)
                                return "Dung lượng (" + mins + " phút): ~" + mb + " MB  •  Upload TikTok: ~" + sec + "s  •  CQ 23 (Audio 96k)"
                            } else if (currentMbps <= 5.0) {
                                var mb = Math.max(15, Math.round(mins * 15.0))
                                var sec = (1.5 + mins * 1.8).toFixed(1)
                                return "Dung lượng (" + mins + " phút): ~" + mb + " MB  •  Upload TikTok: ~" + sec + "s  •  CQ 21 (Audio 128k)"
                            } else {
                                var mb = Math.max(30, Math.round(mins * 30.0))
                                var sec = (2.5 + mins * 3.8).toFixed(1)
                                return "Dung lượng (" + mins + " phút): ~" + mb + " MB  •  Upload TikTok: ~" + sec + "s  •  CQ 18 (Audio 192k)"
                            }
                        }
                    }
                }

                Label {
                    Layout.fillWidth: true
                    font.pixelSize: 11
                    color: Theme.textMuted
                    wrapMode: Text.WordWrap
                    readonly property real currentMbps: settings ? settings.renderMaxrateMbps : 0
                    text: {
                        if (currentMbps <= 0.05) {
                            return "→ Đánh đổi: File siêu nhẹ, render cực nhanh, tối ưu upload vượt ngưỡng mạng proxy. Phù hợp cày số lượng video lớn."
                        } else if (currentMbps <= 2.5) {
                            return "→ Đánh đổi: Hình ảnh sắc nét hơn rõ rệt, giảm hiện tượng vỡ hạt khi chuyển động nhanh. Đánh đổi thêm ~1-2 giây upload."
                        } else if (currentMbps <= 5.0) {
                            return "→ Đánh đổi: Độ nét cao, giữ trọn vẹn chi tiết khung hình và âm thanh stereo trong trẻo. Render và upload sẽ mất thêm ~3-5 giây."
                        } else {
                            return "→ Đánh đổi: Độ nét tối đa (1080p), tận dụng tối đa sức mạnh GPU RTX 5070. File nặng và upload lâu hơn đáng kể."
                        }
                    }
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
            checked: Boolean(settings && settings.tiktokFastDone !== undefined ? settings.tiktokFastDone : true)
            onToggled: if (settings) settings.tiktokFastDone = checked
        }
    }
}
