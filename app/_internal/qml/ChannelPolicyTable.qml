// src/ui/qml/ChannelPolicyTable.qml

// Pass 56 — Bảng chính sách quét từng kênh.

//

// Ý tưởng cốt lõi: khách khai "kênh này chỉ đăng 1 video/ngày" → sau khi bắt đủ,

// kênh chuyển sang quét thưa và trả ngân sách units cho các kênh còn lại (nhịp

// của chúng tự siết lại). Bảng này là chỗ khai và là chỗ nhìn thấy hiệu quả.

//

// Redesign v2: cột thẳng hàng TUYỆT ĐỐI — mọi cell width cố định trừ tên kênh

// (fillWidth + preferredWidth 0). Bản v1 để cell tên ăn theo implicitWidth nên

// tên dài (kênh Nhật) đẩy lệch cả hàng. Header dùng chung hằng số width với

// hàng nên không thể lệch. Filter/pagination chạy trên `policyChannelModel`

// (instance riêng, lọc phía model TRƯỚC phân trang).

import QtQuick

import QtQuick.Layouts

import QtQuick.Controls



Rectangle {

    id: root

    color: Theme.cardBg

    border.color: Theme.border

    border.width: 1

    radius: Theme.radiusLg



    // Cột cố định — header và hàng dùng CHUNG các số này.

    readonly property int colPolicy: 132

    readonly property int colState: 108

    readonly property int colToday: 64

    readonly property int colActions: 154



    function stateColor(s) {

        switch (s) {

            case "dual": return "#00E5FF"

            case "hot": return "#FF9F45"

            case "scanning": return Theme.accent

            case "satisfied": return Theme.success

            case "outside_window": return "#A78BFA"

            default: return Theme.textMuted

        }

    }

    function stateText(s) {

        switch (s) {

            case "dual": return "ĐUA KÉP"

            case "hot": return "ƯU TIÊN"

            case "scanning": return "ĐANG SOI"

            case "satisfied": return "ĐÃ ĐỦ"

            case "outside_window": return "NGOÀI KHUNG"

            case "off": return "TẮT"

            default: return "TẠM DỪNG"

        }

    }

    function policyText(p, limit, ws, we) {

        switch (p) {

            case "daily": return limit + "/ngày"

            case "window": return (ws && we) ? (ws + "–" + we) : "Khung giờ"

            case "off": return "Không soi"

            default: return "Liên tục"

        }

    }



    /// Mọi mutation đi qua đây: hoãn ra khỏi stack sự kiện chuột (send_command

    /// đồng bộ spin nested loop → model reset → delegate bị hủy giữa lúc đang

    /// xử lý click — đúng lớp crash 18/07), xong nạp lại CẢ HAI instance model

    /// kênh + số liệu quota.

    function applyPolicy(chId, params) {

        Qt.callLater(function() {

            params["id"] = chId

            backend.send_command("channel:setPolicy", params)

            if (policyChannelModel) policyChannelModel.load_from_backend(backend)

            if (typeof channelListModel !== "undefined" && channelListModel) {

                channelListModel.load_from_backend(backend)

            }

            if (typeof quota !== "undefined" && quota) quota.refresh_from_backend(backend)

        })

    }



    function applyHot(chId, next) {

        if (policyChannelModel) policyChannelModel.set_hot(backend, chId, next)

        if (typeof channelListModel !== "undefined" && channelListModel) {

            channelListModel.load_from_backend(backend)

        }

        if (typeof quota !== "undefined" && quota) quota.refresh_from_backend(backend)

    }





function applyStandard(chId, next) {
        if (backend && typeof backend.send_command === "function") {
            var resp = backend.send_command("channel:setStandard", { "id": chId, "value": next });
            if (resp && resp.ok === false && resp.error) {
                if (typeof toastService !== "undefined" && toastService) {
                    toastService.show("Giới hạn Kênh chuẩn", resp.error, "warning");
                }
                return;
            }
        }
        if (policyChannelModel) {
            if (typeof policyChannelModel.set_standard === "function") {
                policyChannelModel.set_standard(backend, chId, next);
            } else if (typeof policyChannelModel.set_cdp === "function") {
                policyChannelModel.set_cdp(backend, chId, next);
            }
        }
        if (typeof channelListModel !== "undefined" && channelListModel) {
            channelListModel.load_from_backend(backend);
        }
        if (typeof quota !== "undefined" && quota) quota.refresh_from_backend(backend);
    }

    function applyReopen(chId) {

        if (policyChannelModel) policyChannelModel.reopen_today(backend, chId)

        if (typeof channelListModel !== "undefined" && channelListModel) {

            channelListModel.load_from_backend(backend)

        }

        if (typeof quota !== "undefined" && quota) quota.refresh_from_backend(backend)

    }



    // ─── Popup chỉnh chính sách ────────────────────────────────────

    // Đặt ở gốc bảng, KHÔNG lồng trong delegate — popup trong delegate bị hủy

    // theo delegate khi model reset (cùng lý do GcpWizard nằm ở gốc panel).

    // ─── Popup chỉnh chính sách (Redesign v2) ─────────────────────

    Popup {

        id: policyEditor

        modal: true

        focus: true

        closePolicy: Popup.CloseOnEscape | Popup.CloseOnPressOutside

        anchors.centerIn: Overlay.overlay

        width: 500

        padding: 20



        property string chId: ""

        property string chName: ""

        // "continuous" | "daily" | "window" | "off"

        property string mode: "continuous"



        function openFor(id, name, policy, limit, ws, we, sweep) {

            chId = id

            chName = name

            mode = (policy === "" ? "continuous" : policy)

            dailySpin.value = Math.max(1, limit || 1)

            winStart.text = ws || "18:00"

            winEnd.text = we || "23:00"

            sweepCheck.checked = sweep

            open()

        }



        background: Rectangle {

            color: Theme.cardBg

            border.color: Theme.border

            border.width: 1

            radius: Theme.radiusLg

        }



        contentItem: ColumnLayout {

            spacing: 14



            // Header

            RowLayout {

                Layout.fillWidth: true

                spacing: 10

                Rectangle {

                    width: 32; height: 32; radius: 8

                    color: Theme.accent + "20"

                    border.color: Theme.accent + "60"

                    border.width: 1

                    Icon {

                        name: "settings"

                        size: 16

                        color: Theme.accent

                        anchors.centerIn: parent

                    }

                }

                ColumnLayout {

                    Layout.fillWidth: true

                    spacing: 2

                    Label {

                        text: "CHÍNH SÁCH QUÉT KÊNH"

                        color: Theme.textMuted

                        font.pixelSize: 10

                        font.bold: true

                        font.letterSpacing: 0.8

                    }

                    Label {

                        text: policyEditor.chName

                        color: Theme.text

                        font.pixelSize: 15

                        font.bold: true

                        elide: Text.ElideRight

                        Layout.fillWidth: true

                    }

                }

                IconButton {

                    iconName: "close"

                    iconSize: 12

                    Layout.preferredWidth: 28

                    Layout.preferredHeight: 28

                    onClicked: policyEditor.close()

                }

            }



            Rectangle {

                Layout.fillWidth: true; Layout.preferredHeight: 1; color: Theme.border

            }



            // Danh sách các cơ chế quét dạng Card tương tác

            ColumnLayout {

                Layout.fillWidth: true

                spacing: 8



                // 1. Quét liên tục (Mặc định)

                Rectangle {

                    id: cardContinuous

                    Layout.fillWidth: true

                    Layout.preferredHeight: 52

                    radius: Theme.radiusMd

                    color: policyEditor.mode === "continuous" ? (Theme.accent + "18") : (contMa.containsMouse ? Theme.rowHover : Theme.inputBg)

                    border.color: policyEditor.mode === "continuous" ? Theme.accent : Theme.border

                    border.width: policyEditor.mode === "continuous" ? 2 : 1



                    MouseArea {

                        id: contMa

                        anchors.fill: parent

                        hoverEnabled: true

                        cursorShape: Qt.PointingHandCursor

                        onClicked: policyEditor.mode = "continuous"

                    }



                    RowLayout {

                        anchors.fill: parent

                        anchors.margins: 10

                        spacing: 10

                        Rectangle {

                            width: 18; height: 18; radius: 9

                            color: "transparent"

                            border.color: policyEditor.mode === "continuous" ? Theme.accent : Theme.textMuted

                            border.width: 2

                            Rectangle {

                                width: 8; height: 8; radius: 4

                                color: Theme.accent

                                anchors.centerIn: parent

                                visible: policyEditor.mode === "continuous"

                            }

                        }

                        ColumnLayout {

                            Layout.fillWidth: true

                            spacing: 1

                            RowLayout {

                                spacing: 6

                                Label {

                                    text: "Quét liên tục"

                                    color: policyEditor.mode === "continuous" ? Theme.accent : Theme.text

                                    font.pixelSize: 13

                                    font.bold: true

                                }

                                Rectangle {

                                    radius: 3

                                    color: Theme.accent + "25"

                                    Layout.preferredHeight: 16

                                    Layout.preferredWidth: 42

                                    Label {

                                        anchors.centerIn: parent

                                        text: "Mặc định"

                                        color: Theme.accent

                                        font.pixelSize: 9

                                        font.bold: true

                                    }

                                }

                            }

                            Label {

                                text: "Quét theo chu kỳ nhịp bình thường, bắt video ngay khi xuất bản."

                                color: Theme.textMuted

                                font.pixelSize: 10

                            }

                        }

                    }

                }



                // 2. Theo chỉ tiêu ngày

                Rectangle {

                    id: cardDaily

                    Layout.fillWidth: true

                    Layout.preferredHeight: policyEditor.mode === "daily" ? 116 : 52

                    radius: Theme.radiusMd

                    color: policyEditor.mode === "daily" ? (Theme.accent + "18") : (dailyMa.containsMouse ? Theme.rowHover : Theme.inputBg)

                    border.color: policyEditor.mode === "daily" ? Theme.accent : Theme.border

                    border.width: policyEditor.mode === "daily" ? 2 : 1

                    clip: true

                    Behavior on Layout.preferredHeight { NumberAnimation { duration: 150 } }



                    MouseArea {

                        id: dailyMa

                        anchors.fill: parent

                        hoverEnabled: true

                        cursorShape: Qt.PointingHandCursor

                        onClicked: policyEditor.mode = "daily"

                    }



                    ColumnLayout {

                        anchors.fill: parent

                        anchors.margins: 10

                        spacing: 8



                        RowLayout {

                            Layout.fillWidth: true

                            spacing: 10

                            Rectangle {

                                width: 18; height: 18; radius: 9

                                color: "transparent"

                                border.color: policyEditor.mode === "daily" ? Theme.accent : Theme.textMuted

                                border.width: 2

                                Rectangle {

                                    width: 8; height: 8; radius: 4

                                    color: Theme.accent

                                    anchors.centerIn: parent

                                    visible: policyEditor.mode === "daily"

                                }

                            }

                            ColumnLayout {

                                Layout.fillWidth: true

                                spacing: 1

                                Label {

                                    text: "Chỉ tiêu theo ngày (Daily Limit)"

                                    color: policyEditor.mode === "daily" ? Theme.accent : Theme.text

                                    font.pixelSize: 13

                                    font.bold: true

                                }

                                Label {

                                    text: "Dừng soi sau khi đã tải đủ số lượng video đặt ra trong ngày."

                                    color: Theme.textMuted

                                    font.pixelSize: 10

                                }

                            }

                        }



                        // Tuỳ chọn mở rộng khi chọn Daily

                        RowLayout {

                            visible: policyEditor.mode === "daily"

                            Layout.fillWidth: true

                            Layout.leftMargin: 28

                            spacing: 8



                            Label { text: "Chỉ tiêu:"; color: Theme.text; font.pixelSize: 11; font.bold: true }



                            // Quick stepper

                            IconButton {

                                iconName: "remove"

                                iconSize: 10

                                Layout.preferredWidth: 26; Layout.preferredHeight: 24

                                onClicked: if (dailySpin.value > 1) dailySpin.value -= 1

                            }

                            SpinBox {

                                id: dailySpin

                                from: 1; to: 50

                                editable: true

                                Layout.preferredWidth: 80

                                Layout.preferredHeight: 26

                            }

                            IconButton {

                                iconName: "add"

                                iconSize: 10

                                Layout.preferredWidth: 26; Layout.preferredHeight: 24

                                onClicked: if (dailySpin.value < 50) dailySpin.value += 1

                            }

                            Label { text: "video/ngày"; color: Theme.textMuted; font.pixelSize: 11 }



                            Item { Layout.fillWidth: true }



                            // Quick preset pills

                            RowLayout {

                                spacing: 4

                                Repeater {

                                    model: [1, 2, 3, 5]

                                    delegate: Rectangle {

                                        width: 24; height: 22; radius: 4

                                        color: dailySpin.value === modelData ? Theme.accent : (Theme.cardBg)

                                        border.color: dailySpin.value === modelData ? Theme.accent : Theme.border

                                        border.width: 1

                                        Label {

                                            anchors.centerIn: parent

                                            text: modelData

                                            color: dailySpin.value === modelData ? "#000" : Theme.text

                                            font.pixelSize: 10

                                            font.bold: true

                                        }

                                        MouseArea {

                                            anchors.fill: parent

                                            cursorShape: Qt.PointingHandCursor

                                            onClicked: dailySpin.value = modelData

                                        }

                                    }

                                }

                            }

                        }



                        CheckBox {

                            id: sweepCheck

                            visible: policyEditor.mode === "daily"

                            Layout.leftMargin: 28

                            text: "Vẫn quét thưa (10 phút/lần) sau khi đủ để phòng video đột xuất"

                            font.pixelSize: 10

                        }

                    }

                }



                // 3. Theo khung giờ cố định

                Rectangle {

                    id: cardWindow

                    Layout.fillWidth: true

                    Layout.preferredHeight: policyEditor.mode === "window" ? 116 : 52

                    radius: Theme.radiusMd

                    color: policyEditor.mode === "window" ? (Theme.accent + "18") : (winMa.containsMouse ? Theme.rowHover : Theme.inputBg)

                    border.color: policyEditor.mode === "window" ? Theme.accent : Theme.border

                    border.width: policyEditor.mode === "window" ? 2 : 1

                    clip: true

                    Behavior on Layout.preferredHeight { NumberAnimation { duration: 150 } }



                    MouseArea {

                        id: winMa

                        anchors.fill: parent

                        hoverEnabled: true

                        cursorShape: Qt.PointingHandCursor

                        onClicked: policyEditor.mode = "window"

                    }



                    ColumnLayout {

                        anchors.fill: parent

                        anchors.margins: 10

                        spacing: 8



                        RowLayout {

                            Layout.fillWidth: true

                            spacing: 10

                            Rectangle {

                                width: 18; height: 18; radius: 9

                                color: "transparent"

                                border.color: policyEditor.mode === "window" ? Theme.accent : Theme.textMuted

                                border.width: 2

                                Rectangle {

                                    width: 8; height: 8; radius: 4

                                    color: Theme.accent

                                    anchors.centerIn: parent

                                    visible: policyEditor.mode === "window"

                                }

                            }

                            ColumnLayout {

                                Layout.fillWidth: true

                                spacing: 1

                                Label {

                                    text: "Theo khung giờ phát sóng (Giờ VN UTC+7)"

                                    color: policyEditor.mode === "window" ? Theme.accent : Theme.text

                                    font.pixelSize: 13

                                    font.bold: true

                                }

                                Label {

                                    text: "Chỉ tập trung soi vào giờ kênh hay đăng bài, tiết kiệm Quota ngoài giờ."

                                    color: Theme.textMuted

                                    font.pixelSize: 10

                                }

                            }

                        }



                        // Tuỳ chọn giờ mở rộng khi chọn Window

                        RowLayout {

                            visible: policyEditor.mode === "window"

                            Layout.fillWidth: true

                            Layout.leftMargin: 28

                            spacing: 8



                            Label { text: "Từ:"; color: Theme.text; font.pixelSize: 11; font.bold: true }



                            TextField {

                                id: winStart

                                placeholderText: "18:00"

                                Layout.preferredWidth: 68

                                Layout.preferredHeight: 26

                                color: Theme.text

                                font.pixelSize: 12

                                font.family: "monospace"

                                horizontalAlignment: Text.AlignHCenter

                                validator: RegularExpressionValidator { regularExpression: /^([01]?\d|2[0-3]):[0-5]\d$/ }

                                background: Rectangle {

                                    color: Theme.inputBg

                                    border.color: winStart.activeFocus ? Theme.accent

                                        : (winStart.acceptableInput || !winStart.text ? Theme.border : Theme.error)

                                    border.width: 1

                                    radius: Theme.radiusSm

                                }

                            }

                            Label { text: "đến:"; color: Theme.text; font.pixelSize: 11; font.bold: true }

                            TextField {

                                id: winEnd

                                placeholderText: "23:00"

                                Layout.preferredWidth: 68

                                Layout.preferredHeight: 26

                                color: Theme.text

                                font.pixelSize: 12

                                font.family: "monospace"

                                horizontalAlignment: Text.AlignHCenter

                                validator: RegularExpressionValidator { regularExpression: /^([01]?\d|2[0-3]):[0-5]\d$/ }

                                background: Rectangle {

                                    color: Theme.inputBg

                                    border.color: winEnd.activeFocus ? Theme.accent

                                        : (winEnd.acceptableInput || !winEnd.text ? Theme.border : Theme.error)

                                    border.width: 1

                                    radius: Theme.radiusSm

                                }

                            }



                            Item { Layout.fillWidth: true }



                            // Presets

                            RowLayout {

                                spacing: 4

                                component PresetBtn: Rectangle {

                                    property string startT: ""

                                    property string endT: ""

                                    property string labelT: ""

                                    width: 70; height: 24; radius: 4

                                    color: (winStart.text === startT && winEnd.text === endT) ? (Theme.accent + "30") : Theme.cardBg

                                    border.color: (winStart.text === startT && winEnd.text === endT) ? Theme.accent : Theme.border

                                    border.width: 1

                                    Label {

                                        anchors.centerIn: parent

                                        text: labelT

                                        color: (winStart.text === startT && winEnd.text === endT) ? Theme.accent : Theme.textMuted

                                        font.pixelSize: 9

                                        font.bold: true

                                    }

                                    MouseArea {

                                        anchors.fill: parent

                                        cursorShape: Qt.PointingHandCursor

                                        onClicked: {

                                            winStart.text = startT

                                            winEnd.text = endT

                                        }

                                    }

                                }

                                PresetBtn { startT: "11:30"; endT: "13:30"; labelT: "11h30-13h30" }

                                PresetBtn { startT: "18:00"; endT: "21:00"; labelT: "18h-21h" }

                                PresetBtn { startT: "19:00"; endT: "23:30"; labelT: "19h-23h30" }

                            }

                        }



                        Label {

                            visible: policyEditor.mode === "window"

                            Layout.leftMargin: 28

                            text: "Hỗ trợ cả khung giờ xuyên đêm (ví dụ: 22:00 → 02:00)."

                            color: Theme.textMuted

                            font.pixelSize: 9

                        }

                    }

                }



                // 4. Không soi (Tắt)

                Rectangle {

                    id: cardOff

                    Layout.fillWidth: true

                    Layout.preferredHeight: 50

                    radius: Theme.radiusMd

                    color: policyEditor.mode === "off" ? (Theme.error + "18") : (offMa.containsMouse ? Theme.rowHover : Theme.inputBg)

                    border.color: policyEditor.mode === "off" ? Theme.error : Theme.border

                    border.width: policyEditor.mode === "off" ? 2 : 1



                    MouseArea {

                        id: offMa

                        anchors.fill: parent

                        hoverEnabled: true

                        cursorShape: Qt.PointingHandCursor

                        onClicked: policyEditor.mode = "off"

                    }



                    RowLayout {

                        anchors.fill: parent

                        anchors.margins: 10

                        spacing: 10

                        Rectangle {

                            width: 18; height: 18; radius: 9

                            color: "transparent"

                            border.color: policyEditor.mode === "off" ? Theme.error : Theme.textMuted

                            border.width: 2

                            Rectangle {

                                width: 8; height: 8; radius: 4

                                color: Theme.error

                                anchors.centerIn: parent

                                visible: policyEditor.mode === "off"

                            }

                        }

                        ColumnLayout {

                            Layout.fillWidth: true

                            spacing: 1

                            Label {

                                text: "Tạm dừng quét kênh này"

                                color: policyEditor.mode === "off" ? Theme.error : Theme.text

                                font.pixelSize: 13

                                font.bold: true

                            }

                            Label {

                                text: "Không sử dụng Quota, nhường tài nguyên cho các kênh trọng tâm khác."

                                color: Theme.textMuted

                                font.pixelSize: 10

                            }

                        }

                    }

                }

            }



            // Footer

            RowLayout {

                Layout.fillWidth: true

                Layout.topMargin: 6

                spacing: 8



                Item { Layout.fillWidth: true }



                IconButton {

                    iconName: "close"

                    label: "Hủy"

                    iconSize: 11

                    Layout.preferredHeight: 30

                    Layout.preferredWidth: 80

                    onClicked: policyEditor.close()

                }



                IconButton {

                    iconName: "check"

                    label: "Lưu chính sách"

                    iconSize: 11

                    Layout.preferredHeight: 30

                    Layout.minimumWidth: 120

                    colorIdle: Theme.accent + "25"

                    colorHover: Theme.accent + "45"

                    border.color: Theme.accent

                    enabled: policyEditor.mode !== "window"

                             || (winStart.acceptableInput && winEnd.acceptableInput)

                    onClicked: {

                        let params = {"pollPolicy": policyEditor.mode, "dailyLimit": 0}

                        if (policyEditor.mode === "daily") {

                            params["dailyLimit"] = dailySpin.value

                            params["safetySweep"] = sweepCheck.checked

                        } else if (policyEditor.mode === "window") {

                            params["windowStart"] = winStart.text

                            params["windowEnd"] = winEnd.text

                        }

                        root.applyPolicy(policyEditor.chId, params)

                        policyEditor.close()

                    }

                }

            }

        }

    }



    ColumnLayout {

        anchors.fill: parent

        anchors.margins: 12

        spacing: 8



        // ─── Đầu bảng ──────────────────────────────────────────────

        RowLayout {

            Layout.fillWidth: true

            spacing: 8

            Label {

                text: "CHÍNH SÁCH QUÉT THEO KÊNH"

                color: Theme.accent

                font.pixelSize: 13

                font.bold: true

                font.letterSpacing: 0.6

            }

            Item { Layout.fillWidth: true }



            // Ô tìm kênh — 100 kênh thì không thể chỉ lật trang tay.

            Rectangle {

                Layout.preferredWidth: 160

                Layout.preferredHeight: 24

                color: Theme.inputBg

                border.color: searchField.activeFocus ? Theme.accent : Theme.border

                border.width: 1

                radius: 12

                RowLayout {

                    anchors.fill: parent

                    anchors.leftMargin: 8

                    anchors.rightMargin: 8

                    spacing: 4

                    Icon { name: "search"; size: 11; color: Theme.textMuted }

                    TextInput {

                        id: searchField

                        Layout.fillWidth: true

                        color: Theme.text

                        font.pixelSize: 11

                        clip: true

                        onTextChanged: {

                            const t = text.trim()

                            Qt.callLater(function() { policyChannelModel.filterText = t })

                        }

                        Text {

                            anchors.fill: parent

                            visible: !searchField.text

                            text: "Tìm kênh…"

                            color: Theme.textMuted

                            font.pixelSize: 11

                            verticalAlignment: Text.AlignVCenter

                        }

                    }

                }

            }



            Repeater {

                model: [

                    {key: "all", label: "Tất cả"},

                    {key: "scanning", label: "Đang soi"},

                    {key: "satisfied", label: "Đã đủ"},

                    {key: "off", label: "Nghỉ"}

                ]

                delegate: Rectangle {

                    readonly property bool active: policyChannelModel

                        && policyChannelModel.stateFilter === modelData.key

                    readonly property int pillCount: {

                        if (!policyChannelModel) return 0

                        if (modelData.key === "all") return policyChannelModel.countAll

                        if (modelData.key === "scanning") return policyChannelModel.countScanning

                        if (modelData.key === "satisfied") return policyChannelModel.countSatisfied

                        return policyChannelModel.countOff

                    }

                    Layout.preferredHeight: 22

                    Layout.preferredWidth: pillLabel.implicitWidth + 18

                    radius: 11

                    color: active ? Theme.accent + "25" : "transparent"

                    border.color: active ? Theme.accent : Theme.border

                    border.width: 1

                    Label {

                        id: pillLabel

                        anchors.centerIn: parent

                        text: modelData.label + " " + parent.pillCount

                        color: active ? Theme.accent : Theme.textMuted

                        font.pixelSize: 10

                        font.bold: active

                    }

                    MouseArea {

                        anchors.fill: parent

                        cursorShape: Qt.PointingHandCursor

                        onClicked: {

                            const k = modelData.key

                            // Đổi filter reset model → hoãn ra khỏi stack click.

                            Qt.callLater(function() { policyChannelModel.stateFilter = k })

                        }

                    }

                }

            }

        }



        Label {

            Layout.fillWidth: true

            wrapMode: Text.WordWrap

            text: "Kênh đặt \"n/ngày\" sẽ ngừng soi dày sau khi bắt đủ n video — ngân sách quota chuyển sang các kênh còn lại (vẫn quét lại 10 phút/lần để không bỏ sót). Bấm ⚡ để ưu tiên ETag 304 (<50ms, tiết kiệm Quota). Bấm ★ để mở tab CDP Chrome (<1s). Có thể bật CẢ HAI cùng lúc (ĐUA KÉP) — cơ chế nào phát hiện trước sẽ bắt ngay lập tức không bị trùng lặp!"

            color: Theme.textMuted

            font.pixelSize: 11

        }



        // ─── Tiêu đề cột ───────────────────────────────────────────

        // Cùng lề 8px + cùng bộ hằng số width với hàng — không thể lệch.

        RowLayout {

            Layout.fillWidth: true

            Layout.leftMargin: 8

            Layout.rightMargin: 8

            Layout.topMargin: 2

            spacing: 8

            RowLayout {

                Layout.fillWidth: true

                Layout.preferredWidth: 0

                spacing: 6

                Item { Layout.preferredWidth: 7 }

                Label {

                    text: "KÊNH"

                    color: Theme.textMuted; font.pixelSize: 9; font.bold: true

                    Layout.fillWidth: true

                    Layout.minimumWidth: 0

                }

            }

            Label { text: "CHÍNH SÁCH"; color: Theme.textMuted; font.pixelSize: 9; font.bold: true; Layout.preferredWidth: root.colPolicy }

            Label { text: "TRẠNG THÁI"; color: Theme.textMuted; font.pixelSize: 9; font.bold: true; Layout.preferredWidth: root.colState }

            Label { text: "HÔM NAY"; color: Theme.textMuted; font.pixelSize: 9; font.bold: true; Layout.preferredWidth: root.colToday; horizontalAlignment: Text.AlignHCenter }

            Label { text: "HÀNH ĐỘNG"; color: Theme.textMuted; font.pixelSize: 9; font.bold: true; Layout.preferredWidth: root.colActions }

        }



        Rectangle { Layout.fillWidth: true; Layout.preferredHeight: 1; color: Theme.border }



        // ─── Danh sách ─────────────────────────────────────────────

        ListView {

            id: list

            Layout.fillWidth: true

            Layout.fillHeight: true

            Layout.minimumHeight: 120

            model: policyChannelModel

            clip: true

            spacing: 1

            boundsBehavior: Flickable.StopAtBounds

            ScrollBar.vertical: ScrollBar { }



            delegate: Rectangle {

                id: row

                width: list.width

                height: 36

                radius: 3

                color: rowMa.containsMouse ? Theme.hoverBg

                     : (index % 2 === 0 ? Theme.rowEven : "transparent")



                // Sao chép giá trị model lên delegate: trong closure/Popup,

                // `model` của delegate đã chết thì đọc thẳng trả undefined.

                readonly property string chId: model.id

                readonly property string chName: model.name

                readonly property string chPolicy: model.pollPolicy

                readonly property int chDailyLimit: model.dailyLimit

                readonly property int chCaught: model.caughtToday

                readonly property string chState: model.scanState

                readonly property bool chHot: model.fastProbe

                readonly property bool chStandard: (typeof model.isStandard !== "undefined" && model.isStandard) || (typeof model.cdpEnabled !== "undefined" && model.cdpEnabled) || false

                readonly property string chWinStart: model.windowStart

                readonly property string chWinEnd: model.windowEnd

                readonly property bool chSweep: model.safetySweep



                MouseArea {

                    id: rowMa

                    anchors.fill: parent

                    hoverEnabled: true

                    acceptedButtons: Qt.NoButton

                }



                RowLayout {

                    anchors.fill: parent

                    anchors.leftMargin: 8

                    anchors.rightMargin: 8

                    spacing: 8



                    // Kênh — preferredWidth 0: chia chỗ theo fill, KHÔNG theo độ

                    // dài tên (tên Nhật dài từng đẩy lệch cả hàng — bug v1).

                    RowLayout {

                        Layout.fillWidth: true

                        Layout.preferredWidth: 0

                        spacing: 6

                        StatusDot {

                            state: row.chState === "satisfied" ? "ready"

                                 : row.chState === "scanning" || row.chState === "hot" || row.chState === "dual" ? "running"

                                 : "idle"

                            size: 7

                            showRing: row.chState === "scanning" || row.chState === "hot" || row.chState === "dual"

                        }

                        Label {

                            visible: row.chStandard

                            text: "★"

                            color: "#00E5FF"

                            font.pixelSize: 10

                            font.bold: true

                            ToolTip.text: "Kênh chuẩn (giám sát CDP <1s)"

                            ToolTip.visible: stdIconMa.containsMouse

                            ToolTip.delay: 300

                            MouseArea {

                                id: stdIconMa

                                anchors.fill: parent

                                hoverEnabled: true

                            }

                        }

                        Label {

                            text: row.chName

                            color: Theme.text

                            font.pixelSize: 12

                            elide: Text.ElideRight

                            Layout.fillWidth: true

                            Layout.minimumWidth: 0

                        }

                    }



                    // Chính sách — nút mở popup chỉnh (đặt được n/ngày tự do và

                    // khung giờ, hai thứ ComboBox cũ không làm được).

                    Rectangle {

                        Layout.preferredWidth: root.colPolicy

                        Layout.preferredHeight: 26

                        radius: Theme.radiusMd

                        color: polMa.containsMouse ? Theme.hoverBg : Theme.bg

                        border.color: polMa.containsMouse ? Theme.accent : Theme.border

                        border.width: 1

                        RowLayout {

                            anchors.fill: parent

                            anchors.leftMargin: 8

                            anchors.rightMargin: 6

                            spacing: 4

                            Label {

                                text: root.policyText(row.chPolicy, row.chDailyLimit,

                                                      row.chWinStart, row.chWinEnd)

                                color: Theme.text

                                font.pixelSize: 11

                                elide: Text.ElideRight

                                Layout.fillWidth: true

                                Layout.minimumWidth: 0

                            }

                            Icon { name: "edit"; size: 10; color: Theme.textMuted }

                        }

                        MouseArea {

                            id: polMa

                            anchors.fill: parent

                            hoverEnabled: true

                            cursorShape: Qt.PointingHandCursor

                            onClicked: policyEditor.openFor(

                                row.chId, row.chName, row.chPolicy, row.chDailyLimit,

                                row.chWinStart, row.chWinEnd, row.chSweep)

                        }

                    }



                    // Trạng thái

                    Rectangle {

                        Layout.preferredWidth: root.colState

                        Layout.preferredHeight: 20

                        radius: 10

                        color: root.stateColor(row.chState) + "20"

                        border.color: root.stateColor(row.chState)

                        border.width: 1

                        Label {

                            anchors.centerIn: parent

                            text: root.stateText(row.chState)

                            color: root.stateColor(row.chState)

                            font.pixelSize: 9

                            font.bold: true

                        }

                    }



                    // Hôm nay

                    Label {

                        Layout.preferredWidth: root.colToday

                        text: row.chPolicy === "daily"

                              ? (row.chCaught + "/" + row.chDailyLimit)

                              : String(row.chCaught)

                        color: row.chState === "satisfied" ? Theme.success : Theme.textMuted

                        font.pixelSize: 11

                        font.bold: row.chState === "satisfied"

                        font.family: "monospace"

                        horizontalAlignment: Text.AlignHCenter

                    }



                    // Hành động — slot cố định: [⚡ 26][★ 26][Soi lại 88]. "Soi lại"

                    // nằm trong Item giữ chỗ để khi ẩn cột vẫn thẳng hàng.

                    RowLayout {

                        Layout.preferredWidth: root.colActions

                        spacing: 6

                        IconButton {

                            iconName: "bolt"

                            iconSize: 11

                            Layout.preferredWidth: 26

                            Layout.preferredHeight: 24

                            iconColorIdle: row.chHot ? "#FF9F45" : Theme.textMuted

                            iconColorHover: "#FF9F45"

                            colorIdle: row.chHot ? "#FF9F4520" : "transparent"

                            border.color: row.chHot ? "#FF9F45" : Theme.border

                            ToolTip.text: row.chHot

                                ? "Đang ưu tiên (ETag 304): soi thẳng mỗi nhịp (<50ms, tiết kiệm Quota). Bấm để tắt."

                                : (row.chStandard

                                    ? "Bật thêm Ưu tiên ETag 304: Kích hoạt chế độ ĐUA KÉP song song (CDP + ETag). Cái nào thấy trước lấy ngay!"

                                    : "Đặt ưu tiên (ETag 304): bỏ qua cảm biến, soi thẳng playlistItems mỗi nhịp. Bấm để bật.")

                            ToolTip.visible: hovered

                            ToolTip.delay: 400

                            onClicked: {

                                const chId = row.chId

                                const chName = row.chName

                                const next = !row.chHot

                                const isStd = row.chStandard

                                Qt.callLater(function() {

                                    root.applyHot(chId, next)

                                    if (typeof toastService !== "undefined" && toastService) {

                                        if (next) {

                                            if (isStd) {

                                                toastService.show("Chế độ ĐUA KÉP", "Đã kích hoạt Đua Kép (CDP + ETag 304) cho " + chName + ". Cơ chế nào phát hiện trước sẽ lấy ngay!", "success")

                                            } else {

                                                toastService.show("Ưu tiên quét ETag", "Đã bật ưu tiên ETag 304 cho " + chName, "success")

                                            }

                                        } else {

                                            toastService.show("Ưu tiên quét ETag", "Đã tắt ưu tiên ETag cho " + chName, "info")

                                        }

                                    }

                                })

                            }

                        }

                        IconButton {

                            iconName: "star"

                            iconSize: 12

                            Layout.preferredWidth: 26

                            Layout.preferredHeight: 24

                            iconColorIdle: row.chStandard ? "#00E5FF" : Theme.textMuted

                            iconColorHover: "#00E5FF"

                            colorIdle: row.chStandard ? "#00E5FF20" : "transparent"

                            border.color: row.chStandard ? "#00E5FF" : Theme.border

                            ToolTip.text: row.chStandard

                                ? "Kênh chuẩn CDP: Đang được mở tab giám sát chủ động (< 1s). Bấm để tắt."

                                : (row.chHot

                                    ? "Bật thêm Kênh chuẩn CDP: Kích hoạt chế độ ĐUA KÉP song song (ETag + CDP). Cái nào thấy trước lấy ngay!"

                                    : "Đặt Kênh chuẩn (CDP): Tự động mở Chrome port 9222 giám sát trực tiếp (không giới hạn số kênh, phát hiện video <1s).")

                            ToolTip.visible: hovered

                            ToolTip.delay: 400

                            onClicked: {

                                const chId = row.chId

                                const chName = row.chName

                                const next = !row.chStandard

                                const isHot = row.chHot

                                Qt.callLater(function() {

                                    if (typeof root !== 'undefined' && root && typeof root.applyStandard === 'function') { root.applyStandard(chId, next); }

                                    if (typeof toastService !== "undefined" && toastService) {

                                        if (next) {

                                            if (isHot) {

                                                toastService.show("Chế độ ĐUA KÉP", "Đang mở Chrome port 9222 chạy Đua Kép (CDP + ETag) cho " + chName + ". Cái nào thấy trước sẽ bắt ngay!", "success")

                                            } else {

                                                toastService.show("Kênh chuẩn CDP", "Đang kết nối Chrome port 9222 mở tab giám sát tức thì (< 1s) cho " + chName, "success")

                                            }

                                        } else {

                                            toastService.show("Kênh chuẩn CDP", "Đã tắt chế độ Kênh chuẩn CDP cho " + chName, "info")

                                        }

                                    }

                                })

                            }

                        }

                        Item {

                            Layout.preferredWidth: 88

                            Layout.preferredHeight: 24

                            IconButton {

                                anchors.fill: parent

                                visible: row.chState === "satisfied"

                                iconName: "refresh"

                                label: "Soi lại"

                                iconSize: 10

                                ToolTip.text: "Mở lại kênh này cho phần còn lại của hôm nay"

                                ToolTip.visible: hovered

                                ToolTip.delay: 400

                                onClicked: {

                                    const chId = row.chId

                                    Qt.callLater(function() {

                                        root.applyReopen(chId)

                                    })

                                }

                            }

                        }

                    }

                }

            }



            Label {

                anchors.centerIn: parent

                visible: list.count === 0

                text: policyChannelModel && policyChannelModel.countAll > 0

                    ? "Không có kênh nào khớp bộ lọc"

                    : "Chưa theo dõi kênh nào"

                color: Theme.textMuted

                font.pixelSize: 12

            }

        }



        // ─── Chân bảng: phân trang của policyChannelModel ──────────

        RowLayout {

            Layout.fillWidth: true

            spacing: 6

            Label {

                text: policyChannelModel ? (policyChannelModel.totalCount + " kênh") : ""

                color: Theme.textMuted

                font.pixelSize: 11

            }

            Item { Layout.fillWidth: true }

            IconButton {

                visible: policyChannelModel && policyChannelModel.pageCount > 1

                iconName: "back"

                iconSize: 10

                Layout.preferredWidth: 26

                Layout.preferredHeight: 22

                enabled: policyChannelModel && policyChannelModel.page > 0

                onClicked: policyChannelModel.page = policyChannelModel.page - 1

            }

            Label {

                visible: policyChannelModel && policyChannelModel.pageCount > 1

                text: policyChannelModel

                      ? ((policyChannelModel.page + 1) + " / " + policyChannelModel.pageCount)

                      : ""

                color: Theme.textMuted

                font.pixelSize: 11

            }

            IconButton {

                visible: policyChannelModel && policyChannelModel.pageCount > 1

                iconName: "forward"

                iconSize: 10

                Layout.preferredWidth: 26

                Layout.preferredHeight: 22

                enabled: policyChannelModel && policyChannelModel.page < policyChannelModel.pageCount - 1

                onClicked: policyChannelModel.page = policyChannelModel.page + 1

            }

        }

    }

}

