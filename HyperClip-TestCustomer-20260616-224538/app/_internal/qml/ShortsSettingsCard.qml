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
                checked: settings ? settings.shortsAutoRender : true
                onToggled: if (settings) settings.shortsAutoRender = checked
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
                    value: settings ? settings.shortsRenderSpeed : 1.1
                    onMoved: if (settings) settings.shortsRenderSpeed = value
                }
                Label {
                    text: (settings ? settings.shortsRenderSpeed : 1.1).toFixed(2) + "x"
                    color: Theme.text
                    font.pixelSize: Theme.textMd
                    Layout.preferredWidth: 40
                }
            }
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
                checked: settings ? settings.shortsTiktokUploadEnabled : false
                onToggled: if (settings) settings.shortsTiktokUploadEnabled = checked
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
