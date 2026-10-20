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
    readonly property int colAvatar: 24
    readonly property int colPolicy: 132
    readonly property int colState: 108
    readonly property int colToday: 64
    readonly property int colActions: 175

    function stateColor(s) {
        switch (s) {
            case "cdp": return "#00FF88"
            case "hot": return "#FF9F45"
            case "scanning": return Theme.accent
            case "satisfied": return Theme.success
            case "outside_window": return "#A78BFA"
            default: return Theme.textMuted
        }
    }
    function stateText(s) {
        switch (s) {
            case "cdp": return "CDP CHROME"
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
            policyChannelModel.load_from_backend(backend)
            channelListModel.load_from_backend(backend)
            if (quota) quota.refresh_from_backend(backend)
        })
    }

    /// Cùng lớp crash 18/07 nhưng vế còn lại, dai dẳng từ 11/08 (ui-qt.log:
    /// "channelListModel is not defined ... delayed function evaluation"):
    /// closure literal đặt TRONG delegate chết theo delegate — bấm nút là model
    /// reset ngay, hàng bị dựng lại, và Qt chạy hàm hẹn giờ trên context đã
    /// hủy nên tra context property thất bại giữa chừng. Delegate chỉ được
    /// phép LÊN LỊCH HÀM CỦA GỐC kèm tham số: `Qt.callLater(root.applyHot, …)`
    /// bind tham chiếu hàm ngay lúc lên lịch (delegate còn sống), thân hàm
    /// chạy trên context gốc — gốc sống suốt đời panel.
    function applyHot(chId, next) {
        policyChannelModel.set_hot(backend, chId, next)
        channelListModel.load_from_backend(backend)
        if (quota) quota.refresh_from_backend(backend)
    }
    function applyCdp(chId, next) {
        policyChannelModel.set_cdp(backend, chId, next)
        channelListModel.load_from_backend(backend)
        if (quota) quota.refresh_from_backend(backend)
    }
    function applyReopen(chId) {
        policyChannelModel.reopen_today(backend, chId)
        channelListModel.load_from_backend(backend)
        if (quota) quota.refresh_from_backend(backend)
    }

    // ─── Popup chỉnh chính sách ────────────────────────────────────
    // Đặt ở gốc bảng, KHÔNG lồng trong delegate — popup trong delegate bị hủy
    // theo delegate khi model reset (cùng lý do GcpWizard nằm ở gốc panel).
    Popup {
        id: policyEditor
        modal: true
        focus: true
        closePolicy: Popup.CloseOnEscape | Popup.CloseOnPressOutside
        anchors.centerIn: Overlay.overlay
        width: 480
        padding: 16

        property string chId: ""
        property string chName: ""
        // "continuous" | "daily" | "window" | "off"
        property string mode: "continuous"

        function openFor(id, name, policy, limit, ws, we, sweep) {
            chId = id
            chName = name
            mode = (policy === "" ? "continuous" : policy)
            // Pass 69: mode window cho phép 0 (= không ngắt) — `from` là
            // binding theo mode nên clamp theo nó, đừng ép cứng về 1.
            dailySpin.value = Math.max(dailySpin.from, limit || 0)
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
            spacing: 10

            Label {
                text: "Chính sách quét — " + policyEditor.chName
                color: Theme.text
                font.pixelSize: 14
                font.bold: true
                elide: Text.ElideRight
                Layout.fillWidth: true
            }

            component ModeRow: RowLayout {
                id: modeRow
                property string modeKey: ""
                property string modeLabel: ""
                default property alias extra: extraHolder.data
                Layout.fillWidth: true
                spacing: 8
                RadioButton {
                    checked: policyEditor.mode === modeRow.modeKey
                    onClicked: policyEditor.mode = modeRow.modeKey
                    Layout.preferredWidth: 28
                }
                Label {
                    text: modeRow.modeLabel
                    color: Theme.text
                    font.pixelSize: 12
                    Layout.preferredWidth: 95
                }
                RowLayout {
                    id: extraHolder
                    Layout.fillWidth: true
                    spacing: 6
                }
            }

            ModeRow { modeKey: "continuous"; modeLabel: "Liên tục" }

            ModeRow {
                modeKey: "daily"
                modeLabel: "Theo chỉ tiêu"
                SpinBox {
                    id: dailySpin
                    // Pass 69: mode "window" cũng dùng được chỉ tiêu — 0 nghĩa
                    // là "không ngắt, quét suốt khung" (hành vi cũ).
                    from: policyEditor.mode === "window" ? 0 : 1
                    to: 50
                    editable: true
                    enabled: policyEditor.mode === "daily" || policyEditor.mode === "window"
                    Layout.preferredWidth: 100
                    Layout.preferredHeight: 28
                }
                Label {
                    text: policyEditor.mode === "window" && dailySpin.value === 0
                          ? "video/ngày (0 = không ngắt)" : "video/ngày"
                    color: Theme.textMuted
                    font.pixelSize: 11
                    Layout.fillWidth: true
                    elide: Text.ElideRight
                }
            }

            ModeRow {
                modeKey: "window"
                modeLabel: "Khung giờ VN"
                TextField {
                    id: winStart
                    placeholderText: "18:00"
                    enabled: policyEditor.mode === "window"
                    Layout.preferredWidth: 70
                    Layout.preferredHeight: 28
                    color: Theme.text
                    font.pixelSize: 12
                    font.family: "monospace"
                    horizontalAlignment: Text.AlignHCenter
                    // Khung vắt đêm ("22:00"→"02:00") backend xử lý đúng.
                    // Pass 69: cho phép NHIỀU khung, phân tách dấu phẩy
                    // ("08:58,20:58" ghép với "09:30,21:30" theo thứ tự).
                    validator: RegularExpressionValidator { regularExpression: /^([01]?\d|2[0-3]):[0-5]\d(\s*,\s*([01]?\d|2[0-3]):[0-5]\d)*$/ }
                    background: Rectangle {
                        color: Theme.inputBg
                        border.color: winStart.activeFocus ? Theme.accent
                            : (winStart.acceptableInput || !winStart.text ? Theme.border : Theme.error)
                        border.width: 1
                        radius: Theme.radiusMd
                    }
                }
                Label { text: "→"; color: Theme.textMuted; font.pixelSize: 12 }
                TextField {
                    id: winEnd
                    placeholderText: "23:00"
                    enabled: policyEditor.mode === "window"
                    Layout.preferredWidth: 70
                    Layout.preferredHeight: 28
                    color: Theme.text
                    font.pixelSize: 12
                    font.family: "monospace"
                    horizontalAlignment: Text.AlignHCenter
                    validator: RegularExpressionValidator { regularExpression: /^([01]?\d|2[0-3]):[0-5]\d(\s*,\s*([01]?\d|2[0-3]):[0-5]\d)*$/ }
                    background: Rectangle {
                        color: Theme.inputBg
                        border.color: winEnd.activeFocus ? Theme.accent
                            : (winEnd.acceptableInput || !winEnd.text ? Theme.border : Theme.error)
                        border.width: 1
                        radius: Theme.radiusMd
                    }
                }
            }

            Label {
                visible: policyEditor.mode === "window"
                text: "Kênh đăng nhiều cữ: nhập nhiều mốc cách nhau dấu phẩy, ghép theo thứ tự.\nVí dụ 08:58,20:58 → 09:30,21:30 = hai khung sáng và tối.\nĐặt \"video/ngày\" > 0 để NGẮT ngay sau khi bắt đủ (đỡ tốn quota phần khung còn lại)."
                color: Theme.textMuted
                font.pixelSize: 10
                wrapMode: Text.WordWrap
                Layout.fillWidth: true
            }

            ModeRow { modeKey: "off"; modeLabel: "Không soi" }

            CheckBox {
                id: sweepCheck
                visible: policyEditor.mode === "daily"
                         || (policyEditor.mode === "window" && dailySpin.value > 0)
                text: "Vẫn quét thưa 10 phút/lần sau khi đã đủ (bắt video ngoài dự kiến)"
                Layout.fillWidth: true
                contentItem: Label {
                    text: sweepCheck.text
                    color: Theme.text
                    font.pixelSize: 11
                    wrapMode: Text.WordWrap
                    leftPadding: sweepCheck.indicator.width + sweepCheck.spacing
                    verticalAlignment: Text.AlignVCenter
                }
            }

            Label {
                visible: policyEditor.mode === "daily"
                         || (policyEditor.mode === "window" && dailySpin.value > 0)
                text: "Đổi chính sách sẽ tính lại chỉ tiêu từ 0 cho hôm nay."
                color: Theme.textMuted
                font.pixelSize: 10
                wrapMode: Text.WordWrap
                Layout.fillWidth: true
            }

            RowLayout {
                Layout.fillWidth: true
                Layout.topMargin: 4
                Item { Layout.fillWidth: true }
                IconButton {
                    iconName: "close"
                    label: "Hủy"
                    iconSize: 10
                    Layout.preferredHeight: 28
                    onClicked: policyEditor.close()
                }
                IconButton {
                    iconName: "check"
                    label: "Lưu"
                    iconSize: 10
                    Layout.preferredHeight: 28
                    Layout.minimumWidth: 70
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
                            // Pass 69: khung giờ cũng có chỉ tiêu — bắt đủ là
                            // NGẮT ngay trong khung (0 = quét suốt khung).
                            params["dailyLimit"] = dailySpin.value
                            params["safetySweep"] = sweepCheck.checked
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
            text: "Kênh đặt \"n/ngày\" sẽ ngừng soi dày sau khi bắt đủ n video — ngân sách quota chuyển sang các kênh còn lại (vẫn quét lại 10 phút/lần để không bỏ sót). Bấm ⚡ để ưu tiên soi thẳng mỗi nhịp."
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
                // Chấm trạng thái (7) + avatar (colAvatar) + 1 nhịp spacing giữa
                // chúng — cùng bộ số với hàng nên nhãn KÊNH đứng đúng trên tên.
                Item { Layout.preferredWidth: 7 + 6 + root.colAvatar }
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
                readonly property bool chCdp: model.cdpEnabled || false
                readonly property string chWinStart: model.windowStart
                readonly property string chWinEnd: model.windowEnd
                readonly property bool chSweep: model.safetySweep
                // `|| ""`: lúc model reset (bảng nạp lại mỗi nhịp) delegate bị
                // hủy giữa chừng, role đọc ra undefined → spam "Unable to
                // assign [undefined] to QString" (ui-qt khách 15/08).
                readonly property string chAvatarUrl: model.avatarUrl || ""
                readonly property string chAvatarColor: model.avatarColor || ""

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
                            state: row.chCdp ? "running"
                                 : (row.chState === "satisfied" ? "ready"
                                 : row.chState === "scanning" || row.chState === "hot" ? "running"
                                 : "idle")
                            size: 7
                            showRing: row.chCdp || row.chState === "scanning" || row.chState === "hot"
                        }

                        ChannelAvatar {
                            url: row.chAvatarUrl
                            channelName: row.chName
                            tint: row.chAvatarColor || Theme.accent
                            diameter: root.colAvatar
                            // Kênh đang nghỉ thì mờ đi — liếc một cái là thấy
                            // ngay kênh nào không nằm trong vòng quét.
                            opacity: row.chState === "paused" || row.chState === "off"
                                     || row.chState === "outside_window" ? 0.45 : 1.0
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
                            anchors.rightMargin: 8
                            spacing: 4
                            Label {
                                text: row.chCdp ? "CDP (Không API)" : root.policyText(row.chPolicy, row.chDailyLimit, row.chWinStart, row.chWinEnd)
                                color: row.chCdp ? "#00FF88" : Theme.text
                                font.pixelSize: 11
                                elide: Text.ElideRight
                                Layout.fillWidth: true
                                Layout.minimumWidth: 0
                            }
                            Icon {
                                name: "expand_more"
                                size: 12
                                color: Theme.textMuted
                            }
                        }
                        MouseArea {
                            id: polMa
                            anchors.fill: parent
                            hoverEnabled: true
                            cursorShape: Qt.PointingHandCursor
                            onClicked: policyEditor.openFor(
                                row.chId, row.chName, row.chPolicy,
                                row.chDailyLimit, row.chWinStart, row.chWinEnd, row.chSweep
                            )
                        }
                    }

                    // Trạng thái quét (hot / scanning / satisfied / outside_window / off / paused)
                    Rectangle {
                        Layout.preferredWidth: root.colState
                        Layout.preferredHeight: 20
                        radius: Theme.radiusSm
                        color: Qt.alpha(root.stateColor(row.chCdp ? "cdp" : row.chState), 0.12)
                        Label {
                            anchors.centerIn: parent
                            text: root.stateText(row.chCdp ? "cdp" : row.chState)
                            color: root.stateColor(row.chCdp ? "cdp" : row.chState)
                            font.pixelSize: 9
                            font.bold: true
                        }
                    }

                    // Hôm nay: [đã bắt] / [chỉ tiêu]
                    Label {
                        Layout.preferredWidth: root.colToday
                        text: row.chDailyLimit > 0 ? (row.chCaught + "/" + row.chDailyLimit) : (row.chCaught > 0 ? ("" + row.chCaught) : "—")
                        color: row.chState === "satisfied" ? Theme.success : Theme.textMuted
                        font.pixelSize: 11
                        font.bold: row.chState === "satisfied"
                        font.family: "monospace"
                        horizontalAlignment: Text.AlignHCenter
                    }

                    // Hành động — slot cố định: [⚡ 26][CDP 46][Soi lại 88].
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
                                ? "Đang ưu tiên: soi thẳng mỗi nhịp (1 unit/nhịp riêng). Bấm để tắt."
                                : "Đặt ưu tiên: bỏ qua lớp cảm biến, soi thẳng mỗi nhịp. Tốn thêm quota."
                            ToolTip.visible: hovered
                            ToolTip.delay: 400
                            onClicked: Qt.callLater(root.applyHot, row.chId, !row.chHot)
                        }
                        IconButton {
                            label: "CDP"
                            iconSize: 10
                            Layout.preferredWidth: 46
                            Layout.preferredHeight: 24
                            iconColorIdle: row.chCdp ? "#00FF88" : Theme.textMuted
                            iconColorHover: "#00FF88"
                            colorIdle: row.chCdp ? "#00FF8825" : "transparent"
                            border.color: row.chCdp ? "#00FF88" : Theme.border
                            ToolTip.text: row.chCdp
                                ? "Đang BẬT CDP: Tắt hoàn toàn API quét kênh này, ChromeWatcher quét trực tiếp tab Chrome (<1.5s). Bấm để tắt."
                                : "Bật ChromeWatcher CDP: Tắt API quét kênh này, mở tab Chrome /videos quét DOM cực nhanh, 0 quota."
                            ToolTip.visible: hovered
                            ToolTip.delay: 400
                            onClicked: Qt.callLater(root.applyCdp, row.chId, !row.chCdp)
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
                                // Lên lịch HÀM CỦA GỐC — cùng lý do applyHot.
                                onClicked: Qt.callLater(root.applyReopen, row.chId)
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
