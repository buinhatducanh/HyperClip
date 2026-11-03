// src/ui/qml/DownloadCard.qml
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

SettingsCard {
    id: card
    title: "TẢI XUỐNG"

    property bool trimRotateActive: false
    property real trimRotateMinVal: 4
    property real trimRotateMaxVal: 5

    function syncTrimRotate() {
        if (settings) {
            try { settings.trimRotateEnabled = card.trimRotateActive } catch(e) {}
            try { settings.trimRotateMin = card.trimRotateMinVal } catch(e) {}
            try { settings.trimRotateMax = card.trimRotateMaxVal } catch(e) {}
        }
        if (typeof backend !== "undefined" && backend) {
            try {
                backend.send_command_async("settings:update", {
                    "trimRotateEnabled": card.trimRotateActive,
                    "trimRotateMin": card.trimRotateMinVal,
                    "trimRotateMax": card.trimRotateMaxVal
                });
            } catch(e) {}
        }
    }

    Component.onCompleted: {
        if (settings && typeof settings.trimRotateEnabled !== "undefined") {
            card.trimRotateActive = Boolean(settings.trimRotateEnabled)
        }
        if (settings && typeof settings.trimRotateMin === "number" && settings.trimRotateMin > 0) {
            card.trimRotateMinVal = settings.trimRotateMin
        }
        if (settings && typeof settings.trimRotateMax === "number" && settings.trimRotateMax > 0) {
            card.trimRotateMaxVal = settings.trimRotateMax
        }
        if (typeof backend !== "undefined" && backend) {
            try {
                var res = backend.send_command("settings:get");
                if (res) {
                    if (typeof res.trimRotateEnabled === "boolean") {
                        card.trimRotateActive = res.trimRotateEnabled;
                    }
                    if (typeof res.trimRotateMin === "number" && res.trimRotateMin > 0) {
                        card.trimRotateMinVal = res.trimRotateMin;
                    }
                    if (typeof res.trimRotateMax === "number" && res.trimRotateMax > 0) {
                        card.trimRotateMaxVal = res.trimRotateMax;
                    }
                }
            } catch(e) {}
        }
    }

    RowLayout {
        Layout.fillWidth: true
        spacing: Theme.spacingMd
        Label {
            text: "Tự động tải"
            color: Theme.text
            font.pixelSize: Theme.textMd
            Layout.fillWidth: true
        }
        Switch {
            checked: settings ? settings.autoDownloadEnabled : true
            onToggled: if (settings) settings.autoDownloadEnabled = checked
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
                text: "Chất lượng tải"
                color: Theme.text
                font.pixelSize: Theme.textMd
                font.bold: true
            }
            Label {
                text: "Độ phân giải video mục tiêu (ví dụ 1080p, 720p)."
                color: Theme.textMuted
                font.pixelSize: 11
                wrapMode: Text.WordWrap
                Layout.fillWidth: true
            }
        }
        ComboBox {
            Layout.preferredWidth: 140
            Layout.alignment: Qt.AlignRight
            font.pixelSize: Theme.textMd
            model: ["1080", "720", "480", "360"]
            currentIndex: settings ? Math.max(0, model.indexOf(settings.autoDownloadQuality)) : 0
            onActivated: if (settings) settings.autoDownloadQuality = model[currentIndex]
        }
 
        ColumnLayout {
            spacing: 2
            Layout.fillWidth: true
            Label {
                text: "Độ tuổi video tối đa (phút)"
                color: Theme.text
                font.pixelSize: Theme.textMd
                font.bold: true
            }
            Label {
                text: "Chỉ tải video đăng tải trong N phút qua (1440 = 24h)."
                color: Theme.textMuted
                font.pixelSize: 11
                wrapMode: Text.WordWrap
                Layout.fillWidth: true
            }
        }
        SpinBox {
            Layout.preferredWidth: 140
            Layout.alignment: Qt.AlignRight
            font.pixelSize: Theme.textMd
            from: 1
            to: 1440
            value: settings ? settings.autoDownloadMaxAgeMinutes : 1440
            editable: true
            onValueModified: if (settings) settings.autoDownloadMaxAgeMinutes = value
            onActiveFocusChanged: {
                if (!activeFocus) {
                    var val = valueFromText(contentItem.text, locale)
                    val = Math.max(from, Math.min(to, val))
                    value = val
                    if (settings) settings.autoDownloadMaxAgeMinutes = val
                }
            }
        }
 
        ColumnLayout {
            spacing: 2
            Layout.fillWidth: true
            Label {
                text: "Cắt tối đa (phút)"
                color: Theme.text
                font.pixelSize: Theme.textMd
                font.bold: true
            }
            Label {
                text: "Chỉ tải N phút đầu của video để tiết kiệm dung lượng."
                color: Theme.textMuted
                font.pixelSize: 11
                wrapMode: Text.WordWrap
                Layout.fillWidth: true
            }
        }
        SpinBox {
            Layout.preferredWidth: 140
            Layout.alignment: Qt.AlignRight
            font.pixelSize: Theme.textMd
            from: 1
            to: 999
            value: settings ? settings.defaultTrimLimit : 10
            editable: true
            onValueModified: if (settings) settings.defaultTrimLimit = value
            onActiveFocusChanged: {
                if (!activeFocus) {
                    var val = valueFromText(contentItem.text, locale)
                    val = Math.max(from, Math.min(to, val))
                    value = val
                    if (settings) settings.defaultTrimLimit = val
                }
            }
        }

        // ─── Xoay vòng ngẫu nhiên thời lượng tải (Min - Max) ─────────────
        ColumnLayout {
            spacing: 2
            Layout.fillWidth: true
            Label {
                text: "Xoay vòng ngẫu nhiên thời lượng tải (Min - Max)"
                color: Theme.text
                font.pixelSize: Theme.textMd
                font.bold: true
            }
            Label {
                text: "Tự động chọn ngẫu nhiên một mốc thời lượng giữa Min và Max (ví dụ từ 4 đến 5 phút) cho từng video để tránh trùng lặp độ dài."
                color: Theme.textMuted
                font.pixelSize: 11
                wrapMode: Text.WordWrap
                Layout.fillWidth: true
            }
        }
        Switch {
            id: rotateSwitch
            Layout.alignment: Qt.AlignRight
            checked: card.trimRotateActive
            onToggled: {
                card.trimRotateActive = checked
                if (checked) {
                    if (card.trimRotateMinVal < 1) card.trimRotateMinVal = 4
                    if (card.trimRotateMaxVal < card.trimRotateMinVal) card.trimRotateMaxVal = Math.max(5, card.trimRotateMinVal)
                }
                card.syncTrimRotate()
            }
        }

        // ─── Khối nhập Min / Max (Chỉ hiển thị khi bật công tắc xoay vòng) ───
        Rectangle {
            id: rotateBox
            Layout.columnSpan: 2
            Layout.fillWidth: true
            visible: card.trimRotateActive
            implicitHeight: visible ? rotateInnerCol.implicitHeight + 20 : 0
            color: Theme.accent + "0D"
            border.color: Theme.accent + "4D"
            border.width: 1
            radius: Theme.radiusMd
            clip: true

            ColumnLayout {
                id: rotateInnerCol
                anchors.fill: parent
                anchors.margins: 10
                spacing: 8

                RowLayout {
                    Layout.fillWidth: true
                    spacing: 6
                    Icon {
                        name: "refresh"
                        size: 13
                        color: Theme.accent
                    }
                    Label {
                        text: "Khoảng thời lượng cắt xoay vòng (Phút)"
                        color: Theme.accent
                        font.pixelSize: Theme.textSm
                        font.bold: true
                    }
                }

                Label {
                    text: "Mỗi video sẽ tự động cắt ngẫu nhiên từ " 
                          + Math.round(card.trimRotateMinVal) + " phút đến " + Math.round(card.trimRotateMaxVal) + " phút (chính xác theo từng giây lẻ chống spam bot)."
                    color: Theme.textMuted
                    font.pixelSize: 11
                    wrapMode: Text.WordWrap
                    Layout.fillWidth: true
                }

                RowLayout {
                    Layout.fillWidth: true
                    spacing: 12

                    // Ô nhập Min
                    RowLayout {
                        spacing: 6
                        Label {
                            text: "Từ (Min):"
                            color: Theme.text
                            font.pixelSize: Theme.textSm
                            font.bold: true
                        }
                        SpinBox {
                            id: minSpin
                            implicitWidth: 95
                            font.pixelSize: Theme.textMd
                            from: 1
                            to: 999
                            value: Math.round(card.trimRotateMinVal)
                            editable: true
                            onValueModified: applyMin(value)
                            onActiveFocusChanged: {
                                if (!activeFocus) {
                                    var val = valueFromText(contentItem.text, locale)
                                    val = Math.max(from, Math.min(to, isNaN(val) ? 4 : val))
                                    value = val
                                    applyMin(val)
                                }
                            }
                            function applyMin(v) {
                                card.trimRotateMinVal = v
                                if (card.trimRotateMaxVal < v) {
                                    card.trimRotateMaxVal = v
                                    maxSpin.value = v
                                }
                                card.syncTrimRotate()
                            }
                        }
                        Label {
                            text: "phút"
                            color: Theme.textMuted
                            font.pixelSize: Theme.textSm
                        }
                    }

                    // Ký hiệu liên kết
                    Label {
                        text: "➔"
                        color: Theme.accent
                        font.pixelSize: 13
                    }

                    // Ô nhập Max
                    RowLayout {
                        spacing: 6
                        Label {
                            text: "Đến (Max):"
                            color: Theme.text
                            font.pixelSize: Theme.textSm
                            font.bold: true
                        }
                        SpinBox {
                            id: maxSpin
                            implicitWidth: 95
                            font.pixelSize: Theme.textMd
                            from: 1
                            to: 999
                            value: Math.round(card.trimRotateMaxVal)
                            editable: true
                            onValueModified: applyMax(value)
                            onActiveFocusChanged: {
                                if (!activeFocus) {
                                    var val = valueFromText(contentItem.text, locale)
                                    val = Math.max(from, Math.min(to, isNaN(val) ? 5 : val))
                                    value = val
                                    applyMax(val)
                                }
                            }
                            function applyMax(v) {
                                card.trimRotateMaxVal = v
                                if (card.trimRotateMinVal > v) {
                                    card.trimRotateMinVal = v
                                    minSpin.value = v
                                }
                                card.syncTrimRotate()
                            }
                        }
                        Label {
                            text: "phút"
                            color: Theme.textMuted
                            font.pixelSize: Theme.textSm
                        }
                    }

                    Item { Layout.fillWidth: true }
                }
            }
        }
 
        ColumnLayout {
            spacing: 2
            Layout.fillWidth: true
            Label {
                text: "Tải đồng thời"
                color: Theme.text
                font.pixelSize: Theme.textMd
                font.bold: true
            }
            Label {
                text: "Số luồng tải yt-dlp song song tối đa."
                color: Theme.textMuted
                font.pixelSize: 11
                wrapMode: Text.WordWrap
                Layout.fillWidth: true
            }
        }
        SpinBox {
            Layout.preferredWidth: 140
            Layout.alignment: Qt.AlignRight
            font.pixelSize: Theme.textMd
            from: 1
            to: 16
            value: settings ? settings.maxConcurrentDownloads : 1
            editable: true
            onValueModified: if (settings) settings.maxConcurrentDownloads = value
            onActiveFocusChanged: {
                if (!activeFocus) {
                    var val = valueFromText(contentItem.text, locale)
                    val = Math.max(from, Math.min(to, val))
                    value = val
                    if (settings) settings.maxConcurrentDownloads = val
                }
            }
        }

        ColumnLayout {
            spacing: 2
            Layout.fillWidth: true
            Label {
                text: "Direct Route IP (Bypass VPN)"
                color: Theme.text
                font.pixelSize: Theme.textMd
                font.bold: true
            }
            Label {
                text: "Bỏ qua VPN, kết nối trực tiếp IP vật lý để tăng tốc độ tải."
                color: Theme.textMuted
                font.pixelSize: 11
                wrapMode: Text.WordWrap
                Layout.fillWidth: true
            }
        }
        Switch {
            Layout.alignment: Qt.AlignRight
            checked: settings ? settings.bypassVpn : true
            onToggled: if (settings) settings.bypassVpn = checked
        }
    }
}
