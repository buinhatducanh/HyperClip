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
import "ProjectActions.js" as PA

Rectangle {
    id: root
    color: Theme.cardBg
    border.color: quota && quota.projectCount === 0 ? Theme.error : Theme.border
    border.width: 1
    radius: Theme.radiusLg

    signal addProjectRequested()

    /// Project đang được "Kiểm tra lại" — khoá các nút test trong lúc chờ.
    property string testingId: ""

    // Cột cố định — header và hàng dùng CHUNG các số này nên không thể lệch.
    readonly property int colBar: 170
    readonly property int colNumbers: 96
    readonly property int colConsole: 96
    readonly property int colActions: 58
    readonly property int colEgress: 140

    // Ba hành động pool project dùng chung với QuotaPoolCard — logic ở
    // ProjectActions.js (trước đây copy nguyên văn ở cả hai file).
    readonly property var paDeps: ({ backend: backend, toast: (typeof toastService !== "undefined" ? toastService : null), quota: quota })
    function consoleUrlFor(projectId, errText) { return PA.consoleUrlFor(projectId, errText) }
    function testProject(projectId) { PA.testProject(root, root.paDeps, projectId) }
    function removeProject(projectId, name) { PA.removeProject(confirmRemove, root.paDeps, projectId, name) }

    property var egressMap: ({})
    function loadEgressMap() {
        if (typeof backend === "undefined" || !backend) return;
        try {
            var resp = backend.send_command("project:getEgressMap")
            if (resp && resp.ok && resp.result) {
                egressMap = resp.result
            }
        } catch (e) {
            console.warn("[ProjectPoolTable] loadEgressMap err:", e)
        }
    }
    function getEgress(pid) {
        return (egressMap && egressMap[pid]) ? egressMap[pid] : "direct"
    }
    function openProxyModal(pid, eg) {
        proxyConfigPopup.openFor(pid, eg)
    }

    Component.onCompleted: loadEgressMap()

    ConfirmationDialog {
        id: confirmRemove
        anchors.centerIn: Overlay.overlay
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
                text: quota ? ("— " + quota.projectCount + " project, hỏng "
                               + quota.brokenProjects) : ""
                color: quota && quota.brokenProjects > 0 ? Theme.error : Theme.textMuted
                font.pixelSize: 11
            }
            Item { Layout.fillWidth: true }
            IconButton {
                // Pass 92: pool khách có ~20% key bị Google đình chỉ — xoá
                // từng cái qua dialog là cực hình, đây là lối thoát một phát.
                visible: quota && quota.brokenProjects > 0
                iconName: "delete"
                label: "Xoá " + (quota ? quota.brokenProjects : 0) + " hỏng"
                iconSize: 11
                Layout.preferredHeight: 26
                ToolTip.text: "Xoá mọi project có key đình chỉ / lỗi cấu hình (không đụng project chỉ hết quota hôm nay)"
                ToolTip.visible: hovered
                ToolTip.delay: 400
                onClicked: PA.removeAllBroken(confirmRemove, root.paDeps,
                                              quota ? quota.brokenProjects : 0)
            }
            IconButton {
                iconName: "add"
                label: "Thêm project"
                iconSize: 11
                Layout.preferredHeight: 26
                onClicked: root.addProjectRequested()
            }
            IconButton {
                iconName: "retry"
                label: "Reset Quota"
                iconSize: 11
                Layout.preferredHeight: 26
                ToolTip.text: "Kiểm tra kết nối Google và giải phóng sổ Quota nếu Google đã reset (hoặc sau 14:00 VN)"
                ToolTip.visible: hovered
                ToolTip.delay: 400
                onClicked: {
                    var resp = backend.send_command("quota:forceReset", {"force": false})
                    var r = (resp && resp.result) ? resp.result : {}
                    if (quota) quota.refresh_from_backend(backend)
                    if (typeof toastService !== "undefined" && toastService) {
                        if (resp && resp.ok && r.success) {
                            toastService.show("Đã reset Quota", r.message || "Toàn bộ project đã được gỡ chặn và làm mới", "success")
                        } else {
                            var errMsg = (r && r.error) || (resp && resp.error) || "Chưa thể reset quota lúc này"
                            toastService.show("Chưa thể reset Quota", errMsg, "warning")
                        }
                    }
                }
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
                color: projRow.pBlocked ? Theme.error + "0C"
                     : (index % 2 === 0 ? Theme.rowEven : "transparent")

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
                                 : model.percent > 0.9 ? Theme.warning : Theme.success
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
