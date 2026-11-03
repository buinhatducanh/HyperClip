// src/ui/qml/QuickPipelineCard.qml
// Card thiết lập nhanh quy trình tự động hóa E2E (Tải -> Tách Part -> Render -> Đăng TikTok)
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

SettingsCard {
    id: card
    title: "⚡ THIẾT LẬP NHANH QUY TRÌNH (TẢI ➔ TÁCH PART ➔ RENDER ➔ ĐĂNG TIKTOK)"

    ColumnLayout {
        Layout.fillWidth: true
        spacing: Theme.spacingMd

        // ─── BANNER TÓM TẮT TRẠNG THÁI TRỰC QUAN ────────────────────────
        Rectangle {
            Layout.fillWidth: true
            Layout.preferredHeight: bannerCol.implicitHeight + 16
            radius: Theme.radiusMd
            color: Theme.surface
            border.color: Theme.accent
            border.width: 1

            ColumnLayout {
                id: bannerCol
                anchors.fill: parent
                anchors.margins: 10
                spacing: 6

                RowLayout {
                    Layout.fillWidth: true
                    spacing: 6
                    Label {
                        text: "LUỒNG THỰC THI HIỆN TẠI:"
                        color: Theme.accent
                        font.pixelSize: Theme.textSm
                        font.bold: true
                    }
                    Label {
                        text: {
                            var trimStr = (settings && settings.defaultTrimLimit < 900) ? ("Tải " + settings.defaultTrimLimit + " phút đầu") : "Tải trọn vẹn video";
                            var partStr = (settings && settings.autoSplitEnabled) ? ("Chia " + settings.autoSplitParts + " Part liên tục") : "1 Video đơn";
                            var renStr = "Render " + (settings ? settings.autoRenderResolution : "1080p") + " chuẩn AdsPow";
                            var ttStr = (settings && settings.tiktokUploadEnabled) ? "Đăng TikTok từng Part ngay khi xong" : "Chỉ lưu máy";
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
        }

        // ─── 4 BƯỚC CỐT LÕI (BẢNG THIẾT LẬP) ───────────────────────────
        GridLayout {
            columns: 2
            columnSpacing: Theme.spacingLg
            rowSpacing: Theme.spacingMd
            Layout.fillWidth: true

            // ═══ BƯỚC 1: GIỚI HẠN TẢI (TRIM LIMIT) ═══════════════════════
            ColumnLayout {
                spacing: 2
                Layout.fillWidth: true
                RowLayout {
                    spacing: 6
                    Rectangle {
                        width: 20; height: 20; radius: 10; color: Theme.accent
                        Label { anchors.centerIn: parent; text: "1"; color: "#000"; font.pixelSize: 11; font.bold: true }
                    }
                    Label {
                        text: "Chỉ tải số phút cần tải (Cắt đầu video)"
                        color: Theme.text; font.pixelSize: Theme.textMd; font.bold: true
                    }
                }
                Label {
                    text: "Ví dụ: Video gốc 20 phút, đặt 9 phút thì hệ thống chỉ tải 9 phút đầu rồi gửi sang bộ chia part. Tiết kiệm 60% thời gian tải."
                    color: Theme.textMuted; font.pixelSize: 11; wrapMode: Text.WordWrap; Layout.fillWidth: true
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
                            { label: "5 phút", val: 5 },
                            { label: "9 phút (Chuẩn)", val: 9 },
                            { label: "15 phút", val: 15 },
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
            ColumnLayout {
                spacing: 2
                Layout.fillWidth: true
                RowLayout {
                    spacing: 6
                    Rectangle {
                        width: 20; height: 20; radius: 10; color: Theme.accent
                        Label { anchors.centerIn: parent; text: "2"; color: "#000"; font.pixelSize: 11; font.bold: true }
                    }
                    Label {
                        text: "Tự động chia Part (Render liên tục)"
                        color: Theme.text; font.pixelSize: Theme.textMd; font.bold: true
                    }
                }
                Label {
                    text: "Ví dụ: Tải 9 phút và chia 3 part. Part 1 tải+render xong trước để đăng TikTok ngay, Part 2 & Part 3 tiếp tục render nền."
                    color: Theme.textMuted; font.pixelSize: 11; wrapMode: Text.WordWrap; Layout.fillWidth: true
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
                        text: splitSwitch.checked ? ("Đang chia " + (settings ? settings.autoSplitParts : 3) + " Part") : "Tắt (1 video duy nhất)"
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
            ColumnLayout {
                spacing: 2
                Layout.fillWidth: true
                RowLayout {
                    spacing: 6
                    Rectangle {
                        width: 20; height: 20; radius: 10; color: Theme.accent
                        Label { anchors.centerIn: parent; text: "3"; color: "#000"; font.pixelSize: 11; font.bold: true }
                    }
                    Label {
                        text: "Mẫu render video (Khung dọc 9:16 chuẩn AdsPow)"
                        color: Theme.text; font.pixelSize: Theme.textMd; font.bold: true
                    }
                }
                Label {
                    text: "Video vuông 1:1 ở giữa, chân trang nền xanh cyan #00B4FF phẳng. Tiêu đề nướng tự động theo tên video gốc."
                    color: Theme.textMuted; font.pixelSize: 11; wrapMode: Text.WordWrap; Layout.fillWidth: true
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
                        Layout.preferredWidth: 110
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
                            { label: "Chuẩn AdsPow ({title})", val: "{title}", overlay: true },
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

            // ═══ BƯỚC 4: TỰ ĐỘNG ĐĂNG TIKTOK THEO PART ════════════════════
            ColumnLayout {
                spacing: 2
                Layout.fillWidth: true
                RowLayout {
                    spacing: 6
                    Rectangle {
                        width: 20; height: 20; radius: 10; color: Theme.accent
                        Label { anchors.centerIn: parent; text: "4"; color: "#000"; font.pixelSize: 11; font.bold: true }
                    }
                    Label {
                        text: "Tự động đăng TikTok theo từng Part"
                        color: Theme.text; font.pixelSize: Theme.textMd; font.bold: true
                    }
                }
                Label {
                    text: "Cơ chế cuốn chiếu: Xong part nào đăng part đó ngay qua AdsPower mà không cần chờ render hết video. Kèm FastDone siêu tốc."
                    color: Theme.textMuted; font.pixelSize: 11; wrapMode: Text.WordWrap; Layout.fillWidth: true
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
                        onToggled: if (settings) settings.tiktokUploadEnabled = checked
                    }
                    Label {
                        text: ttSwitch.checked ? "BẬT (Xong part nào đăng part đó)" : "TẮT (Chỉ render lưu máy)"
                        color: ttSwitch.checked ? Theme.success : Theme.warning
                        font.pixelSize: Theme.textMd
                        font.bold: true
                        Layout.fillWidth: true
                    }
                }

                RowLayout {
                    spacing: 6
                    Layout.alignment: Qt.AlignRight
                    Label {
                        text: "FastDone (Xong ngay <0.5s):"
                        color: Theme.textMuted
                        font.pixelSize: 11
                    }
                    Switch {
                        checked: (settings && typeof settings.tiktokFastDone !== "undefined") ? Boolean(settings.tiktokFastDone) : true
                        onToggled: if (settings) settings.tiktokFastDone = checked
                    }
                }
            }
        }
    }
}
