// src/ui/qml/ShortsSettingsCard.qml
// Pass 91 — BỘ CÀI ĐẶT RIÊNG CỦA LÀN SHORTS. Trước đây 4 số này là key ẩn
// (shortsDownloadQuality/RenderResolution/RenderSpeed/MaxDurationSec, Pass 89)
// chỉ sửa được bằng tay trong settings.json. Nay có UI, cộng thêm công tắc
// tải/render/đăng TikTok riêng của làn (mặc định đi theo làn dài — Rust
// crates/hyperclip_ipc/src/lane.rs quyết default, Python chỉ chép sang).
//
// Nguyên tắc: bind THẲNG vào `settings.shorts*` (SettingsModel) — cùng cơ chế
// dirty/save với trang Cài đặt; nút Lưu nằm ở LanePanel.
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

ColumnLayout {
    id: root
    spacing: Theme.spacingMd

    // ─── Bộ lọc thời lượng của làn ─────────────────────────────────
    SettingsCard {
        Layout.fillWidth: true
        title: "NHẬN VIDEO NÀO LÀ SHORT"

        Label {
            text: "YouTube không báo 'đây là Short' qua API — app phân làn theo THỜI LƯỢNG lúc phát hiện. Video ngắn hơn hoặc bằng trần dưới đây vào làn Shorts (kể cả video thường ngắn); sau khi tải, nguồn DỌC render phủ kín canvas, nguồn NGANG vẫn đi khung 3 phần."
            color: Theme.textMuted
            font.pixelSize: 11
            wrapMode: Text.WordWrap
            Layout.fillWidth: true
        }

        GridLayout {
            columns: 2
            columnSpacing: Theme.spacingLg
            rowSpacing: Theme.spacingMd
            Layout.fillWidth: true

            ColumnLayout {
                spacing: 2
                Layout.fillWidth: true
                Label { text: "Trần Short (giây)"; color: Theme.text; font.pixelSize: Theme.textMd; font.bold: true }
                Label {
                    text: "YouTube quy định Short ≤ 3 phút (180s) từ 10/2024. Hạ xuống 60 nếu chỉ muốn Short kiểu cũ."
                    color: Theme.textMuted; font.pixelSize: 11; wrapMode: Text.WordWrap; Layout.fillWidth: true
                }
            }
            SpinBox {
                Layout.preferredWidth: 160
                Layout.alignment: Qt.AlignRight
                from: 5; to: 600; stepSize: 5
                editable: true
                value: settings ? settings.shortsMaxDurationSec : 180
                onValueModified: if (settings) settings.shortsMaxDurationSec = value
                onActiveFocusChanged: {
                    if (!activeFocus) {
                        var v = Math.max(from, Math.min(to, valueFromText(contentItem.text, locale)))
                        value = v
                        if (settings) settings.shortsMaxDurationSec = v
                    }
                }
            }

            ColumnLayout {
                spacing: 2
                Layout.fillWidth: true
                Label { text: "Sàn Short (giây)"; color: Theme.text; font.pixelSize: Theme.textMd; font.bold: true }
                Label {
                    text: "Bỏ qua clip ngắn hơn mức này (1 = lấy hết)."
                    color: Theme.textMuted; font.pixelSize: 11; wrapMode: Text.WordWrap; Layout.fillWidth: true
                }
            }
            SpinBox {
                Layout.preferredWidth: 160
                Layout.alignment: Qt.AlignRight
                from: 1; to: 300; stepSize: 1
                editable: true
                value: settings ? settings.shortsMinDurationSec : 1
                onValueModified: if (settings) settings.shortsMinDurationSec = value
                onActiveFocusChanged: {
                    if (!activeFocus) {
                        var v = Math.max(from, Math.min(to, valueFromText(contentItem.text, locale)))
                        value = v
                        if (settings) settings.shortsMinDurationSec = v
                    }
                }
            }
        }

        // Cảnh báo chồng lấn với làn dài: video 60–180s thuộc Shorts khi cả hai bật.
        Label {
            visible: settings && settings.longEnabled && settings.shortsEnabled
                     && settings.videoMinDurationSec <= settings.shortsMaxDurationSec
            text: "→ Cả hai làn đang bật: video từ " + (settings ? settings.videoMinDurationSec : 60) + "s đến "
                  + (settings ? settings.shortsMaxDurationSec : 180) + "s sẽ vào làn SHORTS (Short xét trước), làn Video dài chỉ nhận phần dài hơn."
            color: Theme.warning
            font.pixelSize: 11
            wrapMode: Text.WordWrap
            Layout.fillWidth: true
        }
        Label {
            visible: settings && settings.longEnabled && settings.shortsEnabled
                     && settings.videoMinDurationSec > settings.shortsMaxDurationSec + 1
            text: "→ Khe hở: video từ " + (settings ? settings.shortsMaxDurationSec + 1 : 181) + "s đến "
                  + (settings ? settings.videoMinDurationSec - 1 : 59) + "s KHÔNG làn nào nhận — bị bỏ ngay ở vòng quét (0 unit)."
            color: Theme.warning
            font.pixelSize: 11
            wrapMode: Text.WordWrap
            Layout.fillWidth: true
        }
    }

    // ─── Tải ────────────────────────────────────────────────────────
    SettingsCard {
        Layout.fillWidth: true
        title: "TẢI SHORT"

        RowLayout {
            Layout.fillWidth: true
            spacing: Theme.spacingMd
            Label { text: "Tự động tải Short"; color: Theme.text; font.pixelSize: Theme.textMd; Layout.fillWidth: true }
            Switch {
                checked: settings ? settings.shortsAutoDownload : true
                onToggled: if (settings) settings.shortsAutoDownload = checked
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
                Label { text: "Chất lượng tải Short"; color: Theme.text; font.pixelSize: Theme.textMd; font.bold: true }
                Label {
                    text: "Short ngắn và nhẹ nên bản thấp là đủ — mặc định 360p, render lên mức đặt bên dưới. Không cắt (trim) và không tách phần với Short."
                    color: Theme.textMuted; font.pixelSize: 11; wrapMode: Text.WordWrap; Layout.fillWidth: true
                }
            }
            ComboBox {
                Layout.preferredWidth: 160
                Layout.alignment: Qt.AlignRight
                font.pixelSize: Theme.textMd
                model: ["1080", "720", "480", "360"]
                currentIndex: settings ? Math.max(0, model.indexOf(settings.shortsDownloadQuality)) : 3
                onActivated: if (settings) settings.shortsDownloadQuality = model[currentIndex]
            }

            // Pass 102: chỉ tải N giây đầu — Short dài hơn mức này không tải trọn.
            ColumnLayout {
                spacing: 2
                Layout.fillWidth: true
                Label { text: "Chỉ tải (giây đầu)"; color: Theme.text; font.pixelSize: Theme.textMd; font.bold: true }
                Label {
                    text: "0 = tải trọn video. Đặt 60: Short 90s chỉ tải 60 giây đầu — tải nhanh hơn, kéo dài/render chạy trên phần đã tải (giống cắt video dài, chính xác từng giây)."
                    color: Theme.textMuted; font.pixelSize: 11; wrapMode: Text.WordWrap; Layout.fillWidth: true
                }
            }
            SpinBox {
                Layout.preferredWidth: 160
                Layout.alignment: Qt.AlignRight
                from: 0; to: 600; stepSize: 5
                editable: true
                value: (settings && settings.shortsDownloadMaxSec !== undefined) ? settings.shortsDownloadMaxSec : 0
                onValueModified: if (settings) settings.shortsDownloadMaxSec = value
                onActiveFocusChanged: {
                    if (!activeFocus) {
                        var v = Math.max(from, Math.min(to, valueFromText(contentItem.text, locale)))
                        value = v
                        if (settings) settings.shortsDownloadMaxSec = v
                    }
                }
            }
        }
    }

    // ─── Render ─────────────────────────────────────────────────────
    SettingsCard {
        Layout.fillWidth: true
        title: "RENDER SHORT"

        RowLayout {
            Layout.fillWidth: true
            spacing: Theme.spacingMd
            Label { text: "Tự động render Short"; color: Theme.text; font.pixelSize: Theme.textMd; Layout.fillWidth: true }
            Switch {
                checked: (settings && settings.shortsAutoRender !== undefined) ? settings.shortsAutoRender : true
                onToggled: if (settings) settings.shortsAutoRender = checked
            }
        }

        // Pass 112: phóng ảnh bằng GPU — công tắc A/B mắt (INVARIANT #21).
        RowLayout {
            Layout.fillWidth: true
            spacing: Theme.spacingMd
            ColumnLayout {
                Layout.fillWidth: true
                spacing: 2
                Label { text: "Phóng ảnh bằng GPU (đang thử nghiệm)"; color: Theme.text; font.pixelSize: Theme.textMd }
                Label {
                    text: "Bật: khung hình ở lì trong card đồ hoạ suốt quá trình, không kéo qua lại bộ nhớ máy — khi đã chạy thì nhanh gần gấp đôi (~1700 khung/giây). NHƯNG trên máy RTX 3060 đo được một cú khựng ~3,5 giây ở đầu mỗi lượt render, làm tổng thời gian tệ hơn đường thường. Chỉ bật khi muốn thử và đăng liên tiếp 2-3 video để xem cú khựng đó có biến mất từ video thứ hai không."
                    color: Theme.textMuted; font.pixelSize: 11; wrapMode: Text.WordWrap; Layout.fillWidth: true
                }
            }
            Switch {
                checked: (settings && settings.renderGpuScale !== undefined) ? settings.renderGpuScale : true
                onToggled: if (settings) settings.renderGpuScale = checked
            }
        }

        // Pass 108: bỏ hẳn chặng render khi nó không đổi gì (nhanh nhất).
        RowLayout {
            Layout.fillWidth: true
            spacing: Theme.spacingMd
            ColumnLayout {
                Layout.fillWidth: true
                spacing: 2
                Label { text: "Bỏ qua render khi không cần đổi gì (nhanh hơn ~1,5s)"; color: Theme.text; font.pixelSize: Theme.textMd }
                Label {
                    text: "Short vốn đã dọc 9:16 nên khung phủ kín không cắt gì; nếu tốc độ để 1.00 và không kéo dài thì render chỉ là mã hoá lại y nguyên. Bật: đăng thẳng file vừa tải — bỏ luôn chặng render VÀ file nhẹ hơn nên TikTok xử lý nhanh hơn. Đổi lại KHÔNG upscale (video giữ đúng độ phân giải đã tải, vd 360p). Đặt tốc độ khác 1.00 hoặc bật kéo dài thì app tự render lại như thường."
                    color: Theme.textMuted; font.pixelSize: 11; wrapMode: Text.WordWrap; Layout.fillWidth: true
                }
            }
            Switch {
                checked: (settings && settings.shortsSkipRender !== undefined) ? settings.shortsSkipRender : false
                onToggled: if (settings) settings.shortsSkipRender = checked
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
                Label { text: "Độ phân giải canvas"; color: Theme.text; font.pixelSize: Theme.textMd; font.bold: true }
                Label {
                    text: "Short đã sẵn khung dọc → PHỦ KÍN canvas (không khung 3 phần). Mặc định 720p."
                    color: Theme.textMuted; font.pixelSize: 11; wrapMode: Text.WordWrap; Layout.fillWidth: true
                }
            }
            ComboBox {
                Layout.preferredWidth: 160
                Layout.alignment: Qt.AlignRight
                font.pixelSize: Theme.textMd
                model: ["1080p", "720p", "480p", "360p"]
                currentIndex: settings ? Math.max(0, model.indexOf(settings.shortsRenderResolution)) : 1
                onActivated: if (settings) settings.shortsRenderResolution = model[currentIndex]
            }

            ColumnLayout {
                spacing: 2
                Layout.fillWidth: true
                Label { text: "Khung hình (FPS)"; color: Theme.text; font.pixelSize: Theme.textMd; font.bold: true }
                Label {
                    text: "Mặc định đi theo làn Video dài (nhịp chung của dây chuyền)."
                    color: Theme.textMuted; font.pixelSize: 11; wrapMode: Text.WordWrap; Layout.fillWidth: true
                }
            }
            ComboBox {
                Layout.preferredWidth: 160
                Layout.alignment: Qt.AlignRight
                font.pixelSize: Theme.textMd
                model: [30, 60]
                currentIndex: settings ? Math.max(0, [30, 60].indexOf(settings.shortsRenderFps)) : 0
                onActivated: if (settings) settings.shortsRenderFps = model[currentIndex]
            }

            // Pass 105: van bitrate — trước chỉ sửa được bằng tay trong
            // settings.json nên máy khách chưa từng bật; file render to làm
            // TikTok "xử lý video" lâu thêm ~1s mỗi lượt (log 24/08: 2,3s).
            ColumnLayout {
                spacing: 2
                Layout.fillWidth: true
                Label { text: "Trần bitrate render (Mbps)"; color: Theme.text; font.pixelSize: Theme.textMd; font.bold: true }
                Label {
                    text: "0 = tự động theo card (720p ≈ 6). Đặt 3 cho file nhẹ hơn nửa — TikTok nhận & xử lý nhanh hơn, mắt thường không phân biệt được (TikTok nén lại ~1 Mbps). XEM THỬ video đầu rồi hẵng để tự động chạy."
                    color: Theme.textMuted; font.pixelSize: 11; wrapMode: Text.WordWrap; Layout.fillWidth: true
                }
            }
            SpinBox {
                Layout.preferredWidth: 160
                Layout.alignment: Qt.AlignRight
                from: 0; to: 12; stepSize: 1
                editable: true
                value: (settings && settings.renderMaxrateMbps !== undefined) ? settings.renderMaxrateMbps : 0
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
                Label { text: "Tốc độ phát"; color: Theme.text; font.pixelSize: Theme.textMd; font.bold: true }
                Label {
                    text: "Mặc định 1.1x cho Short (lách bản quyền, tăng độ cuốn)."
                    color: Theme.textMuted; font.pixelSize: 11; wrapMode: Text.WordWrap; Layout.fillWidth: true
                }
            }
            RowLayout {
                Layout.preferredWidth: 160
                Layout.alignment: Qt.AlignRight
                spacing: Theme.spacingSm
                Slider {
                    Layout.fillWidth: true
                    from: 1.0; to: 2.0; stepSize: 0.05
                    value: (settings && typeof settings.shortsRenderSpeed === 'number') ? settings.shortsRenderSpeed : 1.1
                    onMoved: if (settings) settings.shortsRenderSpeed = value
                }
                Label {
                    text: (settings && typeof settings.shortsRenderSpeed === 'number' ? settings.shortsRenderSpeed : 1.1).toFixed(2) + "x"
                    color: Theme.text
                    font.pixelSize: Theme.textMd
                    Layout.preferredWidth: 40
                }
            }
        }
    }

    // ─── Pass 97: Kéo dài thời lượng (TikTok >60s) ──────────────────
    SettingsCard {
        id: extendCard
        Layout.fillWidth: true
        title: "KÉO DÀI THỜI LƯỢNG (TIKTOK >60 GIÂY)"

        // Giá trị lưu vào settings — thứ tự PHẢI khớp model của ComboBox.
        readonly property var extendModes: ["off", "loop", "slow", "freeze"]
        readonly property int extendIdx: settings ? Math.max(0, extendModes.indexOf(settings.shortsExtendMode)) : 0

        Label {
            text: "Video ngắn hơn mục tiêu được KÉO DÀI khi render để vượt mốc 60s của TikTok. Chỉ áp dụng cho nguồn DỌC (Short thật — khung phủ kín); video ngang đi khung 3 phần không kéo dài. Video đã dài hơn mục tiêu giữ nguyên, không bao giờ bị cắt ngắn."
            color: Theme.textMuted
            font.pixelSize: 11
            wrapMode: Text.WordWrap
            Layout.fillWidth: true
        }

        GridLayout {
            columns: 2
            columnSpacing: Theme.spacingLg
            rowSpacing: Theme.spacingMd
            Layout.fillWidth: true

            ColumnLayout {
                spacing: 2
                Layout.fillWidth: true
                Label { text: "Cách kéo dài"; color: Theme.text; font.pixelSize: Theme.textMd; font.bold: true }
                Label {
                    text: {
                        switch (extendCard.extendIdx) {
                        case 1: return "Phát hết video rồi ghép tiếp từ ĐẦU video vào đuôi cho đủ mục tiêu. Ví dụ 50s, mục tiêu 60 → ghép thêm 10s đầu. Tốc độ phát ở trên vẫn áp dụng."
                        case 2: return "Giảm tốc độ phát (slow motion) cho tới đúng mục tiêu — THAY THẾ thanh Tốc độ phát ở trên. Kéo tối đa 4 lần (video quá ngắn sẽ không chạm được mục tiêu)."
                        case 3: return "Giữ NGUYÊN video, tốc độ GỐC x1.0 (bỏ qua thanh Tốc độ phát), đóng băng khung hình cuối cho đủ mục tiêu. Ví dụ 50s, mục tiêu 60 → đứng hình 10s cuối."
                        default: return "Tắt — video render ra đúng độ dài gốc (hành vi cũ)."
                        }
                    }
                    color: Theme.textMuted; font.pixelSize: 11; wrapMode: Text.WordWrap; Layout.fillWidth: true
                }
            }
            ComboBox {
                id: extendModeBox
                Layout.preferredWidth: 200
                Layout.alignment: Qt.AlignRight
                font.pixelSize: Theme.textMd
                model: ["Tắt — giữ nguyên", "1 · Lặp lại từ đầu", "2 · Chậm lại (slow)", "3 · Đứng hình ở cuối"]
                currentIndex: extendCard.extendIdx
                onActivated: if (settings) settings.shortsExtendMode = extendCard.extendModes[currentIndex]
            }

            ColumnLayout {
                spacing: 2
                Layout.fillWidth: true
                visible: extendCard.extendIdx > 0
                Label { text: "ĐỘ DÀI VIDEO RA (giây)"; color: Theme.text; font.pixelSize: Theme.textMd; font.bold: true }
                Label {
                    // Pass 105: nói đúng bản chất HAI CHIỀU — trước đây ghi
                    // "muốn video dài" nên khách điền 60 rồi ngạc nhiên khi
                    // video 157s vẫn ra 157s (chỉ kéo, không cắt).
                    text: (extendCard.extendIdx === 1
                          ? "0 = tự động NHÂN ĐÔI (31s → 62s). "
                          : "0 = tự động 61s (\"trên 60s\"). ")
                          + "Điền số: video NGẮN hơn được kéo tới đúng số đó, video DÀI hơn chỉ tải & cắt còn đúng số đó (nhanh hơn ở cả tải, render lẫn đăng). Tối đa 600."
                    color: Theme.textMuted; font.pixelSize: 11; wrapMode: Text.WordWrap; Layout.fillWidth: true
                }
            }
            SpinBox {
                Layout.preferredWidth: 160
                Layout.alignment: Qt.AlignRight
                visible: extendCard.extendIdx > 0
                from: 0; to: 600; stepSize: 5
                editable: true
                value: (settings && settings.shortsExtendTargetSec !== undefined) ? settings.shortsExtendTargetSec : 0
                onValueModified: if (settings) settings.shortsExtendTargetSec = value
                onActiveFocusChanged: {
                    if (!activeFocus) {
                        var v = Math.max(from, Math.min(to, valueFromText(contentItem.text, locale)))
                        value = v
                        if (settings) settings.shortsExtendTargetSec = v
                    }
                }
            }

            // Pass 116: SÀN NGUỒN — video quá ngắn thì đừng độn.
            ColumnLayout {
                spacing: 2
                Layout.fillWidth: true
                visible: extendCard.extendIdx > 0
                Label { text: "Chỉ kéo dài khi video gốc dài từ (giây)"; color: Theme.text; font.pixelSize: Theme.textMd; font.bold: true }
                Label {
                    text: "0 = kéo mọi video ngắn hơn mục tiêu. Đặt 45 (với mục tiêu 61): video gốc 45–60s được kéo lên 61s, video ngắn hơn 45s ĐĂNG NGUYÊN BẢN — vì độn thêm hơn 16 giây thì lặp/chậm/đứng hình đều lộ rõ."
                    color: Theme.textMuted; font.pixelSize: 11; wrapMode: Text.WordWrap; Layout.fillWidth: true
                }
            }
            SpinBox {
                Layout.preferredWidth: 160
                Layout.alignment: Qt.AlignRight
                visible: extendCard.extendIdx > 0
                from: 0; to: 600; stepSize: 5
                editable: true
                value: (settings && settings.shortsExtendMinSrcSec !== undefined) ? settings.shortsExtendMinSrcSec : 0
                onValueModified: if (settings) settings.shortsExtendMinSrcSec = value
                onActiveFocusChanged: {
                    if (!activeFocus) {
                        var v = Math.max(from, Math.min(to, valueFromText(contentItem.text, locale)))
                        value = v
                        if (settings) settings.shortsExtendMinSrcSec = v
                    }
                }
            }
        }

        Label {
            visible: settings && extendCard.extendIdx === 2 && settings.shortsRenderSpeed > 1.001
            text: "→ Đang bật Chậm lại: thanh \"Tốc độ phát\" " + (settings && typeof settings.shortsRenderSpeed === 'number' ? settings.shortsRenderSpeed.toFixed(2) : "1.10") + "x ở trên KHÔNG có tác dụng với làn Shorts (hệ số chậm tự tính theo mục tiêu)."
            color: Theme.warning
            font.pixelSize: 11
            wrapMode: Text.WordWrap
            Layout.fillWidth: true
        }
        Label {
            visible: settings && extendCard.extendIdx === 3 && settings.shortsRenderSpeed > 1.001
            text: "→ Đang bật Đứng hình: video chạy TỐC ĐỘ GỐC x1.0 — thanh \"Tốc độ phát\" " + (settings && typeof settings.shortsRenderSpeed === 'number' ? settings.shortsRenderSpeed.toFixed(2) : "1.10") + "x ở trên KHÔNG có tác dụng với làn Shorts."
            color: Theme.warning
            font.pixelSize: 11
            wrapMode: Text.WordWrap
            Layout.fillWidth: true
        }
    }

    // ─── TikTok ─────────────────────────────────────────────────────
    SettingsCard {
        Layout.fillWidth: true
        title: "ĐĂNG TIKTOK (LÀN SHORTS)"

        RowLayout {
            Layout.fillWidth: true
            spacing: Theme.spacingMd
            ColumnLayout {
                Layout.fillWidth: true
                spacing: 2
                Label { text: "Tự động đăng Short lên TikTok"; color: Theme.text; font.pixelSize: Theme.textMd }
                Label {
                    text: "Công tắc riêng của làn Shorts — tắt ở đây không ảnh hưởng làn Video dài. Kênh vẫn phải được gán tài khoản TikTok (tab TikTok)."
                    color: Theme.textMuted; font.pixelSize: 11; wrapMode: Text.WordWrap; Layout.fillWidth: true
                }
            }
            Switch {
                checked: (settings && settings.shortsTiktokUploadEnabled !== undefined) ? settings.shortsTiktokUploadEnabled : false
                onToggled: if (settings) settings.shortsTiktokUploadEnabled = checked
            }
        }

        // Pass 105: fastDone — nút này trước chỉ có trong settings.json nên máy
        // khách chưa bao giờ bật; log 24/08 cho thấy mỗi lượt đăng trả thừa
        // 1,5s ngồi chờ TikTok chuyển trang sau khi lệnh đăng ĐÃ gửi.
        RowLayout {
            Layout.fillWidth: true
            spacing: Theme.spacingMd
            ColumnLayout {
                Layout.fillWidth: true
                spacing: 2
                Label { text: "Báo xong ngay khi bấm Đăng (nhanh hơn ~1,5s)"; color: Theme.text; font.pixelSize: Theme.textMd }
                Label {
                    text: "Bật: lệnh đăng gửi xong là app tính hoàn tất, không ngồi chờ TikTok chuyển trang. Video vẫn lên bình thường; đổi lại app không đọc được thông báo lỗi hiếm gặp của TikTok."
                    color: Theme.textMuted; font.pixelSize: 11; wrapMode: Text.WordWrap; Layout.fillWidth: true
                }
            }
            Switch {
                checked: (settings && settings.tiktokFastDone !== undefined) ? settings.tiktokFastDone : true
                onToggled: if (settings) settings.tiktokFastDone = checked
            }
        }
    }

    Label {
        text: "Dùng CHUNG với Video dài (chỉnh ở nút \"Video dài\" phía trên): tuổi video tối đa, số luồng tải, bypass VPN, chữ nướng vào video, số render song song, tách phần. Bật/tắt lấy Short: công tắc 3 khớp ở BỘ LỌC PHÁT HIỆN."
        color: Theme.textMuted
        font.pixelSize: 10
        wrapMode: Text.WordWrap
        Layout.fillWidth: true
    }
}
