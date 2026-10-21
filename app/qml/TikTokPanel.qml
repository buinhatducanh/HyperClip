// src/ui/qml/TikTokPanel.qml
// Pass 38 — Panel TikTok: switch auto-upload, quản lý tài khoản (cột trái),
// chi tiết account: kênh đã gán / gán kênh mới / caption / lịch sử (cột phải).
// Data: tiktokModel (tiktok:list + event tiktok:update); switch: settings.
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Rectangle {
    id: panel
    color: Theme.bg

    property string selectedAccountId: ""

    // Tự chọn account đầu tiên (Pass 52). Trước đây selectedAccountId = "" cho
    // tới khi người dùng BẤM vào thẻ account; mà `pickerChannels`/
    // `assignedChannels` đều return rỗng khi chưa chọn → cột phải trống, nút
    // "Gán" không hề xuất hiện. Với đúng 1 tài khoản thì không ai nghĩ phải
    // bấm chọn nó trước → khách báo "nút thêm kênh TikTok không hoạt động".
    // Danh sách tài khoản: ưu tiên tiktokModel.accounts, nếu trống thì đọc trực tiếp từ backend
    property var accountsList: {
        if (typeof tiktokModel !== "undefined" && tiktokModel && tiktokModel.accounts && tiktokModel.accounts.length > 0) {
            return tiktokModel.accounts
        }
        if (typeof backend !== "undefined" && backend) {
            try {
                var resp = backend.send_command("tiktok:list")
                if (resp) {
                    var r = resp.result || resp
                    if (r && r.accounts && r.accounts.length > 0) return r.accounts
                }
            } catch (e) {}
        }
        return []
    }

    function ensureSelection() {
        var list = panel.accountsList
        if (!list || list.length === 0) {
            panel.selectedAccountId = ""
            return
        }
        for (var i = 0; i < list.length; i++)
            if (list[i].id === panel.selectedAccountId) return
        panel.selectedAccountId = list[0].id
    }
    Connections {
        target: (typeof tiktokModel !== "undefined") ? tiktokModel : null
        function onChanged() { Qt.callLater(function() { panel.ensureSelection() }) }
    }

    property var selAcc: {
        var list = panel.accountsList
        for (var i = 0; i < list.length; i++)
            if (list[i].id === panel.selectedAccountId) return list[i]
        return null
    }

    // Kênh đã gán vào account đang chọn (match theo channelId YouTube UC…)
    property var assignedChannels: {
        var out = []
        if (!panel.selectedAccountId || typeof tiktokModel === "undefined" || !tiktokModel || !tiktokModel.channels || !tiktokModel.mappings) return out
        var chs = tiktokModel.channels
        var maps = tiktokModel.mappings
        for (var i = 0; i < chs.length; i++) {
            var cid = chs[i].channelId
            if (cid && maps[cid] === panel.selectedAccountId) out.push(chs[i])
        }
        return out
    }

    // Kênh chưa gán account nào (hoặc gán account khác — hiện mờ) + filter search
    property string channelFilter: ""
    property var pickerChannels: {
        var out = []
        if (!panel.selectedAccountId || typeof tiktokModel === "undefined" || !tiktokModel || !tiktokModel.channels || !tiktokModel.mappings) return out
        var chs = tiktokModel.channels
        var maps = tiktokModel.mappings
        var f = panel.channelFilter.toLowerCase()
        for (var i = 0; i < chs.length; i++) {
            var ch = chs[i]
            if (f && ch.name.toLowerCase().indexOf(f) < 0) continue
            var owner = ch.channelId ? (maps[ch.channelId] || "") : ""
            if (owner === panel.selectedAccountId) continue // đã gán account này
            out.push({ ch: ch, ownerAccountId: owner })
        }
        return out
    }

    // Click RadioButton/TextField phá binding `checked`/`text` — đổi account
    // hoặc refresh thì đồng bộ lại tay để không hiện state của account cũ.
    onSelAccChanged: {
        captionAuto.checked = !(selAcc && selAcc.captionMode === "custom")
        captionCustom.checked = !!(selAcc && selAcc.captionMode === "custom")
        if (!tplInput.activeFocus)
            tplInput.text = selAcc ? (selAcc.captionTemplate || "") : ""
        if (typeof profileIdInput !== "undefined" && profileIdInput && !profileIdInput.activeFocus)
            profileIdInput.text = selAcc ? (selAcc.profileId || "") : ""
    }

    function accountLabel(accId) {
        var list = panel.accountsList
        for (var i = 0; i < list.length; i++)
            if (list[i].id === accId) return list[i].label
        return "?"
    }

    function statusColor(st) {
        if (st === "connected") return Theme.success
        if (st === "disconnected") return Theme.error
        return Theme.textMuted
    }

    function statusText(st) {
        if (st === "connected") return "Đã kết nối"
        if (st === "disconnected") return "Mất đăng nhập"
        return "Chưa kiểm tra"
    }

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 16
        spacing: 12

        // ─── Header: switch tổng + trạng thái queue ──────────────
        RowLayout {
            Layout.fillWidth: true
            spacing: 12

            Label {
                text: "Tự động đăng TikTok"
                color: Theme.text
                font.pixelSize: 16
                font.bold: true
            }
            Switch {
                id: enableSwitch
                checked: Boolean(settings && settings.tiktokUploadEnabled)
                onToggled: {
                    if (settings) {
                        settings.tiktokUploadEnabled = checked
                        if (typeof backend !== "undefined" && typeof settings.save_to_backend === "function" && settings.save_to_backend(backend)) {
                            toastService.show("TikTok", checked ? "Đã BẬT tự động đăng TikTok" : "Đã TẮT tự động đăng TikTok", "info")
                        } else {
                            settings.tiktokUploadEnabled = !checked
                            enableSwitch.checked = Qt.binding(function() { return settings.tiktokUploadEnabled })
                            toastService.show("TikTok", "Không lưu được cài đặt — đã hoàn tác", "error")
                        }
                    }
                }
            }
            Item { Layout.fillWidth: true }
            Rectangle {
                Layout.preferredHeight: 24
                Layout.preferredWidth: checkAdsLbl.implicitWidth + 16
                radius: 4
                color: checkAdsMa.containsMouse ? Theme.hoverBg : "transparent"
                border.color: Theme.border
                border.width: 1
                Label {
                    id: checkAdsLbl
                    anchors.centerIn: parent
                    text: "⚡ Kiểm tra AdsPower"
                    color: Theme.text
                    font.pixelSize: 11
                }
                MouseArea {
                    id: checkAdsMa
                    anchors.fill: parent
                    hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onClicked: {
                        var ts = (typeof toastService !== "undefined" && toastService) ? toastService : (typeof toastManager !== "undefined" ? toastManager : null)
                        try {
                            var xhr = new XMLHttpRequest()
                            xhr.open("GET", "http://127.0.0.1:50325/status")
                            xhr.timeout = 3000
                            xhr.onreadystatechange = function() {
                                if (xhr.readyState === XMLHttpRequest.DONE) {
                                    if (xhr.status === 200) {
                                        try {
                                            var json = JSON.parse(xhr.responseText)
                                            if (json.code === 0) {
                                                if (ts) ts.show("AdsPower", "Kết nối AdsPower Local API thành công! (127.0.0.1:50325)", "success")
                                                return
                                            }
                                        } catch (e) {}
                                    }
                                    var ok = false
                                    try {
                                        if (typeof backend !== "undefined" && backend) {
                                            var res = backend.send_command("tiktok:checkAdsPower")
                                            ok = !!(res && (res.ok === true || (res.result && res.result.ok === true)))
                                        }
                                    } catch (e2) {}
                                    if (ts) {
                                        if (ok) {
                                            ts.show("AdsPower", "Kết nối AdsPower Local API thành công! (127.0.0.1:50325)", "success")
                                        } else {
                                            ts.show("AdsPower", "Không thể kết nối AdsPower Local API! Hãy bật AdsPower và mở cài đặt Local API (port 50325).", "error")
                                        }
                                    }
                                }
                            }
                            xhr.ontimeout = function() {
                                if (ts) ts.show("AdsPower", "Hết thời gian chờ kết nối AdsPower Local API (127.0.0.1:50325).", "error")
                            }
                            xhr.onerror = function() {
                                if (ts) ts.show("AdsPower", "Không thể kết nối AdsPower Local API! Hãy bật AdsPower và mở cài đặt Local API (port 50325).", "error")
                            }
                            xhr.send()
                        } catch (err) {
                            if (ts) ts.show("AdsPower", "Lỗi kiểm tra AdsPower: " + err, "error")
                        }
                    }
                }
            }

            Rectangle {
                visible: (typeof tiktokModel !== "undefined" && tiktokModel) ? (tiktokModel.queueLength > 0 || (tiktokModel.uploading && tiktokModel.uploading !== "")) : false
                Layout.preferredHeight: 22
                Layout.preferredWidth: queueLabel.implicitWidth + 16
                radius: 4
                color: Theme.accent + "18"
                border.color: Theme.accent + "44"
                border.width: 1
                Label {
                    id: queueLabel
                    anchors.centerIn: parent
                    text: (typeof tiktokModel !== "undefined" && tiktokModel) ? (((tiktokModel.uploading && tiktokModel.uploading !== "") ? "Đang đăng 1 · " : "") + (tiktokModel.queueLength || 0) + " chờ") : ""
                    color: Theme.accent
                    font.pixelSize: 11
                    font.bold: true
                }
            }
        }

        Label {
            text: "Tự động đăng TikTok qua AdsPower Browser (Local API: 127.0.0.1:50325). Khuyến nghị 1-2 kênh YouTube / tài khoản. Video render xong sẽ tự đăng theo mapping."
            color: Theme.textMuted
            font.pixelSize: 11
            wrapMode: Text.WordWrap
            Layout.fillWidth: true
        }

        // Pass 42: có kênh gán mà switch tổng tắt = flow chết im lặng (18/07)
        Rectangle {
            visible: Boolean(settings && !settings.tiktokUploadEnabled && typeof tiktokModel !== "undefined" && tiktokModel && tiktokModel.mappings && Object.keys(tiktokModel.mappings).length > 0)
            Layout.fillWidth: true
            Layout.preferredHeight: offWarnLbl.implicitHeight + 12
            radius: 4
            color: "#FFB80015"
            border.color: "#FFB80066"
            border.width: 1
            Label {
                id: offWarnLbl
                anchors.fill: parent
                anchors.margins: 6
                text: "⚠ Đã gán " + ((typeof tiktokModel !== "undefined" && tiktokModel && tiktokModel.mappings) ? Object.keys(tiktokModel.mappings).length : 0) + " kênh nhưng công tắc tổng đang TẮT — video render xong sẽ KHÔNG tự đăng. Bật công tắc phía trên để kích hoạt."
                color: "#FFB800"
                font.pixelSize: 11
                wrapMode: Text.WordWrap
            }
        }

        // ─── 2 cột ───────────────────────────────────────────────
        RowLayout {
            Layout.fillWidth: true
            Layout.fillHeight: true
            spacing: 12

            // ══ Cột trái: danh sách tài khoản ══
            Rectangle {
                Layout.preferredWidth: 320
                Layout.fillHeight: true
                color: Theme.cardBg
                border.color: Theme.border
                border.width: 1
                radius: 6

                ColumnLayout {
                    anchors.fill: parent
                    anchors.margins: 10
                    spacing: 8

                    Label {
                        text: "TÀI KHOẢN TIKTOK (" + panel.accountsList.length + ")"
                        color: Theme.textMuted
                        font.pixelSize: 10
                        font.bold: true
                    }

                    // Thêm tài khoản
                    ColumnLayout {
                        Layout.fillWidth: true
                        spacing: 6

                        RowLayout {
                            Layout.fillWidth: true
                            spacing: 6
                            TextField {
                                id: newAccInput
                                Layout.fillWidth: true
                                placeholderText: "@username TikTok…"
                                font.pixelSize: 12
                                onAccepted: newProfileIdInput.forceActiveFocus()
                            }
                            TextField {
                                id: newProfileIdInput
                                Layout.preferredWidth: 105
                                placeholderText: "AdsPower ID…"
                                font.pixelSize: 12
                                onAccepted: addAccBtn.doAdd()
                            }
                        }

                        Rectangle {
                            id: addAccBtn
                            Layout.fillWidth: true
                            Layout.preferredHeight: 28
                            radius: 4
                            color: addMa.containsMouse ? "#00A4EF" : Theme.accent
                            function doAdd() {
                                var label = newAccInput.text.trim()
                                var pid = newProfileIdInput.text.trim()
                                if (!label) return
                                tiktokModel.add_account(label, pid)
                                newAccInput.text = ""
                                newProfileIdInput.text = ""
                            }
                            Label {
                                anchors.centerIn: parent
                                text: "+ Thêm tài khoản AdsPower"
                                color: "white"
                                font.pixelSize: 11
                                font.bold: true
                            }
                            MouseArea {
                                id: addMa
                                anchors.fill: parent
                                hoverEnabled: true
                                cursorShape: Qt.PointingHandCursor
                                onClicked: addAccBtn.doAdd()
                            }
                        }
                    }

                    ListView {
                        id: accList
                        Layout.fillWidth: true
                        Layout.fillHeight: true
                        model: panel.accountsList
                        clip: true
                        spacing: 6

                        delegate: Rectangle {
                            id: accItem
                            width: accList.width
                            height: 114
                            radius: 6
                            color: modelData.id === panel.selectedAccountId ? Theme.hoverBg : Theme.bg
                            border.color: modelData.id === panel.selectedAccountId ? Theme.accent : Theme.border
                            border.width: 1

                            // Danh sách các kênh YouTube được gán vào tài khoản TikTok này
                            readonly property var assignedChannelsList: {
                                var res = []
                                if (typeof tiktokModel === "undefined" || !tiktokModel || !tiktokModel.channels || !tiktokModel.mappings) return res
                                var chs = tiktokModel.channels
                                var maps = tiktokModel.mappings
                                var accId = modelData.id
                                for (var i = 0; i < chs.length; i++) {
                                    var cid = chs[i].channelId
                                    var id = chs[i].id
                                    if ((cid && maps[cid] === accId) || (id && maps[id] === accId)) {
                                        res.push(chs[i])
                                    }
                                }
                                return res
                            }

                            MouseArea {
                                anchors.fill: parent
                                cursorShape: Qt.PointingHandCursor
                                onClicked: panel.selectedAccountId = modelData.id
                            }

                            ColumnLayout {
                                anchors.fill: parent
                                anchors.margins: 8
                                spacing: 4

                                RowLayout {
                                    Layout.fillWidth: true
                                    spacing: 8
                                    Rectangle {
                                        width: 24; height: 24; radius: 12
                                        color: Theme.surfaceHover
                                        border.color: Theme.border
                                        border.width: 1
                                        Icon {
                                            anchors.centerIn: parent
                                            name: "upload"
                                            size: 12
                                            color: Theme.accent
                                        }
                                        Rectangle {
                                            width: 7; height: 7; radius: 3.5
                                            anchors.right: parent.right
                                            anchors.bottom: parent.bottom
                                            color: panel.statusColor(modelData.status)
                                            border.color: Theme.bg
                                            border.width: 1
                                        }
                                    }
                                    Label {
                                        text: modelData.label
                                        color: Theme.text
                                        font.pixelSize: 13
                                        font.bold: true
                                        elide: Text.ElideRight
                                        Layout.fillWidth: true
                                    }
                                    Label {
                                        text: (accItem.assignedChannelsList.length > 0 ? accItem.assignedChannelsList.length : modelData.channelCount) + " kênh"
                                        color: (accItem.assignedChannelsList.length > 2 || modelData.channelCount > 2) ? "#FFB800" : Theme.textMuted
                                        font.pixelSize: 10
                                        font.bold: true
                                    }
                                }

                                // Hàng hiển thị Profile ID AdsPower
                                RowLayout {
                                    Layout.fillWidth: true
                                    spacing: 4
                                    Label {
                                        text: "AdsPower ID:"
                                        color: Theme.textMuted
                                        font.pixelSize: 10
                                    }
                                    Label {
                                        text: modelData.profileId ? modelData.profileId : "Chưa đặt"
                                        color: modelData.profileId ? Theme.accent : "#FFB800"
                                        font.pixelSize: 10
                                        font.bold: true
                                        elide: Text.ElideRight
                                        Layout.fillWidth: true
                                    }
                                }

                                // Hàng hiển thị danh sách icon / avatar các kênh YouTube được gán
                                RowLayout {
                                    Layout.fillWidth: true
                                    spacing: 6
                                    visible: accItem.assignedChannelsList.length > 0

                                    Row {
                                        spacing: 4
                                        Layout.alignment: Qt.AlignVCenter
                                        Repeater {
                                            model: accItem.assignedChannelsList
                                            delegate: Item {
                                                width: 18
                                                height: 18
                                                ChannelAvatarFor {
                                                    anchors.fill: parent
                                                    channelKey: modelData.channelId || modelData.id || ""
                                                    fallbackName: modelData.name || ""
                                                    directUrl: modelData.avatarUrl || ""
                                                    diameter: 18
                                                }
                                                ToolTip.text: modelData.name || ""
                                                ToolTip.visible: chMa.containsMouse
                                                ToolTip.delay: 200
                                                MouseArea {
                                                    id: chMa
                                                    anchors.fill: parent
                                                    hoverEnabled: true
                                                }
                                            }
                                        }
                                    }

                                    Label {
                                        text: accItem.assignedChannelsList.map(function(c) { return c.name }).join(" · ")
                                        color: Theme.textMuted
                                        font.pixelSize: 10
                                        elide: Text.ElideRight
                                        Layout.fillWidth: true
                                        Layout.alignment: Qt.AlignVCenter
                                    }
                                }

                                Label {
                                    Layout.fillWidth: true
                                    visible: accItem.assignedChannelsList.length === 0
                                    text: "Chưa gắn kênh YouTube"
                                    color: Theme.textMuted
                                    font.pixelSize: 10
                                    font.italic: true
                                }

                                RowLayout {
                                    Layout.fillWidth: true
                                    spacing: 6

                                    Label {
                                        text: panel.statusText(modelData.status)
                                        color: panel.statusColor(modelData.status)
                                        font.pixelSize: 10
                                        Layout.fillWidth: true
                                    }

                                    // Mở trình duyệt AdsPower
                                    Rectangle {
                                        Layout.preferredWidth: loginLbl.implicitWidth + 12
                                        Layout.preferredHeight: 20
                                        radius: 3
                                        color: loginMa.containsMouse ? Theme.hoverBg : "transparent"
                                        border.color: Theme.border
                                        border.width: 1
                                        Label {
                                            id: loginLbl
                                            anchors.centerIn: parent
                                            text: "Mở AdsPower"
                                            color: Theme.text
                                            font.pixelSize: 10
                                        }
                                        MouseArea {
                                            id: loginMa
                                            anchors.fill: parent
                                            hoverEnabled: true
                                            cursorShape: Qt.PointingHandCursor
                                            onClicked: {
                                                tiktokModel.start_login(modelData.id)
                                                toastService.show("TikTok", "Đang mở trình duyệt AdsPower (" + (modelData.profileId || modelData.id) + ")…", "info")
                                            }
                                        }
                                    }

                                    // Kiểm tra login (async, kết quả về qua event)
                                    Rectangle {
                                        Layout.preferredWidth: checkLbl.implicitWidth + 12
                                        Layout.preferredHeight: 20
                                        radius: 3
                                        color: checkMa.containsMouse ? Theme.hoverBg : "transparent"
                                        border.color: Theme.border
                                        border.width: 1
                                        Label {
                                            id: checkLbl
                                            anchors.centerIn: parent
                                            text: "Kiểm tra"
                                            color: Theme.accent
                                            font.pixelSize: 10
                                        }
                                        MouseArea {
                                            id: checkMa
                                            anchors.fill: parent
                                            hoverEnabled: true
                                            cursorShape: Qt.PointingHandCursor
                                            onClicked: {
                                                tiktokModel.check_login(modelData.id)
                                                toastService.show("TikTok", "Đang kiểm tra đăng nhập " + modelData.label + "…", "info")
                                            }
                                        }
                                    }

                                    // Xoá account (Pass 58)
                                    Rectangle {
                                        id: delBtn
                                        property bool armed: false
                                        Layout.preferredWidth: delBtn.armed ? 78 : 46
                                        Layout.preferredHeight: 22
                                        radius: 3
                                        color: delBtn.armed ? Theme.error + "30"
                                             : (delMa.containsMouse ? "#2D1A1A" : "transparent")
                                        border.color: Theme.error + (delBtn.armed ? "" : "80")
                                        border.width: 1
                                        Label {
                                            anchors.centerIn: parent
                                            text: delBtn.armed ? "Xoá thật?" : "Xoá"
                                            color: Theme.error
                                            font.pixelSize: 10
                                            font.bold: true
                                        }
                                        // Bấm ra ngoài / đổi ý: tự bỏ trạng thái chờ xác nhận
                                        Timer {
                                            id: delDisarm
                                            interval: 4000
                                            onTriggered: delBtn.armed = false
                                        }
                                        MouseArea {
                                            id: delMa
                                            anchors.fill: parent
                                            hoverEnabled: true
                                            cursorShape: Qt.PointingHandCursor
                                            onClicked: {
                                                if (!delBtn.armed) {
                                                    delBtn.armed = true
                                                    delDisarm.restart()
                                                    if (toastService)
                                                        toastService.show("Xoá tài khoản TikTok",
                                                            "Bấm 'Xoá thật?' để xoá " + modelData.label
                                                            + " (mất mapping kênh)", "warning")
                                                    return
                                                }
                                                delDisarm.stop()
                                                delBtn.armed = false
                                                if (panel.selectedAccountId === modelData.id) panel.selectedAccountId = ""
                                                tiktokModel.remove_account(modelData.id)
                                                if (toastService)
                                                    toastService.show("Đã xoá tài khoản", modelData.label, "success")
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        Label {
                            anchors.centerIn: parent
                            visible: accList.count === 0
                            text: "Chưa có tài khoản.\nNhập @username + AdsPower ID rồi bấm Thêm."
                            color: Theme.textMuted
                            font.pixelSize: 11
                            horizontalAlignment: Text.AlignHCenter
                        }
                    }
                }
            }

            // ══ Cột phải: chi tiết account ══
            Rectangle {
                Layout.fillWidth: true
                Layout.fillHeight: true
                color: Theme.cardBg
                border.color: Theme.border
                border.width: 1
                radius: 6

                Label {
                    anchors.centerIn: parent
                    visible: !panel.selAcc
                    text: "Chọn tài khoản bên trái để cấu hình kênh + caption"
                    color: Theme.textMuted
                    font.pixelSize: 12
                }

                Flickable {
                    id: detailFlick
                    anchors.fill: parent
                    anchors.margins: 12
                    visible: !!panel.selAcc
                    contentHeight: detailCol.implicitHeight
                    clip: true

                    ColumnLayout {
                        id: detailCol
                        width: detailFlick.width
                        spacing: 14

                        // ─ AdsPower Profile ID ─
                        Label {
                            text: "ADSPOWER PROFILE ID"
                            color: Theme.textMuted
                            font.pixelSize: 10
                            font.bold: true
                        }

                        RowLayout {
                            Layout.fillWidth: true
                            spacing: 8
                            TextField {
                                id: profileIdInput
                                Layout.fillWidth: true
                                placeholderText: "Nhập User ID của AdsPower Profile (ví dụ: k9b12345)"
                                font.pixelSize: 12
                                text: panel.selAcc ? (panel.selAcc.profileId || "") : ""
                                onAccepted: savePidBtn.doSave()
                            }
                            Rectangle {
                                id: savePidBtn
                                Layout.preferredWidth: 64
                                Layout.preferredHeight: 30
                                radius: 4
                                color: savePidMa.containsMouse ? "#00A4EF" : Theme.accent
                                function doSave() {
                                    if (panel.selectedAccountId) {
                                        tiktokModel.set_profile_id(panel.selectedAccountId, profileIdInput.text.trim())
                                        toastService.show("TikTok", "Đã cập nhật AdsPower Profile ID", "success")
                                    }
                                }
                                Label {
                                    anchors.centerIn: parent
                                    text: "Lưu ID"
                                    color: "white"
                                    font.pixelSize: 11
                                    font.bold: true
                                }
                                MouseArea {
                                    id: savePidMa
                                    anchors.fill: parent
                                    hoverEnabled: true
                                    cursorShape: Qt.PointingHandCursor
                                    onClicked: savePidBtn.doSave()
                                }
                            }
                        }

                        Label {
                            text: "User ID lấy từ AdsPower (cột ID). HyperClip dùng AdsPower Local API (127.0.0.1:50325) để tự động mở và tải video lên TikTok."
                            color: Theme.textMuted
                            font.pixelSize: 10
                            wrapMode: Text.WordWrap
                            Layout.fillWidth: true
                        }

                        Rectangle { Layout.fillWidth: true; height: 1; color: Theme.border }

                        // ─ Kênh đã gán ─
                        Label {
                            text: "KÊNH ĐÃ GÁN → " + (panel.selAcc ? panel.selAcc.label : "")
                            color: Theme.textMuted
                            font.pixelSize: 10
                            font.bold: true
                        }

                        Rectangle {
                            visible: panel.assignedChannels.length > 2
                            Layout.fillWidth: true
                            Layout.preferredHeight: warnLbl.implicitHeight + 12
                            radius: 4
                            color: "#FFB80015"
                            border.color: "#FFB80066"
                            border.width: 1
                            Label {
                                id: warnLbl
                                anchors.fill: parent
                                anchors.margins: 6
                                text: "⚠ Đang gán " + panel.assignedChannels.length + " kênh — khuyến nghị 1-2 kênh/tài khoản để tránh đăng quá dày."
                                color: "#FFB800"
                                font.pixelSize: 11
                                wrapMode: Text.WordWrap
                            }
                        }

                        Flow {
                            Layout.fillWidth: true
                            spacing: 6
                            Repeater {
                                model: panel.assignedChannels
                                delegate: Rectangle {
                                    width: chipRow.implicitWidth + 16
                                    height: 26
                                    radius: 13
                                    color: Theme.accent + "18"
                                    border.color: Theme.accent + "55"
                                    border.width: 1
                                    RowLayout {
                                        id: chipRow
                                        anchors.centerIn: parent
                                        spacing: 6
                                        ChannelAvatarFor {
                                            channelKey: modelData.channelId || ""
                                            fallbackName: modelData.name || ""
                                            directUrl: modelData.avatarUrl || ""
                                            url: modelData.avatarUrl || ""
                                            diameter: 16
                                            Layout.alignment: Qt.AlignVCenter
                                        }
                                        Label {
                                            text: modelData.name
                                            color: Theme.text
                                            font.pixelSize: 11
                                        }
                                        Label {
                                            text: "×"
                                            color: chipDelMa.containsMouse ? Theme.error : Theme.textMuted
                                            font.pixelSize: 13
                                            font.bold: true
                                            MouseArea {
                                                id: chipDelMa
                                                anchors.fill: parent
                                                anchors.margins: -4
                                                hoverEnabled: true
                                                cursorShape: Qt.PointingHandCursor
                                                onClicked: tiktokModel.unassign_channel(modelData.channelId)
                                            }
                                        }
                                    }
                                }
                            }
                            Label {
                                visible: panel.assignedChannels.length === 0
                                text: "Chưa gán kênh nào"
                                color: Theme.textMuted
                                font.pixelSize: 11
                            }
                        }

                        Rectangle { Layout.fillWidth: true; height: 1; color: Theme.border }

                        // ─ Gán kênh mới ─
                        Label {
                            text: "GÁN KÊNH MỚI"
                            color: Theme.textMuted
                            font.pixelSize: 10
                            font.bold: true
                        }

                        TextField {
                            Layout.fillWidth: true
                            placeholderText: "⌕ Tìm kênh…"
                            font.pixelSize: 12
                            onTextChanged: panel.channelFilter = text.trim()
                        }

                        ListView {
                            id: pickerList
                            Layout.fillWidth: true
                            Layout.preferredHeight: Math.min(contentHeight, 180)
                            model: panel.pickerChannels
                            clip: true
                            spacing: 2

                            delegate: Rectangle {
                                width: ListView.view.width
                                height: 30
                                radius: 4
                                color: index % 2 === 0 ? Theme.rowEven : "transparent"
                                // Kênh đã thuộc account khác → mờ + hiện tên account đó
                                opacity: modelData.ownerAccountId ? 0.5 : 1.0

                                RowLayout {
                                    anchors.fill: parent
                                    anchors.leftMargin: 8
                                    anchors.rightMargin: 8
                                    spacing: 8

                                    ChannelAvatarFor {
                                        channelKey: modelData.ch.channelId || ""
                                        fallbackName: modelData.ch.name || ""
                                        directUrl: modelData.ch.avatarUrl || ""
                                        url: modelData.ch.avatarUrl || ""
                                        diameter: 20
                                        Layout.alignment: Qt.AlignVCenter
                                    }

                                    Label {
                                        text: modelData.ch.name
                                        color: Theme.text
                                        font.pixelSize: 12
                                        elide: Text.ElideRight
                                        Layout.fillWidth: true
                                    }
                                    Label {
                                        visible: !!modelData.ownerAccountId
                                        text: "→ " + panel.accountLabel(modelData.ownerAccountId)
                                        color: Theme.textMuted
                                        font.pixelSize: 10
                                    }
                                    Label {
                                        visible: !modelData.ch.channelId
                                        text: "chưa sync"
                                        color: Theme.textMuted
                                        font.pixelSize: 10
                                    }
                                    Rectangle {
                                        visible: !modelData.ownerAccountId && !!modelData.ch.channelId
                                        Layout.preferredWidth: 40
                                        Layout.preferredHeight: 20
                                        radius: 3
                                        color: assignMa.containsMouse ? Theme.accent : "transparent"
                                        border.color: Theme.accent
                                        border.width: 1
                                        Label {
                                            anchors.centerIn: parent
                                            text: "Gán"
                                            color: assignMa.containsMouse ? "white" : Theme.accent
                                            font.pixelSize: 10
                                            font.bold: true
                                        }
                                        MouseArea {
                                            id: assignMa
                                            anchors.fill: parent
                                            hoverEnabled: true
                                            cursorShape: Qt.PointingHandCursor
                                            onClicked: tiktokModel.assign_channel(modelData.ch.channelId, panel.selectedAccountId)
                                        }
                                    }
                                }
                            }

                            Label {
                                anchors.centerIn: parent
                                visible: pickerList.count === 0
                                text: "Không còn kênh để gán"
                                color: Theme.textMuted
                                font.pixelSize: 11
                            }
                        }

                        Rectangle { Layout.fillWidth: true; height: 1; color: Theme.border }

                        // ─ Caption ─
                        Label {
                            text: "CAPTION KHI ĐĂNG"
                            color: Theme.textMuted
                            font.pixelSize: 10
                            font.bold: true
                        }

                        RowLayout {
                            spacing: 16
                            RadioButton {
                                id: captionAuto
                                text: "Tự động (tiêu đề YouTube)"
                                font.pixelSize: 12
                                checked: panel.selAcc && panel.selAcc.captionMode !== "custom"
                                onClicked: tiktokModel.set_caption_mode(panel.selectedAccountId, "auto")
                            }
                            RadioButton {
                                id: captionCustom
                                text: "Tự nhập"
                                font.pixelSize: 12
                                checked: panel.selAcc && panel.selAcc.captionMode === "custom"
                                onClicked: tiktokModel.set_caption_mode(panel.selectedAccountId, "custom")
                            }
                        }

                        TextField {
                            id: tplInput
                            visible: panel.selAcc && panel.selAcc.captionMode === "custom"
                            Layout.fillWidth: true
                            placeholderText: "VD: {title} - Part {part} #fyp #viral"
                            font.pixelSize: 12
                            text: panel.selAcc ? (panel.selAcc.captionTemplate || "") : ""
                            onEditingFinished: {
                                if (panel.selectedAccountId)
                                    tiktokModel.set_caption_template(panel.selectedAccountId, text)
                            }
                        }
                        Label {
                            visible: tplInput.visible
                            text: "{title} = tiêu đề YouTube · {part} = số part (trống nếu không chia part)"
                            color: Theme.textMuted
                            font.pixelSize: 10
                        }

                        Rectangle { Layout.fillWidth: true; height: 1; color: Theme.border }

                        // ─ Lịch sử đăng ─
                        Label {
                            text: "LỊCH SỬ ĐĂNG GẦN ĐÂY"
                            color: Theme.textMuted
                            font.pixelSize: 10
                            font.bold: true
                        }

                        Repeater {
                            model: {
                                var out = []
                                if (typeof tiktokModel === "undefined" || !tiktokModel || !tiktokModel.history) return out
                                var h = tiktokModel.history
                                for (var i = 0; i < h.length; i++)
                                    if (h[i].accountId === panel.selectedAccountId) out.push(h[i])
                                return out.slice(0, 15)
                            }
                            delegate: Rectangle {
                                Layout.fillWidth: true
                                Layout.preferredHeight: histCol.implicitHeight + 12
                                radius: 4
                                color: index % 2 === 0 ? Theme.rowEven : "transparent"

                                ColumnLayout {
                                    id: histCol
                                    anchors.left: parent.left
                                    anchors.right: parent.right
                                    anchors.verticalCenter: parent.verticalCenter
                                    anchors.leftMargin: 8
                                    anchors.rightMargin: 8
                                    spacing: 2

                                    RowLayout {
                                        Layout.fillWidth: true
                                        spacing: 8
                                        Label {
                                            text: modelData.status === "uploaded" ? "✓" : "✗"
                                            color: modelData.status === "uploaded" ? Theme.success : Theme.error
                                            font.pixelSize: 12
                                            font.bold: true
                                        }
                                        Label {
                                            text: modelData.title
                                            color: Theme.text
                                            font.pixelSize: 12
                                            elide: Text.ElideRight
                                            Layout.fillWidth: true
                                        }
                                        // Pass 42: thời gian upload thực (hiệu năng)
                                        Label {
                                            visible: !!modelData.uploadMs
                                            text: modelData.uploadMs ? (modelData.uploadMs < 60000
                                                ? (modelData.uploadMs / 1000).toFixed(1) + "s"
                                                : (modelData.uploadMs / 60000).toFixed(1) + "p") : ""
                                            color: Theme.accent
                                            font.pixelSize: 10
                                            font.bold: true
                                        }
                                        Label {
                                            text: {
                                                var d = new Date(modelData.finishedAt)
                                                return Qt.formatDateTime(d, "dd/MM HH:mm")
                                            }
                                            color: Theme.textMuted
                                            font.pixelSize: 10
                                        }
                                        Rectangle {
                                            // Pass 47: hiện nút retry cho cả failed (thử lại)
                                            // và uploaded (đăng lại video khác / đăng lại sau fix).
                                            visible: modelData.status === "failed" || modelData.status === "uploaded"
                                            Layout.preferredWidth: retryLbl.implicitWidth + 12
                                            Layout.preferredHeight: 20
                                            radius: 3
                                            color: retryMa.containsMouse ? Theme.hoverBg : "transparent"
                                            border.color: Theme.border
                                            border.width: 1
                                            Label {
                                                id: retryLbl
                                                anchors.centerIn: parent
                                                // Pass 47: retryUpload kill+reopen Chrome, không
                                                // phải enqueue đơn giản — rõ nghĩa hơn "Đăng lại".
                                                text: modelData.status === "uploaded" ? "↻ Đăng lại" : "↻ Thử lại"
                                                color: Theme.accent
                                                font.pixelSize: 10
                                            }
                                            MouseArea {
                                                id: retryMa
                                                anchors.fill: parent
                                                hoverEnabled: true
                                                cursorShape: Qt.PointingHandCursor
                                                onClicked: tiktokModel.retry_upload(modelData.workspaceId)
                                            }
                                        }
                                    }
                                    Label {
                                        visible: !!modelData.error
                                        text: modelData.error || ""
                                        color: Theme.error
                                        font.pixelSize: 10
                                        elide: Text.ElideRight
                                        Layout.fillWidth: true
                                    }
                                }
                            }
                        }

                        Label {
                            visible: {
                                if (typeof tiktokModel === "undefined" || !tiktokModel || !tiktokModel.history) return true
                                var h = tiktokModel.history
                                for (var i = 0; i < h.length; i++)
                                    if (h[i].accountId === panel.selectedAccountId) return false
                                return true
                            }
                            text: "Chưa có lần đăng nào"
                            color: Theme.textMuted
                            font.pixelSize: 11
                        }

                        Item { Layout.preferredHeight: 8 }
                    }
                }
            }
        }
    }

    // MỘT Component.onCompleted duy nhất cho cả file — QML coi 2 lần gán cùng
    // một property là lỗi biên dịch ("Property value set multiple times") và
    // component KHÔNG load được → app không mở (sự cố 26/07 14:15, do pass 52
    // thêm onCompleted thứ hai cho ensureSelection).
    // MỘT Component.onCompleted duy nhất cho cả file (2 lần gán = lỗi biên dịch
    // "Property value set multiple times" → component không load → app không mở,
    // sự cố 26/07 14:15). Và KHÔNG gọi việc đồng bộ tại đây: `refresh()` spin
    // nested event loop ngay giữa lúc Loader đang tạo panel → binding loop
    // (sự cố 26/07 17:48). `refresh_soon()` là bản dồn-về-đầu-event-loop có sẵn
    // trong model, đúng cho tình huống này.
    Component.onCompleted: {
        if (typeof tiktokModel !== "undefined" && tiktokModel) {
            tiktokModel.refresh_soon()
        }
        Qt.callLater(function() { panel.ensureSelection() })
    }
}
