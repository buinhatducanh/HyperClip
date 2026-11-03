// src/ui/qml/QuickPipelineCard.qml
// Card thiết lập nhanh quy trình tự động hóa E2E (Tải -> Tách Part -> Render -> Đăng TikTok qua AdsPower)
// Tích hợp cơ chế AdsPower Local API (port 50325), FastDone và Hot Upload chuẩn nhánh adspow
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

SettingsCard {
    id: card
    title: "⚡ QUY TRÌNH TỰ ĐỘNG HÓA E2E (CHUẨN ADSPOWER)"

    property bool adsPowerOnline: false

    function checkAdsPower() {
        try {
            var xhr = new XMLHttpRequest()
            xhr.open("GET", "http://127.0.0.1:50325/status")
            xhr.timeout = 2000
            xhr.onreadystatechange = function() {
                if (xhr.readyState === XMLHttpRequest.DONE) {
                    if (xhr.status === 200) {
                        try {
                            var res = JSON.parse(xhr.responseText)
                            card.adsPowerOnline = (res && res.code === 0)
                        } catch(e) { card.adsPowerOnline = false }
                    } else {
                        card.adsPowerOnline = false
                    }
                }
            }
            xhr.send()
        } catch(e) {
            card.adsPowerOnline = false
        }
    }

    Component.onCompleted: {
        card.checkAdsPower()
    }

    ColumnLayout {
        Layout.fillWidth: true
        spacing: Theme.spacingMd

        // ─── BANNER TÓM TẮT TRẠNG THÁI TRỰC QUAN ────────────────────────
        Rectangle {
            Layout.fillWidth: true
            Layout.preferredHeight: bannerRow.implicitHeight + 14
            radius: Theme.radiusMd
            color: Theme.surface
            border.color: Theme.accent
            border.width: 1

            RowLayout {
                id: bannerRow
                anchors.fill: parent
                anchors.leftMargin: 12
                anchors.rightMargin: 12
                spacing: 8

                Label {
                    text: "LUỒNG THỰC THI:"
                    color: Theme.accent
                    font.pixelSize: Theme.textSm
                    font.bold: true
                }
                Label {
                    text: {
                        var trimStr = (settings && settings.defaultTrimLimit < 900) ? ("Tải " + settings.defaultTrimLimit + " phút đầu") : "Tải trọn vẹn video";
                        var partStr = (settings && settings.autoSplitEnabled) ? ("Chia " + settings.autoSplitParts + " Part") : "1 Video đơn";
                        var renStr = "Render " + (settings ? settings.autoRenderResolution : "1080p") + " AdsPow";
                        var ttStr = (settings && settings.tiktokUploadEnabled) ? "Đăng TikTok từng Part qua AdsPower" : "Lưu máy";
                        return trimStr + "  ➔  " + partStr + "  ➔  " + renStr + "  ➔  " + ttStr;
                    }
                    color: Theme.text
                    font.pixelSize: Theme.textSm
                    font.bold: true
                    Layout.fillWidth: true
                    elide: Text.ElideRight
                }
            }
        }

        // ─── 4 BƯỚC CỐT LÕI (BẢNG THIẾT LẬP GỌN GÀNG) ───────────────────
        GridLayout {
            columns: 2
            columnSpacing: Theme.spacingLg
            rowSpacing: Theme.spacingMd
            Layout.fillWidth: true

            // ═══ BƯỚC 1: GIỚI HẠN TẢI (TRIM LIMIT) ═══════════════════════
            RowLayout {
                spacing: 6
                Layout.fillWidth: true
                Rectangle {
                    width: 20; height: 20; radius: 10; color: Theme.accent
                    Label { anchors.centerIn: parent; text: "1"; color: "#000"; font.pixelSize: 11; font.bold: true }
                }
                Label {
                    text: "Chỉ tải số phút cần tải"
                    color: Theme.text; font.pixelSize: Theme.textMd; font.bold: true
                }
                HelpTip {
                    text: "Chỉ tải N phút đầu của video gốc (ví dụ video 20 phút chỉ tải 9 phút đầu rồi gửi sang bộ chia part). Tiết kiệm hơn 60% thời gian tải."
                }
            }
            ColumnLayout {
                Layout.preferredWidth: 260
                Layout.alignment: Qt.AlignRight
                spacing: 4

                RowLayout {
                    Layout.fillWidth: true
                    spacing: 8
                    SpinBox {
                        id: trimSpin
                        Layout.fillWidth: true
                        font.pixelSize: Theme.textMd
                        from: 1; to: 999
                        value: settings ? settings.defaultTrimLimit : 9
                        editable: true
                        onValueModified: if (settings) settings.defaultTrimLimit = value
                        onActiveFocusChanged: {
                            if (!activeFocus) {
                                var v = Math.max(from, Math.min(to, valueFromText(contentItem.text, locale)))
                                value = v
                                if (settings) settings.defaultTrimLimit = v
                            }
                        }
                    }
                    Label { text: "phút"; color: Theme.textMuted; font.pixelSize: Theme.textMd }
                }

                RowLayout {
                    spacing: 4
                    Layout.alignment: Qt.AlignRight
                    Repeater {
                        model: [
                            { label: "5p", val: 5 },
                            { label: "9p (Chuẩn)", val: 9 },
                            { label: "15p", val: 15 },
                            { label: "Trọn vẹn", val: 999 }
                        ]
                        delegate: Rectangle {
                            id: trimBtn
                            required property var modelData
                            width: trimBtnLbl.implicitWidth + 10
                            height: 22
                            radius: 3
                            readonly property bool isSel: settings && settings.defaultTrimLimit === modelData.val
                            color: isSel ? Theme.accent : Theme.surface
                            border.color: Theme.border; border.width: 1
                            Label {
                                id: trimBtnLbl
                                anchors.centerIn: parent
                                text: trimBtn.modelData.label
                                font.pixelSize: 10
                                color: trimBtn.isSel ? "#000" : Theme.textMuted
                                font.bold: trimBtn.isSel
                            }
                            MouseArea {
                                anchors.fill: parent
                                cursorShape: Qt.PointingHandCursor
                                onClicked: {
                                    if (settings) {
                                        settings.defaultTrimLimit = trimBtn.modelData.val
                                        trimSpin.value = trimBtn.modelData.val
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // ═══ BƯỚC 2: TỰ ĐỘNG CHIA PART ════════════════════════════════
            RowLayout {
                spacing: 6
                Layout.fillWidth: true
                Rectangle {
                    width: 20; height: 20; radius: 10; color: Theme.accent
                    Label { anchors.centerIn: parent; text: "2"; color: "#000"; font.pixelSize: 11; font.bold: true }
                }
                Label {
                    text: "Tự động chia Part"
                    color: Theme.text; font.pixelSize: Theme.textMd; font.bold: true
                }
                HelpTip {
                    text: "Tự động chia đoạn video đã tải thành các Part đều nhau và render liên tục. Part 1 tải+render xong trước để đăng TikTok ngay, Part 2 & Part 3 tiếp tục render nền."
                }
            }
            ColumnLayout {
                Layout.preferredWidth: 260
                Layout.alignment: Qt.AlignRight
                spacing: 4

                RowLayout {
                    Layout.fillWidth: true
                    spacing: 8
                    Switch {
                        id: splitSwitch
                        checked: settings ? settings.autoSplitEnabled : true
                        onToggled: {
                            if (settings) {
                                settings.autoSplitEnabled = checked
                                if (checked && settings.autoSplitParts < 2) settings.autoSplitParts = 3
                            }
                        }
                    }
                    Label {
                        text: splitSwitch.checked ? ("Đang chia " + (settings ? settings.autoSplitParts : 3) + " Part") : "Tắt (1 video đơn)"
                        color: splitSwitch.checked ? Theme.success : Theme.textMuted
                        font.pixelSize: Theme.textMd
                        font.bold: true
                        Layout.fillWidth: true
                    }
                }

                RowLayout {
                    visible: splitSwitch.checked
                    spacing: 6
                    Layout.alignment: Qt.AlignRight
                    Repeater {
                        model: [
                            { label: "Chia 2 Part", parts: 2 },
                            { label: "Chia 3 Part (Khuyên dùng)", parts: 3 }
                        ]
                        delegate: Rectangle {
                            id: partBtn
                            required property var modelData
                            width: partBtnLbl.implicitWidth + 12
                            height: 22
                            radius: 3
                            readonly property bool isSel: settings && settings.autoSplitEnabled && settings.autoSplitParts === modelData.parts
                            color: isSel ? Theme.accent : Theme.surface
                            border.color: Theme.border; border.width: 1
                            Label {
                                id: partBtnLbl
                                anchors.centerIn: parent
                                text: partBtn.modelData.label
                                font.pixelSize: 10
                                color: partBtn.isSel ? "#000" : Theme.textMuted
                                font.bold: partBtn.isSel
                            }
                            MouseArea {
                                anchors.fill: parent
                                cursorShape: Qt.PointingHandCursor
                                onClicked: {
                                    if (settings) {
                                        settings.autoSplitEnabled = true
                                        settings.autoSplitParts = partBtn.modelData.parts
                                        settings.autoSplitMode = "parts"
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // ═══ BƯỚC 3: MẪU RENDER VIDEO (CHUẨN ADSPOW) ══════════════════
            RowLayout {
                spacing: 6
                Layout.fillWidth: true
                Rectangle {
                    width: 20; height: 20; radius: 10; color: Theme.accent
                    Label { anchors.centerIn: parent; text: "3"; color: "#000"; font.pixelSize: 11; font.bold: true }
                }
                Label {
                    text: "Mẫu render AdsPow"
                    color: Theme.text; font.pixelSize: Theme.textMd; font.bold: true
                }
                HelpTip {
                    text: "Khung dọc 9:16 chuẩn AdsPow: Video vuông 1:1 ở giữa, chân trang nền xanh cyan #00B4FF phẳng. Tiêu đề nướng tự động theo tên video gốc."
                }
            }
            ColumnLayout {
                Layout.preferredWidth: 260
                Layout.alignment: Qt.AlignRight
                spacing: 4

                RowLayout {
                    Layout.fillWidth: true
                    spacing: 6
                    ComboBox {
                        Layout.preferredWidth: 100
                        font.pixelSize: Theme.textSm
                        model: ["1080p", "720p"]
                        currentIndex: settings ? Math.max(0, ["1080p", "720p"].indexOf(settings.autoRenderResolution)) : 0
                        onActivated: if (settings) settings.autoRenderResolution = model[currentIndex]
                    }
                    TextField {
                        id: tplQuickInput
                        Layout.fillWidth: true
                        font.pixelSize: Theme.textSm
                        color: Theme.text
                        placeholderText: "{title}"
                        placeholderTextColor: Theme.textMuted
                        text: settings ? settings.autoRenderTitleTemplate : "{title}"
                        onEditingFinished: if (settings) settings.autoRenderTitleTemplate = text
                        background: Rectangle {
                            color: Theme.inputBg
                            border.color: parent.activeFocus ? Theme.accent : Theme.border
                            border.width: 1
                            radius: Theme.radiusMd
                        }
                    }
                }

                RowLayout {
                    spacing: 4
                    Layout.alignment: Qt.AlignRight
                    Repeater {
                        model: [
                            { label: "Chuẩn ({title})", val: "{title}", overlay: true },
                            { label: "PART {part}", val: "PART {part} - {title}", overlay: true },
                            { label: "Nền trơn", val: "", overlay: false }
                        ]
                        delegate: Rectangle {
                            id: tplBtn
                            required property var modelData
                            width: tplBtnLbl.implicitWidth + 8
                            height: 22
                            radius: 3
                            readonly property bool isSel: settings && settings.renderTitleOverlay === modelData.overlay && (!modelData.overlay || settings.autoRenderTitleTemplate === modelData.val)
                            color: isSel ? Theme.accent : Theme.surface
                            border.color: Theme.border; border.width: 1
                            Label {
                                id: tplBtnLbl
                                anchors.centerIn: parent
                                text: tplBtn.modelData.label
                                font.pixelSize: 10
                                color: tplBtn.isSel ? "#000" : Theme.textMuted
                                font.bold: tplBtn.isSel
                            }
                            MouseArea {
                                anchors.fill: parent
                                cursorShape: Qt.PointingHandCursor
                                onClicked: {
                                    if (settings) {
                                        settings.renderTitleOverlay = tplBtn.modelData.overlay
                                        if (tplBtn.modelData.val !== "") {
                                            settings.autoRenderTitleTemplate = tplBtn.modelData.val
                                            tplQuickInput.text = tplBtn.modelData.val
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // ═══ BƯỚC 4: TỰ ĐỘNG ĐĂNG TIKTOK QUA ADSPOWER (CHUẨN ADSPOW) ══
            RowLayout {
                spacing: 6
                Layout.fillWidth: true
                Rectangle {
                    width: 20; height: 20; radius: 10; color: Theme.accent
                    Label { anchors.centerIn: parent; text: "4"; color: "#000"; font.pixelSize: 11; font.bold: true }
                }
                Label {
                    text: "Đăng TikTok qua AdsPower"
                    color: Theme.text; font.pixelSize: Theme.textMd; font.bold: true
                }
                HelpTip {
                    text: "Cơ chế cuốn chiếu chuẩn AdsPow: Video hoặc từng Part render xong là AdsPower tự động nạp file vào TikTok Studio và bấm đăng ngay lập tức."
                }
            }
            ColumnLayout {
                Layout.preferredWidth: 260
                Layout.alignment: Qt.AlignRight
                spacing: 4

                RowLayout {
                    Layout.fillWidth: true
                    spacing: 8
                    Switch {
                        id: ttSwitch
                        checked: settings ? Boolean(settings.tiktokUploadEnabled) : false
                        onToggled: {
                            if (settings) {
                                settings.tiktokUploadEnabled = checked
                                if (typeof backend !== "undefined" && typeof settings.save_to_backend === "function") {
                                    settings.save_to_backend(backend)
                                }
                            }
                        }
                    }
                    Label {
                        text: ttSwitch.checked ? "BẬT (Xong part nào đăng ngay)" : "TẮT (Chỉ render lưu máy)"
                        color: ttSwitch.checked ? Theme.success : Theme.warning
                        font.pixelSize: Theme.textMd
                        font.bold: true
                        Layout.fillWidth: true
                    }
                }

                RowLayout {
                    spacing: 6
                    Layout.alignment: Qt.AlignRight

                    // Trạng thái AdsPower Local API
                    Rectangle {
                        width: 8; height: 8; radius: 4
                        color: card.adsPowerOnline ? Theme.success : Theme.error
                    }
                    Label {
                        text: card.adsPowerOnline ? "AdsPower: Online (Port 50325)" : "AdsPower: Chưa kết nối"
                        color: card.adsPowerOnline ? Theme.success : Theme.error
                        font.pixelSize: 10
                    }

                    Item { width: 4 }

                    Label {
                        text: "FastDone:"
                        color: Theme.textMuted
                        font.pixelSize: 11
                    }
                    HelpTip {
                        text: "FastDone: Bỏ qua thời gian chờ xác nhận cuối để đẩy tốc độ hoàn tất đăng siêu tốc (<0.5s)."
                    }
                    Switch {
                        checked: (settings && typeof settings.tiktokFastDone !== "undefined") ? Boolean(settings.tiktokFastDone) : true
                        onToggled: {
                            if (settings) {
                                settings.tiktokFastDone = checked
                                if (typeof backend !== "undefined" && typeof settings.save_to_backend === "function") {
                                    settings.save_to_backend(backend)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
