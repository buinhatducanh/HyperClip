// src/ui/qml/LongSettingsCard.qml
// Pass 91 — BỘ CÀI ĐẶT CỦA LÀN VIDEO DÀI = đúng các key cũ (videoMin/Max,
// autoDownload*, autoRender*, defaultTrimLimit, autoSplit*, tiktokUploadEnabled)
// — nên ghép lại từ DownloadCard/AutoRenderCard sẵn có, chỉ thêm card ngưỡng
// thời lượng (trước đây nằm trong DetectionPanel) và công tắc TikTok của làn.
// Đổi ở đây = đổi ở trang Cài đặt (cùng SettingsModel).
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

ColumnLayout {
    id: root
    spacing: Theme.spacingMd

    SettingsCard {
        Layout.fillWidth: true
        title: "NHẬN VIDEO NÀO LÀ VIDEO DÀI"

        Label {
            text: "Video dài hơn sàn và ngắn hơn trần dưới đây vào làn Video dài. Nguồn DỌC bị bỏ qua ở làn này (đó là việc của làn Shorts). Khi làn Shorts cũng bật, video ≤ trần Short vào làn Shorts trước."
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
                Label { text: "TG tối thiểu (giây)"; color: Theme.text; font.pixelSize: Theme.textMd; font.bold: true }
                Label {
                    text: "Video ngắn hơn mức này không vào làn Video dài."
                    color: Theme.textMuted; font.pixelSize: 11; wrapMode: Text.WordWrap; Layout.fillWidth: true
                }
            }
            SpinBox {
                Layout.preferredWidth: 160
                Layout.alignment: Qt.AlignRight
                from: 1; to: 600; stepSize: 10
                editable: true
                value: settings ? settings.videoMinDurationSec : 60
                onValueModified: if (settings) settings.videoMinDurationSec = value
                onActiveFocusChanged: {
                    if (!activeFocus) {
                        var v = Math.max(from, Math.min(to, valueFromText(contentItem.text, locale)))
                        value = v
                        if (settings) settings.videoMinDurationSec = v
                    }
                }
            }

            ColumnLayout {
                spacing: 2
                Layout.fillWidth: true
                Label { text: "TG tối đa (phút)"; color: Theme.text; font.pixelSize: Theme.textMd; font.bold: true }
                Label {
                    text: "Giới hạn thời lượng video tối đa để tự động tải."
                    color: Theme.textMuted; font.pixelSize: 11; wrapMode: Text.WordWrap; Layout.fillWidth: true
                }
            }
            SpinBox {
                Layout.preferredWidth: 160
                Layout.alignment: Qt.AlignRight
                from: 1; to: 600; stepSize: 5
                editable: true
                value: settings ? Math.max(1, Math.round(settings.videoMaxDurationSec / 60)) : 60
                onValueModified: if (settings) settings.videoMaxDurationSec = value * 60
                onActiveFocusChanged: {
                    if (!activeFocus) {
                        var v = Math.max(from, Math.min(to, valueFromText(contentItem.text, locale)))
                        value = v
                        if (settings) settings.videoMaxDurationSec = v * 60
                    }
                }
            }
        }
    }

    // Chỉ các ô THUỘC LÀN (tự động tải/chất lượng/cắt phút · tự động render/
    // độ phân giải/fps/tốc độ/tách phần). Tuổi video tối đa, số luồng tải,
    // bypass VPN, chữ thanh dưới, render song song là CHUNG → trang Cài đặt.
    DownloadCard { Layout.fillWidth: true }
    AutoRenderCard { Layout.fillWidth: true }

    SettingsCard {
        Layout.fillWidth: true
        title: "ĐĂNG TIKTOK (LÀN VIDEO DÀI)"

        RowLayout {
            Layout.fillWidth: true
            spacing: Theme.spacingMd
            ColumnLayout {
                Layout.fillWidth: true
                spacing: 2
                Label { text: "Tự động đăng TikTok sau render"; color: Theme.text; font.pixelSize: Theme.textMd }
                Label {
                    text: "Đây là công tắc tổng của làn Video dài (cũng là công tắc trong tab TikTok). Làn Shorts có công tắc riêng."
                    color: Theme.textMuted; font.pixelSize: 11; wrapMode: Text.WordWrap; Layout.fillWidth: true
                }
            }
            Switch {
                checked: settings ? settings.tiktokUploadEnabled : false
                onToggled: {
                    if (settings) {
                        settings.tiktokUploadEnabled = checked
                        if (checked) {
                            try {
                                if (typeof backend !== "undefined" && backend) {
                                    var resp = backend.send_command("tiktok:list")
                                    var r = (resp && resp.result) ? resp.result : resp
                                    if (r && r.mappings && r.accounts) {
                                        var accMap = {}
                                        for (var cid in r.mappings) {
                                            var aid = r.mappings[cid]
                                            if (aid) {
                                                accMap[aid] = true
                                                accMap[String(aid).replace(/^tt_/, "")] = true
                                            }
                                        }
                                        for (var i = 0; i < r.accounts.length; i++) {
                                            var a = r.accounts[i]
                                            var cleanId = String(a.id).replace(/^tt_/, "")
                                            if (accMap[a.id] || accMap[cleanId]) {
                                                var tgt = a.profileId ? ("user_id=" + encodeURIComponent(a.profileId)) : ("serial_number=" + encodeURIComponent(a.adsPowerSerial || (i + 1)))
                                                var req = new XMLHttpRequest()
                                                req.open("GET", "http://127.0.0.1:50325/api/v1/browser/start?" + tgt + "&open_tabs=1")
                                                req.send()
                                            }
                                        }
                                    }
                                }
                            } catch (e) {}
                        }
                    }
                }
            }
        }
    }
}
