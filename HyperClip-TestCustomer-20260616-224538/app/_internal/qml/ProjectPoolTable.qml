// src/ui/qml/ProjectPoolTable.qml
// Redesign v2 trang Lõi quét — bảng pool project GCP FULL chiều ngang.
//
// Bản v1 nhét pool vào cột 480px: tên bị cắt, nút "Mở Console"/xóa bị xén,
// và lỗi không nghiêm trọng ("HTTP 404" của resolve handle) cũng phơi đỏ làm
// khách tưởng project chết. Bản này: mỗi project MỘT dòng đủ rộng, chỉ lỗi
// CHẶN (blocked) mới đỏ, và mọi cột thẳng hàng bằng width cố định.
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Rectangle {
    id: root
    color: Theme.cardBg
    border.color: quota && quota.projectCount === 0 ? Theme.error : Theme.border

    signal addProjectRequested()

     /// Project đang được "Kiểm tra lại" — khoá các nút test trong lúc chờ.
    property string testingId: ""

    // Multi-selection state
    property var selectedIds: ({})
    property int selectedCount: 0

    // Egress & Proxy mapping state
    property var egressMap: ({})

    function loadEgressMap() {
        if (typeof backend === "undefined" || !backend) return;
        try {
            var resp = backend.send_command("quota:summary")
            if (resp && resp.result && resp.result.projects) {
                var projs = resp.result.projects
                var map = {}
                for (var i = 0; i < projs.length; i++) {
                    var p = projs[i]
                    var pid = p.projectId || p.id
                    if (pid) {
                        map[pid] = p.egress || "direct"
                    }
                }
                root.egressMap = map
            }
        } catch (e) {
            console.warn("[ProjectPoolTable] loadEgressMap err:", e)
        }
    }

    function getEgress(projectId) {
        return (root.egressMap && root.egressMap[projectId]) || "direct"
    }

    function openProxyModal(projectId, currentEgress) {
        proxyConfigPopup.openFor(projectId, currentEgress)
    }

    Component.onCompleted: {
        loadEgressMap()
    }

    function isSelected(id) {
        return Boolean(root.selectedIds && root.selectedIds[id])
    }

    function toggleSelect(id) {
        var s = Object.assign({}, root.selectedIds)
        if (s[id]) delete s[id]
        else s[id] = true
        root.selectedIds = s
        root.selectedCount = Object.keys(s).length
    }

    function selectBrokenOnly() {
        var broken = (quota && quota.projects && typeof quota.projects.get_broken_project_ids === "function")
            ? quota.projects.get_broken_project_ids() : []
        if (!broken || broken.length === 0) {
            try {
                var resp = backend.send_command("quota:summary")
                if (resp && resp.result && resp.result.projects) {
                    var projs = resp.result.projects
                    broken = []
                    for (var i = 0; i < projs.length; i++) {
                        var p = projs[i]
                        if (p.blocked && p.error !== "Hết quota hôm nay" && p.projectId) {
                            broken.push(p.projectId)
                        }
                    }
                }
            } catch (err) {
                console.warn("[ProjectPoolTable] selectBrokenOnly err:", err)
            }
        }
        var s = {}
        for (var i = 0; i < broken.length; i++) {
            s[broken[i]] = true
        }
        root.selectedIds = s
        root.selectedCount = Object.keys(s).length
        if (root.selectedCount === 0) {
            if (typeof toastService !== "undefined" && toastService)
                toastService.show("Thông báo", "Hiện không có project nào bị lỗi hoặc bị đình chỉ!", "info")
        } else {
            if (typeof toastService !== "undefined" && toastService)
                toastService.show("Đã chọn key lỗi", "Đã chọn " + root.selectedCount + " project/key bị Google đình chỉ hoặc lỗi.", "warning")
        }
    }

    function selectAll() {
        var all = (quota && quota.projects && typeof quota.projects.get_all_project_ids === "function")
            ? quota.projects.get_all_project_ids() : []
        if (!all || all.length === 0) {
            try {
                var resp = backend.send_command("quota:summary")
                if (resp && resp.result && resp.result.projects) {
                    var projs = resp.result.projects
                    all = []
                    for (var i = 0; i < projs.length; i++) {
                        if (projs[i].projectId) all.push(projs[i].projectId)
                    }
                }
            } catch (err) {}
        }
        var s = {}
        for (var i = 0; i < all.length; i++) {
            s[all[i]] = true
        }
        root.selectedIds = s
        root.selectedCount = Object.keys(s).length
    }

    function clearSelection() {
        root.selectedIds = {}
        root.selectedCount = 0
    }

    function selectedBrokenCount() {
        var broken = (quota && quota.projects && typeof quota.projects.get_broken_project_ids === "function")
            ? quota.projects.get_broken_project_ids() : []
        if (!broken || broken.length === 0) {
            try {
                var resp = backend.send_command("quota:summary")
                if (resp && resp.result && resp.result.projects) {
                    var projs = resp.result.projects
                    broken = []
                    for (var i = 0; i < projs.length; i++) {
                        var p = projs[i]
                        if (p.blocked && p.error !== "Hết quota hôm nay" && p.projectId) {
                            broken.push(p.projectId)
                        }
                    }
                }
            } catch (err) {}
        }
        var cnt = 0
        for (var i = 0; i < broken.length; i++) {
            if (root.selectedIds && root.selectedIds[broken[i]]) cnt++
        }
        return cnt
    }

    function promptBatchRemove() {
        var ids = Object.keys(root.selectedIds)
        if (ids.length === 0) return
        confirmBatchPopup.openFor(ids)
    }

    function executeBatchRemove(ids) {
        if (!ids || ids.length === 0) return
        Qt.callLater(function() {
            backend.send_command("project:removeBatch", {"projectIds": ids})
            root.clearSelection()
            if (typeof toastService !== "undefined" && toastService) {
                toastService.show("Đã dọn dẹp API keys", "Đã xoá " + ids.length + " project/key khỏi pool quét.", "success")
            }
            if (quota) quota.refresh_from_backend(backend)
        })
    }

    // Cột cố định — header và hàng dùng CHUNG các số này nên không thể lệch.
    readonly property int colCheck: 28
    readonly property int colEgress: 120
    readonly property int colBar: 160
    readonly property int colNumbers: 96
    readonly property int colConsole: 96
    readonly property int colActions: 88

    /// Trang Console đúng với loại lỗi — triết lý GcpWizard: mỗi lỗi một nút
    /// mở đúng chỗ phải sửa, không bắt khách tự mò.
    function consoleUrlFor(projectId, errText) {
        // Key lẻ chưa gán project ("key:AIza…") không deep-link được.
        const q = projectId.indexOf("key:") === 0 ? "" : "?project=" + projectId
        const e = (errText || "").toLowerCase()
        if (e.indexOf("chưa bật") >= 0 || e.indexOf("accessnotconfigured") >= 0)
            return "https://console.cloud.google.com/apis/library/youtube.googleapis.com" + q
        return "https://console.cloud.google.com/apis/credentials" + q
    }

    function testProject(projectId) {
        root.testingId = projectId
        Qt.callLater(function() {
            const resp = backend.send_command("project:testOne", {"projectId": projectId})
            root.testingId = ""
            const r = (resp && resp.result) || {}
            if (!resp || resp.ok === false || !r.success) {
                if (toastService) toastService.show("Không kiểm tra được",
                    (resp && resp.error) || r.error || "", "error")
                return
            }
            if (r.ok) {
                if (toastService) toastService.show("Project dùng được",
                    projectId + " đã quay lại vòng xoay quét", "success")
            } else {
                if (toastService) toastService.show("Project vẫn hỏng", r.error || "", "warning")
            }
            if (quota) quota.refresh_from_backend(backend)
        })
    }

    function removeProject(projectId, name) {
        confirmRemove.openFor(projectId, name || projectId, function(id) {
            Qt.callLater(function() {
                backend.send_command("project:remove", {"projectId": id})
                if (toastService) toastService.show("Đã xoá project",
                    id + " không còn trong pool quét", "info")
                if (quota) quota.refresh_from_backend(backend)
            })
        })
    }

    ConfirmationDialog {
        id: confirmRemove
        anchors.centerIn: Overlay.overlay
    }

    // Modal xác nhận xoá hàng loạt
    Popup {
        id: confirmBatchPopup
        modal: true
        focus: true
        closePolicy: Popup.CloseOnEscape | Popup.CloseOnPressOutside
        anchors.centerIn: Overlay.overlay
        width: 420
        padding: 20

        property var idsToRemove: []

        function openFor(ids) {
            idsToRemove = ids
            open()
        }

        background: Rectangle {
            color: Theme.cardBg
            border.color: Theme.error
            border.width: 1
            radius: Theme.radiusLg
        }

        contentItem: ColumnLayout {
            spacing: 12
            RowLayout {
                spacing: 10
                Rectangle {
                    width: 36; height: 36; radius: 18
                    color: Theme.error + "25"
                    Icon {
                        name: "trash"
                        size: 18
                        color: Theme.error
                        anchors.centerIn: parent
                    }
                }
                ColumnLayout {
                    Layout.fillWidth: true
                    spacing: 2
                    Label {
                        text: "XÁC NHẬN XOÁ HÀNG LOẠT"
                        color: Theme.error
                        font.pixelSize: 13
                        font.bold: true
                    }
                    Label {
                        text: "Xoá " + confirmBatchPopup.idsToRemove.length + " project / API key"
                        color: Theme.text
                        font.pixelSize: 15
                        font.bold: true
                    }
                }
            }

            Label {
                Layout.fillWidth: true
                text: "Bạn có chắc chắn muốn xoá " + confirmBatchPopup.idsToRemove.length + " project/key đã chọn khỏi pool quét không?\n\n• Trong đó có " + root.selectedBrokenCount() + " project đang bị Google đình chỉ hoặc báo lỗi.\n• Các project này sẽ bị xoá khỏi danh sách quét ngay lập tức."
                color: Theme.textMuted
                font.pixelSize: 12
                wrapMode: Text.WordWrap
            }

            RowLayout {
                Layout.fillWidth: true
                Layout.topMargin: 8
                spacing: 8
                Item { Layout.fillWidth: true }
                IconButton {
                    iconName: "close"
                    label: "Hủy bỏ"
                    iconSize: 11
                    Layout.preferredHeight: 30
                    Layout.preferredWidth: 80
                    onClicked: confirmBatchPopup.close()
                }
                IconButton {
                    iconName: "trash"
                    label: "Xoá tất cả"
                    iconSize: 11
                    Layout.preferredHeight: 30
                    Layout.minimumWidth: 120
                    colorIdle: Theme.error + "35"
                    colorHover: Theme.error + "60"
                    border.color: Theme.error
                    iconColorIdle: Theme.error
                    iconColorHover: "#FFF"
                    onClicked: {
                        var ids = confirmBatchPopup.idsToRemove
                        confirmBatchPopup.close()
                        root.executeBatchRemove(ids)
                    }
                }
            }
        }
    }

    // Modal cấu hình Proxy cho từng Project
    Popup {
        id: proxyConfigPopup
        modal: true
        focus: true
        closePolicy: Popup.CloseOnEscape | Popup.CloseOnPressOutside
        anchors.centerIn: Overlay.overlay
        width: 480
        padding: 20

        property string projectId: ""
        property string currentEgress: ""
        property string testStatus: "idle" // "idle" | "testing" | "success" | "error"
        property string statusMsg: ""
        property int latencyMs: 0

        function openFor(pid, eg) {
            projectId = pid
            currentEgress = eg || "direct"
            testStatus = "idle"
            statusMsg = ""
            latencyMs = 0
            proxyInput.text = (currentEgress === "direct") ? "" : currentEgress
            open()
            proxyInput.forceActiveFocus()
        }

        background: Rectangle {
            color: Theme.cardBg
            border.color: proxyConfigPopup.testStatus === "error" ? Theme.error : Theme.accent
            border.width: 1
            radius: Theme.radiusLg
        }

        contentItem: ColumnLayout {
            spacing: 14

            // Header
            RowLayout {
                spacing: 10
                Rectangle {
                    width: 36; height: 36; radius: 18
                    color: Theme.accent + "25"
                    Icon {
                        name: "globe"
                        size: 18
                        color: Theme.accent
                        anchors.centerIn: parent
                    }
                }
                ColumnLayout {
                    Layout.fillWidth: true
                    spacing: 2
                    Label {
                        text: "CẤU HÌNH PROXY / ĐƯỜNG RA"
                        color: Theme.accent
                        font.pixelSize: 13
                        font.bold: true
                    }
                    Label {
                        text: "Project: " + proxyConfigPopup.projectId
                        color: Theme.text
                        font.pixelSize: 14
                        font.bold: true
                    }
                }
            }

            // Info hiện tại
            Rectangle {
                Layout.fillWidth: true
                Layout.preferredHeight: 32
                radius: Theme.radiusMd
                color: Theme.surface
                border.color: Theme.border
                border.width: 1

                RowLayout {
                    anchors.fill: parent
                    anchors.leftMargin: 10
                    anchors.rightMargin: 10
                    spacing: 6

                    Label {
                        text: "Đường ra hiện tại:"
                        color: Theme.textMuted
                        font.pixelSize: 11
                    }
                    Label {
                        text: proxyConfigPopup.currentEgress === "direct" ? "Đi thẳng (Direct IP máy)" : ("Proxy: " + proxyConfigPopup.currentEgress)
                        color: proxyConfigPopup.currentEgress === "direct" ? Theme.text : Theme.accent
                        font.pixelSize: 11
                        font.bold: true
                        Layout.fillWidth: true
                    }
                }
            }

            // Input TextField
            ColumnLayout {
                Layout.fillWidth: true
                spacing: 6

                Label {
                    text: "ĐỊA CHỈ PROXY:"
                    color: Theme.textMuted
                    font.pixelSize: 10
                    font.bold: true
                }

                TextField {
                    id: proxyInput
                    Layout.fillWidth: true
                    Layout.preferredHeight: 34
                    placeholderText: "Ví dụ: 103.152.1.2:8080:user:pass hoặc http://user:pass@ip:port"
                    font.pixelSize: 12
                    color: Theme.text
                    selectByMouse: true
                    background: Rectangle {
                        color: Theme.inputBg
                        border.color: proxyInput.activeFocus ? Theme.accent : Theme.border
                        border.width: 1
                        radius: Theme.radiusSm
                    }
                    onAccepted: saveBtn.clicked()
                }

                Label {
                    text: "Hỗ trợ định dạng chuẩn http://user:pass@ip:port hoặc MMO: ip:port:user:pass, ip:port. Để trống để chạy Direct."
                    color: Theme.textMuted
                    font.pixelSize: 10
                    wrapMode: Text.WordWrap
                    Layout.fillWidth: true
                }
            }

            // Khung phản hồi trạng thái kiểm tra (Live Check Alert)
            Rectangle {
                visible: proxyConfigPopup.testStatus !== "idle"
                Layout.fillWidth: true
                Layout.preferredHeight: alertCol.implicitHeight + 16
                radius: Theme.radiusMd
                color: proxyConfigPopup.testStatus === "testing" ? (Theme.accent + "18")
                     : (proxyConfigPopup.testStatus === "success" ? (Theme.success + "1C") : (Theme.error + "1C"))
                border.color: proxyConfigPopup.testStatus === "testing" ? Theme.accent
                     : (proxyConfigPopup.testStatus === "success" ? Theme.success : Theme.error)
                border.width: 1

                RowLayout {
                    id: alertCol
                    anchors.fill: parent
                    anchors.margins: 10
                    spacing: 8

                    Icon {
                        name: proxyConfigPopup.testStatus === "testing" ? "pending"
                            : (proxyConfigPopup.testStatus === "success" ? "check" : "warning")
                        size: 14
                        color: proxyConfigPopup.testStatus === "testing" ? Theme.accent
                             : (proxyConfigPopup.testStatus === "success" ? Theme.success : Theme.error)
                    }

                    Label {
                        text: proxyConfigPopup.statusMsg
                        color: proxyConfigPopup.testStatus === "testing" ? Theme.text
                             : (proxyConfigPopup.testStatus === "success" ? Theme.success : Theme.error)
                        font.pixelSize: 11
                        font.bold: proxyConfigPopup.testStatus !== "testing"
                        wrapMode: Text.WordWrap
                        Layout.fillWidth: true
                    }
                }
            }

            // Hàng nút bấm
            RowLayout {
                Layout.fillWidth: true
                Layout.topMargin: 6
                spacing: 8

                // Nút Chạy Direct
                IconButton {
                    visible: proxyConfigPopup.currentEgress !== "direct"
                    iconName: "refresh"
                    label: "Về Direct"
                    iconSize: 10
                    Layout.preferredHeight: 30
                    ToolTip.text: "Xóa proxy, quay về kết nối trực tiếp"
                    ToolTip.visible: hovered
                    onClicked: {
                        proxyInput.text = ""
                        saveBtn.clicked()
                    }
                }

                Item { Layout.fillWidth: true }

                IconButton {
                    iconName: "close"
                    label: "Hủy bỏ"
                    iconSize: 10
                    Layout.preferredHeight: 30
                    onClicked: proxyConfigPopup.close()
                }

                // Nút Kiểm tra kết nối độc lập
                IconButton {
                    id: testBtn
                    iconName: "globe"
                    label: proxyConfigPopup.testStatus === "testing" ? "Đang test..." : "Kiểm tra kết nối"
                    iconSize: 11
                    Layout.preferredHeight: 30
                    enabled: proxyConfigPopup.testStatus !== "testing"
                    colorIdle: Theme.surface
                    colorHover: Theme.surfaceHover
                    border.color: Theme.accent
                    iconColorIdle: Theme.accent
                    onClicked: {
                        var pVal = proxyInput.text.trim()
                        if (!pVal || pVal.toLowerCase() === "direct") {
                            proxyConfigPopup.testStatus = "success"
                            proxyConfigPopup.statusMsg = "Kết nối Direct: Sử dụng trực tiếp IP đường truyền của máy."
                            return
                        }
                        proxyConfigPopup.testStatus = "testing"
                        proxyConfigPopup.statusMsg = "Đang kiểm tra kết nối qua proxy tới Google (timeout 6s)..."
                        Qt.callLater(function() {
                            var resp = backend.send_command("project:testProxy", {"proxy": pVal, "timeoutSec": 6})
                            if (resp && resp.ok && resp.result && resp.result.success) {
                                proxyConfigPopup.testStatus = "success"
                                proxyConfigPopup.latencyMs = resp.result.pingMs || resp.result.rttMs || resp.result.latencyMs || 0
                                proxyConfigPopup.statusMsg = "Kết nối Google OK! Độ trễ: " + proxyConfigPopup.latencyMs + "ms — Đường ra: " + resp.result.egress
                                if (typeof toastService !== "undefined" && toastService)
                                    toastService.show("Proxy dùng tốt", "Độ trễ phản hồi Google: " + proxyConfigPopup.latencyMs + "ms", "success")
                            } else {
                                proxyConfigPopup.testStatus = "error"
                                proxyConfigPopup.statusMsg = (resp && (resp.error || (resp.result && resp.result.error))) || "Không thể kết nối qua proxy!"
                                if (typeof toastService !== "undefined" && toastService)
                                    toastService.show("Lỗi Proxy", proxyConfigPopup.statusMsg, "error")
                            }
                        })
                    }
                }

                // Nút Kiểm tra & Lưu
                IconButton {
                    id: saveBtn
                    iconName: "check"
                    label: "Lưu cấu hình"
                    iconSize: 11
                    Layout.preferredHeight: 30
                    colorIdle: Theme.accent + "30"
                    colorHover: Theme.accent + "55"
                    border.color: Theme.accent
                    iconColorIdle: Theme.accent
                    enabled: proxyConfigPopup.testStatus !== "testing"
                    onClicked: {
                        var pVal = proxyInput.text.trim()
                        proxyConfigPopup.testStatus = "testing"
                        proxyConfigPopup.statusMsg = "Đang xác thực và lưu proxy..."
                        Qt.callLater(function() {
                            var resp = backend.send_command("project:setProxy", {
                                "id": proxyConfigPopup.projectId,
                                "proxy": pVal
                            })
                            if (resp && resp.ok && resp.result && resp.result.success) {
                                proxyConfigPopup.close()
                                if (typeof toastService !== "undefined" && toastService) {
                                    var msg = pVal ? ("Đã gán proxy (" + resp.result.egress + ") với độ trễ " + (resp.result.pingMs || resp.result.rttMs || resp.result.latencyMs || 0) + "ms")
                                                   : "Đã chuyển project về kết nối Direct"
                                    toastService.show("Cấu hình thành công", msg, "success")
                                }
                                root.loadEgressMap()
                                if (quota) quota.reload_projects(backend)
                            } else {
                                proxyConfigPopup.testStatus = "error"
                                var errText = (resp && (resp.error || (resp.result && resp.result.error))) || "Lỗi lưu proxy!"
                                proxyConfigPopup.statusMsg = errText
                                if (typeof toastService !== "undefined" && toastService)
                                    toastService.show("Lỗi cấu hình Proxy", errText, "error")
                            }
                        })
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
                text: "POOL PROJECT GCP"
                color: Theme.accent
                font.pixelSize: 13
                font.bold: true
                font.letterSpacing: 0.6
            }
            Label {
                text: quota ? ("— " + quota.projectCount + " project") : ""
                color: Theme.textMuted
                font.pixelSize: 11
            }

            // Nút bấm chọn nhanh các key bị lỗi / đình chỉ
            IconButton {
                visible: quota && quota.brokenProjects > 0
                iconName: "alert"
                label: "Chọn " + (quota ? quota.brokenProjects : 0) + " key bị đình chỉ"
                iconSize: 11
                Layout.preferredHeight: 26
                colorIdle: Theme.error + "20"
                colorHover: Theme.error + "40"
                border.color: Theme.error
                iconColorIdle: Theme.error
                ToolTip.text: "Tự động chọn tất cả các project/key đang bị Google đình chỉ hoặc lỗi cấu hình để xoá nhanh"
                ToolTip.visible: hovered
                ToolTip.delay: 300
                onClicked: root.selectBrokenOnly()
            }

            Item { Layout.fillWidth: true }

            // Nút chọn tất cả / bỏ chọn
            IconButton {
                visible: quota && quota.projectCount > 0
                iconName: root.selectedCount > 0 ? "close" : "check"
                label: root.selectedCount > 0 ? ("Bỏ chọn (" + root.selectedCount + ")") : "Chọn tất cả"
                iconSize: 11
                Layout.preferredHeight: 26
                onClicked: root.selectedCount > 0 ? root.clearSelection() : root.selectAll()
            }

            IconButton {
                iconName: "add"
                label: "Thêm project"
                iconSize: 11
                Layout.preferredHeight: 26
                onClicked: root.addProjectRequested()
            }
            IconButton {
                iconName: "refresh"
                label: "Nạp lại"
                iconSize: 11
                Layout.preferredHeight: 26
                ToolTip.text: "Nạp lại pool + số liệu từ đĩa"
                ToolTip.visible: hovered
                ToolTip.delay: 400
                onClicked: if (quota) quota.reload_projects(backend)
            }
        }

        // ─── Thanh tác vụ hàng loạt (Hiện khi có item được chọn) ───
        Rectangle {
            visible: root.selectedCount > 0
            Layout.fillWidth: true
            Layout.preferredHeight: 38
            radius: Theme.radiusMd
            color: root.selectedBrokenCount() > 0 ? (Theme.error + "18") : (Theme.accent + "18")
            border.color: root.selectedBrokenCount() > 0 ? Theme.error : Theme.accent
            border.width: 1

            RowLayout {
                anchors.fill: parent
                anchors.leftMargin: 12
                anchors.rightMargin: 12
                spacing: 10

                Icon {
                    name: "check"
                    size: 14
                    color: root.selectedBrokenCount() > 0 ? Theme.error : Theme.accent
                }

                Label {
                    text: "Đã chọn <b>" + root.selectedCount + "</b> project" +
                          (root.selectedBrokenCount() > 0 ? " (trong đó có <font color='" + Theme.error + "'><b>" + root.selectedBrokenCount() + "</b> key bị đình chỉ/lỗi</font>)" : "")
                    color: Theme.text
                    font.pixelSize: 12
                    Layout.fillWidth: true
                }

                IconButton {
                    iconName: "trash"
                    label: "Xoá " + root.selectedCount + " project đã chọn"
                    iconSize: 11
                    Layout.preferredHeight: 26
                    colorIdle: Theme.error + "30"
                    colorHover: Theme.error + "50"
                    border.color: Theme.error
                    iconColorIdle: Theme.error
                    onClicked: root.promptBatchRemove()
                }

                IconButton {
                    iconName: "close"
                    label: "Bỏ chọn"
                    iconSize: 10
                    Layout.preferredHeight: 26
                    onClicked: root.clearSelection()
                }
            }
        }

        // ─── Trạng thái rỗng ───────────────────────────────────────
        ColumnLayout {
            Layout.fillWidth: true
            Layout.fillHeight: true
            visible: !quota || quota.projectCount === 0
            spacing: 6
            Item { Layout.fillHeight: true }
            Label {
                text: "Chưa có project GCP nào — hệ thống KHÔNG quét được."
                color: Theme.error
                font.pixelSize: 14
                font.bold: true
                Layout.alignment: Qt.AlignHCenter
            }
            Label {
                text: "Lõi phát hiện video chạy hoàn toàn bằng YouTube Data API v3. Bấm \"Thêm project\" — dán được cả danh sách key một lúc, app kiểm chứng từng cái bằng lời gọi thật."
                color: Theme.textMuted
                font.pixelSize: 12
                wrapMode: Text.WordWrap
                horizontalAlignment: Text.AlignHCenter
                Layout.preferredWidth: 520
                Layout.alignment: Qt.AlignHCenter
            }
            Item { Layout.fillHeight: true }
        }

        // ─── Tiêu đề cột ───────────────────────────────────────────
        // Cùng lề 8px hai bên như hàng dữ liệu — lề khác nhau là cột lệch.
        RowLayout {
            visible: quota && quota.projectCount > 0
            Layout.fillWidth: true
            Layout.leftMargin: 8
            Layout.rightMargin: 8
            spacing: 8

            // Cột checkbox chọn tất cả
            Rectangle {
                Layout.preferredWidth: root.colCheck
                Layout.preferredHeight: 16
                color: "transparent"
                Rectangle {
                    anchors.centerIn: parent
                    width: 14; height: 14; radius: 3
                    color: root.selectedCount > 0 ? Theme.accent : "transparent"
                    border.color: root.selectedCount > 0 ? Theme.accent : Theme.border
                    border.width: 1
                    Icon {
                        name: "check"
                        size: 9
                        color: "#FFFFFF"
                        visible: root.selectedCount > 0
                        anchors.centerIn: parent
                    }
                    MouseArea {
                        anchors.fill: parent
                        hoverEnabled: true
                        cursorShape: Qt.PointingHandCursor
                        onClicked: root.selectedCount > 0 ? root.clearSelection() : root.selectAll()
                    }
                }
            }

            // Cell 1 dựng cùng bộ xương với hàng (chỗ trống 7px thế chân dot)
            // để footprint fill-share giống hệt nhau.
            RowLayout {
                Layout.fillWidth: true
                Layout.preferredWidth: 0
                spacing: 6
                Item { Layout.preferredWidth: 7 }
                Label {
                    text: "PROJECT"
                    color: Theme.textMuted; font.pixelSize: 9; font.bold: true
                    Layout.fillWidth: true
                    Layout.minimumWidth: 0
                }
            }
            Label {
                text: "ĐƯỜNG RA (EGRESS)"
                color: Theme.textMuted; font.pixelSize: 9; font.bold: true
                Layout.preferredWidth: root.colEgress
            }
            Label {
                text: "MỨC TIÊU HÔM NAY"
                color: Theme.textMuted; font.pixelSize: 9; font.bold: true
                Layout.preferredWidth: root.colBar
            }
            Label {
                text: "ĐÃ DÙNG / TRẦN"
                color: Theme.textMuted; font.pixelSize: 9; font.bold: true
                Layout.preferredWidth: root.colNumbers
                horizontalAlignment: Text.AlignRight
            }
            Label {
                text: "LÝ DO HỎNG (chỉ project bị chặn)"
                color: Theme.textMuted; font.pixelSize: 9; font.bold: true
                Layout.fillWidth: true
                Layout.preferredWidth: 0
            }
            Item { Layout.preferredWidth: root.colConsole }
            Item { Layout.preferredWidth: root.colActions }
        }

        Rectangle {
            visible: quota && quota.projectCount > 0
            Layout.fillWidth: true; Layout.preferredHeight: 1; color: Theme.border
        }

        // ─── Danh sách ─────────────────────────────────────────────
        ListView {
            id: projList
            visible: quota && quota.projectCount > 0
            Layout.fillWidth: true
            Layout.fillHeight: true
            model: quota ? quota.projects : null
            clip: true
            spacing: 1
            boundsBehavior: Flickable.StopAtBounds
            ScrollBar.vertical: ScrollBar { }

            delegate: Rectangle {
                id: projRow
                width: projList.width
                height: 34
                radius: 3
                color: root.isSelected(projRow.pId) ? (Theme.accent + "1C")
                     : (projRow.pBlocked ? Theme.error + "0C"
                     : (index % 2 === 0 ? Theme.rowEven : "transparent"))
                border.color: root.isSelected(projRow.pId) ? (Theme.accent + "60") : "transparent"
                border.width: 1

                // Sao chép roles lên delegate: trong closure `model` có thể đã
                // chết theo delegate (bẫy 18/07).
                readonly property string pId: model.projectId
                readonly property string pName: model.name || model.projectId
                readonly property string pError: model.errorText || ""
                readonly property bool pBlocked: model.blocked

                RowLayout {
                    anchors.fill: parent
                    anchors.leftMargin: 8
                    anchors.rightMargin: 8
                    spacing: 8

                    // Checkbox chọn từng dòng
                    Rectangle {
                        Layout.preferredWidth: root.colCheck
                        Layout.preferredHeight: 18
                        color: "transparent"
                        Rectangle {
                            anchors.centerIn: parent
                            width: 15; height: 15; radius: 3
                            color: root.isSelected(projRow.pId) ? Theme.accent : "transparent"
                            border.color: root.isSelected(projRow.pId) ? Theme.accent : (projRow.pBlocked ? Theme.error : Theme.border)
                            border.width: 1
                            Icon {
                                name: "check"
                                size: 10
                                color: "#FFFFFF"
                                visible: root.isSelected(projRow.pId)
                                anchors.centerIn: parent
                            }
                            MouseArea {
                                anchors.fill: parent
                                hoverEnabled: true
                                cursorShape: Qt.PointingHandCursor
                                onClicked: root.toggleSelect(projRow.pId)
                            }
                        }
                    }

                    // Project
                    RowLayout {
                        Layout.fillWidth: true
                        // preferredWidth 0: chia chỗ theo tỉ lệ fill, KHÔNG theo
                        // độ dài tên — tên dài từng đẩy lệch cả hàng (bug v1).
                        Layout.preferredWidth: 0
                        spacing: 6
                        StatusDot {
                            state: projRow.pBlocked ? "error" : (model.available > 0 ? "running" : "idle")
                            size: 7
                            showRing: !projRow.pBlocked && model.available > 0
                        }
                        Label {
                            text: projRow.pName
                            color: Theme.text
                            font.pixelSize: 12
                            elide: Text.ElideRight
                            Layout.fillWidth: true
                            Layout.minimumWidth: 0
                            ToolTip.text: projRow.pName
                            ToolTip.visible: nameMa.containsMouse && truncated
                            ToolTip.delay: 500
                            MouseArea {
                                id: nameMa
                                anchors.fill: parent
                                hoverEnabled: true
                                acceptedButtons: Qt.NoButton
                            }
                        }
                        Label {
                            visible: !model.hasKey
                            text: "OAuth"
                            color: Theme.textMuted
                            font.pixelSize: 9
                        }
                    }

                    // ĐƯỜNG RA (EGRESS BADGE)
                    Rectangle {
                        Layout.preferredWidth: root.colEgress
                        Layout.preferredHeight: 22
                        radius: 4
                        readonly property string egressVal: (typeof model.egress !== "undefined" && model.egress) ? model.egress : root.getEgress(projRow.pId)
                        readonly property bool isDirect: egressVal === "direct" || egressVal === ""
                        color: isDirect ? Theme.surface : (Theme.accent + "18")
                        border.color: isDirect ? Theme.border : Theme.accent
                        border.width: 1

                        RowLayout {
                            anchors.fill: parent
                            anchors.leftMargin: 6
                            anchors.rightMargin: 6
                            spacing: 4

                            Icon {
                                name: "globe"
                                size: 10
                                color: parent.parent.isDirect ? Theme.textMuted : Theme.accent
                            }

                            Label {
                                text: parent.parent.isDirect ? "Direct" : parent.parent.egressVal
                                color: parent.parent.isDirect ? Theme.textMuted : Theme.accent
                                font.pixelSize: 10
                                font.bold: !parent.parent.isDirect
                                elide: Text.ElideMiddle
                                Layout.fillWidth: true
                            }
                        }

                        ToolTip.text: (isDirect ? "Đang chạy trực tiếp bằng IP máy (Direct)" : ("Proxy: " + egressVal)) + " — Bấm để cấu hình"
                        ToolTip.visible: egressMa.containsMouse
                        ToolTip.delay: 400

                        MouseArea {
                            id: egressMa
                            anchors.fill: parent
                            hoverEnabled: true
                            cursorShape: Qt.PointingHandCursor
                            onClicked: {
                                var eg = (typeof model.egress !== "undefined" && model.egress) ? model.egress : root.getEgress(projRow.pId)
                                root.openProxyModal(projRow.pId, eg)
                            }
                        }
                    }

                    // Thanh mức tiêu
                    Rectangle {
                        Layout.preferredWidth: root.colBar
                        Layout.preferredHeight: 6
                        radius: 3
                        color: Theme.bg
                        border.color: Theme.border
                        border.width: 1
                        Rectangle {
                            anchors.left: parent.left
                            anchors.verticalCenter: parent.verticalCenter
                            anchors.leftMargin: 1
                            height: parent.height - 2
                            width: Math.max(0, (parent.width - 2) * model.percent)
                            radius: 2
                            color: projRow.pBlocked ? Theme.error
                                 : model.percent > 0.9 ? "#FFD93D" : Theme.success
                        }
                    }

                    Label {
                        text: model.used + " / " + model.cap
                        color: projRow.pBlocked ? Theme.error : Theme.textMuted
                        font.pixelSize: 11
                        font.family: "monospace"
                        Layout.preferredWidth: root.colNumbers
                        horizontalAlignment: Text.AlignRight
                    }

                    // Lý do hỏng — CHỈ khi bị chặn. Lỗi vặt không chặn (resolve
                    // handle 404…) từng phơi đỏ cả bảng làm khách tưởng pool chết.
                    Label {
                        text: projRow.pBlocked ? projRow.pError : ""
                        color: Theme.error
                        font.pixelSize: 11
                        elide: Text.ElideRight
                        Layout.fillWidth: true
                        Layout.preferredWidth: 0
                        Layout.minimumWidth: 0
                        ToolTip.text: projRow.pError
                        ToolTip.visible: errMa.containsMouse && projRow.pBlocked
                        ToolTip.delay: 300
                        MouseArea {
                            id: errMa
                            anchors.fill: parent
                            hoverEnabled: true
                            acceptedButtons: Qt.NoButton
                        }
                    }

                    // Mở Console — cũng chỉ có nghĩa khi có gì đó phải sửa.
                    Item {
                        Layout.preferredWidth: root.colConsole
                        Layout.preferredHeight: 24
                        IconButton {
                            anchors.fill: parent
                            visible: projRow.pBlocked
                            iconName: "forward"
                            label: "Mở Console"
                            iconSize: 10
                            onClicked: backend.send_command_async("system:openUrl",
                                {"url": root.consoleUrlFor(projRow.pId, projRow.pError)})
                        }
                    }

                    RowLayout {
                        Layout.preferredWidth: root.colActions
                        spacing: 4
                        IconButton {
                            iconName: "globe"
                            iconSize: 11
                            Layout.preferredWidth: 26
                            Layout.preferredHeight: 24
                            iconColorIdle: Theme.textMuted
                            iconColorHover: Theme.accent
                            ToolTip.text: "Cấu hình Proxy cho project này"
                            ToolTip.visible: hovered
                            ToolTip.delay: 400
                            onClicked: {
                                var eg = (typeof model.egress !== "undefined" && model.egress) ? model.egress : root.getEgress(projRow.pId)
                                root.openProxyModal(projRow.pId, eg)
                            }
                        }
                        IconButton {
                            iconName: "retry"
                            iconSize: 11
                            Layout.preferredWidth: 26
                            Layout.preferredHeight: 24
                            enabled: root.testingId === ""
                            opacity: root.testingId === projRow.pId ? 0.4 : 1.0
                            ToolTip.text: "Kiểm tra lại bằng lời gọi thật — key dùng được thì project quay lại vòng xoay ngay"
                            ToolTip.visible: hovered
                            ToolTip.delay: 400
                            onClicked: root.testProject(projRow.pId)
                        }
                        IconButton {
                            iconName: "trash"
                            iconSize: 11
                            Layout.preferredWidth: 26
                            Layout.preferredHeight: 24
                            iconColorHover: Theme.error
                            ToolTip.text: "Xoá project khỏi pool quét"
                            ToolTip.visible: hovered
                            ToolTip.delay: 400
                            onClicked: root.removeProject(projRow.pId, projRow.pName)
                        }
                    }
                }
            }
        }
    }
}
