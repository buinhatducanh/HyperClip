// src/ui/qml/DownloadCard.qml
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

SettingsCard {
    id: card
    title: "Táº¢I XUá»NG"

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
            text: "Tá»± Ä‘á»™ng táº£i"
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
                text: "Cháº¥t lÆ°á»£ng táº£i"
                color: Theme.text
                font.pixelSize: Theme.textMd
                font.bold: true
            }
            Label {
                text: "Äá»™ phĂ¢n giáº£i video má»¥c tiĂªu (vĂ­ dá»¥ 1080p, 720p)."
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
                text: "Äá»™ tuá»•i video tá»‘i Ä‘a (phĂºt)"
                color: Theme.text
                font.pixelSize: Theme.textMd
                font.bold: true
            }
            Label {
                text: "Chá»‰ táº£i video Ä‘Äƒng táº£i trong N phĂºt qua (1440 = 24h)."
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
                text: "Giới hạn thời lượng tải (phút)"
                color: Theme.text
                font.pixelSize: Theme.textMd
                font.bold: true
            }
            Label {
                text: "Chỉ tải N phút đầu của video gốc (ví dụ video 20 phút đặt 9: tải đúng 9 phút rồi đưa vào render & chia part). Đặt 999 để tải trọn vẹn."
                color: Theme.textMuted
                font.pixelSize: 11
                wrapMode: Text.WordWrap
                Layout.fillWidth: true
            }
        }
        ColumnLayout {
            Layout.preferredWidth: 160
            Layout.alignment: Qt.AlignRight
            spacing: 4
            SpinBox {
                id: trimLimitSpin
                Layout.fillWidth: true
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
            RowLayout {
                spacing: 4
                Layout.alignment: Qt.AlignRight
                Repeater {
                    model: [
                        { label: "5p", val: 5 },
                        { label: "9p", val: 9 },
                        { label: "15p", val: 15 },
                        { label: "Trọn vẹn", val: 999 }
                    ]
                    delegate: Rectangle {
                        id: trimPresetBtn
                        required property var modelData
                        width: trimPresetLbl.implicitWidth + 8
                        height: 20
                        radius: 3
                        color: (settings && settings.defaultTrimLimit === modelData.val) ? Theme.accent : Theme.surface
                        border.color: Theme.border
                        border.width: 1
                        Label {
                            id: trimPresetLbl
                            anchors.centerIn: parent
                            text: trimPresetBtn.modelData.label
                            font.pixelSize: 10
                            color: (settings && settings.defaultTrimLimit === trimPresetBtn.modelData.val) ? "#000" : Theme.textMuted
                            font.bold: settings && settings.defaultTrimLimit === trimPresetBtn.modelData.val
                        }
                        MouseArea {
                            anchors.fill: parent
                            cursorShape: Qt.PointingHandCursor
                            onClicked: {
                                if (settings) {
                                    settings.defaultTrimLimit = trimPresetBtn.modelData.val
                                    trimLimitSpin.value = trimPresetBtn.modelData.val
                                }
                            }
                        }
                    }
                }
            }
        }

        // â”€â”€â”€ Xoay vĂ²ng ngáº«u nhiĂªn thá»i lÆ°á»£ng táº£i (Min - Max) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        ColumnLayout {
            spacing: 2
            Layout.fillWidth: true
            Label {
                text: "Xoay vĂ²ng ngáº«u nhiĂªn thá»i lÆ°á»£ng táº£i (Min - Max)"
                color: Theme.text
                font.pixelSize: Theme.textMd
                font.bold: true
            }
            Label {
                text: "Tá»± Ä‘á»™ng chá»n ngáº«u nhiĂªn má»™t má»‘c thá»i lÆ°á»£ng giá»¯a Min vĂ  Max (vĂ­ dá»¥ tá»« 4 Ä‘áº¿n 5 phĂºt) cho tá»«ng video Ä‘á»ƒ trĂ¡nh trĂ¹ng láº·p Ä‘á»™ dĂ i."
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

        // â”€â”€â”€ Khá»‘i nháº­p Min / Max (Chá»‰ hiá»ƒn thá»‹ khi báº­t cĂ´ng táº¯c xoay vĂ²ng) â”€â”€â”€
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
                        text: "Khoáº£ng thá»i lÆ°á»£ng cáº¯t xoay vĂ²ng (PhĂºt)"
                        color: Theme.accent
                        font.pixelSize: Theme.textSm
                        font.bold: true
                    }
                }

                Label {
                    text: "Má»—i video sáº½ tá»± Ä‘á»™ng cáº¯t ngáº«u nhiĂªn tá»« " 
                          + Math.round(card.trimRotateMinVal) + " phĂºt Ä‘áº¿n " + Math.round(card.trimRotateMaxVal) + " phĂºt (chĂ­nh xĂ¡c theo tá»«ng giĂ¢y láº» chá»‘ng spam bot)."
                    color: Theme.textMuted
                    font.pixelSize: 11
                    wrapMode: Text.WordWrap
                    Layout.fillWidth: true
                }

                RowLayout {
                    Layout.fillWidth: true
                    spacing: 12

                    // Ă” nháº­p Min
                    RowLayout {
                        spacing: 6
                        Label {
                            text: "Tá»« (Min):"
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
                            text: "phĂºt"
                            color: Theme.textMuted
                            font.pixelSize: Theme.textSm
                        }
                    }

                    // KĂ½ hiá»‡u liĂªn káº¿t
                    Label {
                        text: "â”"
                        color: Theme.accent
                        font.pixelSize: 13
                    }

                    // Ă” nháº­p Max
                    RowLayout {
                        spacing: 6
                        Label {
                            text: "Äáº¿n (Max):"
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
                            text: "phĂºt"
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
                text: "Táº£i Ä‘á»“ng thá»i"
                color: Theme.text
                font.pixelSize: Theme.textMd
                font.bold: true
            }
            Label {
                text: "Sá»‘ luá»“ng táº£i yt-dlp song song tá»‘i Ä‘a."
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
                text: "Bá» qua VPN, káº¿t ná»‘i trá»±c tiáº¿p IP váº­t lĂ½ Ä‘á»ƒ tÄƒng tá»‘c Ä‘á»™ táº£i."
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
