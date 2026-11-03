// src/ui/qml/AutoRenderCard.qml
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

SettingsCard {
    title: "Tá»° Äá»˜NG RENDER"

    RowLayout {
        Layout.fillWidth: true
        spacing: Theme.spacingMd
        Label {
            text: "Tá»± Ä‘á»™ng render"
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
                text: "Äá»™ phĂ¢n giáº£i"
                color: Theme.text
                font.pixelSize: Theme.textMd
                font.bold: true
            }
            Label {
                text: "Äá»™ phĂ¢n giáº£i video dá»c Ä‘áº§u ra (vĂ­ dá»¥ 1080p, 720p)."
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
                text: "Khung hĂ¬nh (FPS)"
                color: Theme.text
                font.pixelSize: Theme.textMd
                font.bold: true
            }
            Label {
                text: "Tá»‘c Ä‘á»™ khung hĂ¬nh Ä‘áº§u ra (30 hoáº·c 60 fps)."
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
                text: "Tá»‘c Ä‘á»™ phĂ¡t (Speed)"
                color: Theme.text
                font.pixelSize: Theme.textMd
                font.bold: true
            }
            Label {
                text: "Tá»± Ä‘á»™ng tÄƒng tá»‘c Ä‘á»™ video (lĂ¡ch báº£n quyá»n vĂ  tÄƒng Ä‘á»™ cuá»‘n)."
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
                text: "Tá»± Ä‘á»™ng tĂ¡ch video"
                color: Theme.text
                font.pixelSize: Theme.textMd
                font.bold: true
            }
            Label {
                text: "Part 1 táº£i + render xong trÆ°á»›c vá»›i toĂ n bá»™ tĂ i nguyĂªn, sau Ä‘Ă³ tá»± táº£i tiáº¿p vĂ  render láº§n lÆ°á»£t part 2, part 3 (tá»‘i Ä‘a 3 pháº§n)."
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
                // Ghi ngÆ°á»£c giĂ¡ trá»‹ sĂ n ngay khi báº­t â€” SpinBox chá»‰ hiá»ƒn thá»‹
                // clamp chá»© khĂ´ng tá»± lÆ°u, Ä‘á»ƒ nguyĂªn parts=1/minutes=0 lĂ 
                // split khĂ´ng bao giá» cháº¡y.
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
                text: "Cháº¿ Ä‘á»™ tĂ¡ch"
                color: Theme.text
                font.pixelSize: Theme.textMd
                font.bold: true
            }
            Label {
                text: "TĂ¡ch theo sá»‘ lÆ°á»£ng pháº§n cá»‘ Ä‘á»‹nh hoáº·c theo sá»‘ phĂºt má»—i pháº§n."
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
            model: ["TĂ¡ch theo sá»‘ pháº§n", "TĂ¡ch theo thá»i lÆ°á»£ng (phĂºt)"]
            currentIndex: settings ? (settings.autoSplitMode === "minutes" ? 1 : 0) : 0
            onActivated: if (settings) settings.autoSplitMode = currentIndex === 1 ? "minutes" : "parts"
        }

        ColumnLayout {
            visible: settings ? (settings.autoSplitEnabled && settings.autoSplitMode === "parts") : false
            spacing: 2
            Layout.fillWidth: true
            Label {
                text: "Sá»‘ pháº§n tĂ¡ch"
                color: Theme.text
                font.pixelSize: Theme.textMd
                font.bold: true
            }
            Label {
                text: "Cáº¯t video gá»‘c thĂ nh N pháº§n báº±ng nhau (tá»‘i Ä‘a 3 pháº§n)."
                color: Theme.textMuted
                font.pixelSize: 11
                wrapMode: Text.WordWrap
                Layout.fillWidth: true
            }
        }
        ColumnLayout {
            visible: settings ? (settings.autoSplitEnabled && settings.autoSplitMode === "parts") : false
            Layout.preferredWidth: 180
            Layout.alignment: Qt.AlignRight
            spacing: 4
            SpinBox {
                id: splitPartsSpin
                Layout.fillWidth: true
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
            RowLayout {
                spacing: 6
                Layout.alignment: Qt.AlignRight
                Repeater {
                    model: [
                        { label: "2 Part", val: 2 },
                        { label: "3 Part", val: 3 }
                    ]
                    delegate: Rectangle {
                        id: partPresetBtn
                        required property var modelData
                        width: partPresetLbl.implicitWidth + 12
                        height: 22
                        radius: 3
                        color: (settings && settings.autoSplitParts === modelData.val) ? Theme.accent : Theme.surface
                        border.color: Theme.border
                        border.width: 1
                        Label {
                            id: partPresetLbl
                            anchors.centerIn: parent
                            text: partPresetBtn.modelData.label
                            font.pixelSize: 11
                            color: (settings && settings.autoSplitParts === partPresetBtn.modelData.val) ? "#000" : Theme.textMuted
                            font.bold: settings && settings.autoSplitParts === partPresetBtn.modelData.val
                        }
                        MouseArea {
                            anchors.fill: parent
                            cursorShape: Qt.PointingHandCursor
                            onClicked: {
                                if (settings) {
                                    settings.autoSplitParts = partPresetBtn.modelData.val
                                    splitPartsSpin.value = partPresetBtn.modelData.val
                                }
                            }
                        }
                    }
                }
            }
        }
        ColumnLayout {
            visible: settings ? (settings.autoSplitEnabled && settings.autoSplitMode === "minutes") : false
            spacing: 2
            Layout.fillWidth: true
            Label {
                text: "Sá»‘ phĂºt / pháº§n"
                color: Theme.text
                font.pixelSize: Theme.textMd
                font.bold: true
            }
            Label {
                text: "Má»—i pháº§n dĂ i N phĂºt â€” part 1 chá»‰ táº£i N phĂºt Ä‘áº§u Ä‘á»ƒ render nhanh nháº¥t; vĂ­ dá»¥ video 8:34 cáº¯t 5p â†’ part 1 = 5:00, part 2 = 3:34."
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
                text: "Mẫu render video & Tiêu đề chân trang (Chuẩn AdsPow)"
                color: Theme.text
                font.pixelSize: Theme.textMd
                font.bold: true
            }
            Label {
                text: "Bố cục chuẩn AdsPow (video vuông 1:1 ở giữa, chân trang nền xanh #00B4FF). Chọn mẫu có sẵn hoặc nhập tùy biến:"
                color: Theme.textMuted
                font.pixelSize: 11
                wrapMode: Text.WordWrap
                Layout.fillWidth: true
            }
        }
        ColumnLayout {
            Layout.preferredWidth: 260
            Layout.alignment: Qt.AlignRight
            spacing: 6

            RowLayout {
                Layout.fillWidth: true
                spacing: 8
                Switch {
                    id: overlaySwitch
                    checked: (settings && typeof settings.renderTitleOverlay !== "undefined") ? Boolean(settings.renderTitleOverlay) : true
                    onToggled: if (settings) settings.renderTitleOverlay = checked
                    ToolTip.text: checked ? "Đang nướng chữ vào video. Bấm để tắt (chỉ còn nền xanh trơn)." : "Đang TẮT chữ — thanh dưới chỉ còn nền xanh #00B4FF."
                    ToolTip.visible: hovered
                    ToolTip.delay: 400
                }
                TextField {
                    id: titleTplInput
                    Layout.fillWidth: true
                    enabled: overlaySwitch.checked
                    opacity: enabled ? 1.0 : 0.45
                    font.pixelSize: Theme.textMd
                    color: Theme.text
                    placeholderText: "Mẫu: {title}"
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

            // Nút bấm chọn nhanh mẫu
            RowLayout {
                spacing: 4
                Layout.alignment: Qt.AlignRight
                Repeater {
                    model: [
                        { label: "{title} (Chuẩn AdsPow)", val: "{title}", overlay: true },
                        { label: "PART {part}", val: "PART {part} - {title}", overlay: true },
                        { label: "Nền trơn", val: "", overlay: false }
                    ]
                    delegate: Rectangle {
                        id: tplPresetBtn
                        required property var modelData
                        width: tplPresetLbl.implicitWidth + 8
                        height: 20
                        radius: 3
                        readonly property bool isSelected: (settings && settings.renderTitleOverlay === modelData.overlay && (!modelData.overlay || settings.autoRenderTitleTemplate === modelData.val))
                        color: isSelected ? Theme.accent : Theme.surface
                        border.color: Theme.border
                        border.width: 1
                        Label {
                            id: tplPresetLbl
                            anchors.centerIn: parent
                            text: tplPresetBtn.modelData.label
                            font.pixelSize: 10
                            color: tplPresetBtn.isSelected ? "#000" : Theme.textMuted
                            font.bold: tplPresetBtn.isSelected
                        }
                        MouseArea {
                            anchors.fill: parent
                            cursorShape: Qt.PointingHandCursor
                            onClicked: {
                                if (settings) {
                                    settings.renderTitleOverlay = tplPresetBtn.modelData.overlay
                                    overlaySwitch.checked = tplPresetBtn.modelData.overlay
                                    if (tplPresetBtn.modelData.val !== "") {
                                        settings.autoRenderTitleTemplate = tplPresetBtn.modelData.val
                                        titleTplInput.text = tplPresetBtn.modelData.val
                                    }
                                }
                            }
                        }
                    }
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
                text: "Sá»‘ lÆ°á»£ng tiáº¿n trĂ¬nh render FFmpeg cháº¡y Ä‘á»“ng thá»i (khuyĂªn dĂ¹ng 2)."
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

        // Pass 119 â€” HAI NĂM E2E TRÆ¯á»C ÄĂ‚Y CHá»ˆ CĂ“ á» CARD SHORTS.
        //
        // Pass 105 Ä‘Æ°a `renderMaxrateMbps` + `tiktokFastDone` ra UI, nhÆ°ng Ä‘áº·t
        // trong ShortsSettingsCard. Tá»« Pass 104 trang CĂ i Ä‘áº·t chá»‰ hiá»‡n card cá»§a
        // LĂ€N ÄANG Báº¬T, nĂªn mĂ¡y cháº¡y lĂ n Video dĂ i (Shorts=Táº®T) KHĂ”NG BAO GIá»œ
        // báº¥m tá»›i Ä‘Æ°á»£c hai nĂºm nĂ y â€” Ä‘Ăºng cĂ¡i báº«y mĂ  Pass 105 sinh ra Ä‘á»ƒ chá»¯a:
        // thá»© gĂ¬ áº£nh hÆ°á»Ÿng e2e pháº£i cĂ³ trong UI, vĂ  "cĂ³ trong UI" nghÄ©a lĂ  cĂ³ á»Ÿ
        // lĂ n mĂ  mĂ¡y Ä‘Ă³ Ä‘ang cháº¡y.
        ColumnLayout {
            spacing: 2
            Layout.fillWidth: true
            Label {
                text: "Tráº§n bitrate render (Mbps)"
                color: Theme.text; font.pixelSize: Theme.textMd; font.bold: true
            }
            Label {
                text: "0 = tá»± Ä‘á»™ng theo card. Vá»›i part video dĂ i, Ä‘Ă¢y lĂ  Ä‘Ă²n báº©y ÄO ÄÆ¯á»¢C: "
                      + "file 120 MB thĂ¬ TikTok xá»­ lĂ½ 2,9s, cĂ²n 57â€“91 MB chá»‰ 1,1â€“2,0s. "
                      + "Äáº·t 3 rá»“i XEM THá»¬ video Ä‘áº§u â€” TikTok vá»‘n nĂ©n láº¡i cĂ²n ~1 Mbps. "
                      + "Náº¥c 1 dĂ nh cho khi cáº§n Ă©p giĂ¢y tá»‘i Ä‘a: PHáº¢I xem thá»­ báº±ng máº¯t trÆ°á»›c, "
                      + "720p á»Ÿ 1 Mbps dá»… lá»™ khá»‘i á»Ÿ cáº£nh chuyá»ƒn Ä‘á»™ng."
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
                text: "ÄÄƒng TikTok: xong ngay khi gá»­i lá»‡nh Ä‘Äƒng"
                color: Theme.text; font.pixelSize: Theme.textMd; font.bold: true
            }
            Label {
                text: "KhĂ´ng chá» TikTok chuyá»ƒn trang xĂ¡c nháº­n. Äo trĂªn mĂ¡y khĂ¡ch: cháº·ng "
                      + "xĂ¡c nháº­n 1,5â€“2,1s xuá»‘ng cĂ²n 0,5â€“0,7s. ÄĂ¡nh Ä‘á»•i: náº¿u TikTok há»ng "
                      + "SAU cĂº báº¥m ÄÄƒng thĂ¬ app Ä‘Ă£ bĂ¡o xong â€” log ghi rĂµ \"fastDone\"."
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
