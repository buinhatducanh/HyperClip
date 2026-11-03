// src/ui/qml/DownloadCard.qml
// Card tùy chọn tải nâng cao (Chất lượng, Độ tuổi video, Xoay vòng Min-Max)
// Mục cắt tối đa (Trim) đã được gom lên QuickPipelineCard để tránh trùng lặp
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

SettingsCard {
    id: card
    title: "TÙY CHỌN TẢI NÂNG CAO"

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
            font.bold: true
            Layout.fillWidth: true
        }
        HelpTip {
            text: "Tự động bắt đầu tải video ngay khi phát hiện video mới từ danh sách kênh đang theo dõi."
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

        // ─── CHẤT LƯỢNG TẢI ───────────────────────────────────────────
        RowLayout {
            spacing: 6
            Layout.fillWidth: true
            Label {
                text: "Chất lượng tải nguồn"
                color: Theme.text
                font.pixelSize: Theme.textMd
                font.bold: true
            }
            HelpTip {
                text: "Độ phân giải video tải từ YouTube về máy (1080, 720, 480, 360). Khuyên dùng 1080 để hình ảnh sắc nét nhất."
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

        // ─── ĐỘ TUỔI VIDEO TỐI ĐA ─────────────────────────────────────
        RowLayout {
            spacing: 6
            Layout.fillWidth: true
            Label {
                text: "Độ tuổi video tối đa (phút)"
                color: Theme.text
                font.pixelSize: Theme.textMd
                font.bold: true
            }
            HelpTip {
                text: "Chỉ tải video mới được đăng trong vòng N phút qua (1440 phút = 24 giờ). Tránh tải lại video cũ."
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

        // ─── XOAY VÒNG THỜI LƯỢNG TẢI (MIN - MAX) ────────────────────
        RowLayout {
            spacing: 6
            Layout.fillWidth: true
            Label {
                text: "Xoay vòng ngẫu nhiên (Min - Max)"
                color: Theme.text
                font.pixelSize: Theme.textMd
                font.bold: true
            }
            HelpTip {
                text: "Tự động chọn ngẫu nhiên một mốc thời lượng giữa Min và Max (ví dụ từ 4 đến 5 phút) theo từng giây lẻ cho mỗi video để tránh trùng lặp độ dài và chống bot TikTok."
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
            implicitHeight: visible ? rotateInnerCol.implicitHeight + 16 : 0
            color: Theme.surface
            border.color: Theme.accent
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
                    spacing: 8

                    Label {
                        text: "Khoảng thời lượng xoay vòng (Phút):"
                        color: Theme.accent
                        font.pixelSize: Theme.textSm
                        font.bold: true
                    }
                    Item { Layout.fillWidth: true }
                    Label { text: "Min:"; color: Theme.textMuted; font.pixelSize: Theme.textSm }
                    SpinBox {
                        from: 1; to: 120
                        value: Math.round(card.trimRotateMinVal)
                        editable: true
                        onValueModified: {
                            card.trimRotateMinVal = value
                            if (card.trimRotateMaxVal < value) card.trimRotateMaxVal = value
                            card.syncTrimRotate()
                        }
                    }
                    Label { text: "Max:"; color: Theme.textMuted; font.pixelSize: Theme.textSm }
                    SpinBox {
                        from: 1; to: 120
                        value: Math.round(card.trimRotateMaxVal)
                        editable: true
                        onValueModified: {
                            card.trimRotateMaxVal = value
                            if (card.trimRotateMinVal > value) card.trimRotateMinVal = value
                            card.syncTrimRotate()
                        }
                    }
                }
            }
        }
    }
}
