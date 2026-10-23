// src/ui/qml/QuotaPoolCard.qml
// Pass 56 — Sức khỏe lõi quét GCP: ngân sách units, nhịp thực tế, pool project.
//
// Đây là màn hình quan trọng nhất sau khi bỏ Innertube: quét chạy được hay
// không giờ phụ thuộc hoàn toàn vào quota. Vì vậy card này phải trả lời được
// ba câu trong một cái liếc: còn bao nhiêu, đang chạy nhịp nào, và có đủ tới
// lần reset không.
//
// Redesign trang Lõi quét: project hỏng phải đọc được TRỌN lý do (bản cũ cắt
// cụt 90px) và sửa được tại chỗ — kiểm tra lại / mở đúng trang Console / xoá.
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Rectangle {
    id: root
    Component.onCompleted: {
        if (typeof quota !== "undefined" && quota) {
            quota.refresh_from_backend(backend)
        }
    }
    color: Theme.cardBg
    border.color: quota && quota.exhausted ? Theme.error
                : (quota && quota.projectCount === 0 ? Theme.error : Theme.border)
    border.width: 1
    radius: Theme.radiusLg
    implicitHeight: col.implicitHeight + 24

    signal addProjectRequested()

    /// Project đang được "Kiểm tra lại" — khoá nút của đúng hàng đó.
    property string testingId: ""

    // Phần trăm ngân sách ĐÃ TIÊU trong ngày.
    readonly property real usedRatio: {
        if (!quota || quota.unitsTotal <= 0) return 0
        return Math.min(1, quota.unitsSpent / quota.unitsTotal)
    }
    readonly property int deadCount: quota ? quota.brokenProjects : 0
    readonly property color budgetColor: {
        if (!quota) return Theme.textMuted
        if (quota.exhausted) return Theme.error
        if (!quota.coversReset) return "#FFD93D"
        return Theme.success
    }

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
        // Hoãn ra khỏi stack click: send_command đồng bộ spin nested loop,
        // gọi thẳng trong onClicked là hủy delegate giữa chừng (crash 18/07).
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

    ColumnLayout {
        id: col
        anchors.fill: parent
        anchors.margins: 12
        spacing: 10

        // ─── Đầu card ──────────────────────────────────────────────
        RowLayout {
            Layout.fillWidth: true
            spacing: 8

            Icon { name: "settings"; size: 14; color: Theme.accent; Layout.alignment: Qt.AlignVCenter }
            Label {
                text: "LÕI QUÉT — GOOGLE CLOUD"
                color: Theme.accent
                font.pixelSize: 13
                font.bold: true
                font.letterSpacing: 0.6
                elide: Text.ElideRight
                Layout.minimumWidth: 0
            }
            Item { Layout.fillWidth: true }

            Rectangle {
                Layout.preferredHeight: 20
                Layout.preferredWidth: modeLabel.implicitWidth + 14
                radius: 10
                color: root.budgetColor + "20"
                border.color: root.budgetColor
                border.width: 1
                Label {
                    id: modeLabel
                    anchors.centerIn: parent
                    text: {
                        if (!quota || quota.projectCount === 0) return "CHƯA CÓ PROJECT"
                        if (quota.exhausted) return "HẾT QUOTA"
                        if (quota.throttled) return "ĐANG GIÃN NHỊP"
                        return "API — BÌNH THƯỜNG"
                    }
                    color: root.budgetColor
                    font.pixelSize: 10
                    font.bold: true
                }
            }

            IconButton {
                iconName: "add"
                label: "Thêm project"
                iconSize: 11
                Layout.preferredHeight: 24
                onClicked: root.addProjectRequested()
            }
            IconButton {
                iconName: "refresh"
                iconSize: 12
                Layout.preferredWidth: 28
                Layout.preferredHeight: 24
                ToolTip.text: "Nạp lại pool + số liệu"
                ToolTip.visible: hovered
                ToolTip.delay: 400
                onClicked: if (quota) quota.reload_projects(backend)
            }
        }

        // ─── Trạng thái rỗng ───────────────────────────────────────
        ColumnLayout {
            Layout.fillWidth: true
            visible: !quota || quota.projectCount === 0
            spacing: 4
            Label {
                text: "Chưa có project GCP nào — hệ thống KHÔNG quét được."
                color: Theme.error
                font.pixelSize: 13
                font.bold: true
            }
            Label {
                text: "Lõi phát hiện video chạy hoàn toàn bằng YouTube Data API v3. Bấm \"Thêm project\" để cấu hình (mất khoảng 3 phút cho project đầu tiên)."
                color: Theme.textMuted
                font.pixelSize: 11
                wrapMode: Text.WordWrap
                Layout.fillWidth: true
            }
        }

        // ─── Thanh ngân sách ───────────────────────────────────────
        ColumnLayout {
            Layout.fillWidth: true
            visible: quota && quota.projectCount > 0
            spacing: 4

            RowLayout {
                Layout.fillWidth: true
                Label {
                    text: quota ? (quota.unitsSpent.toLocaleString(Qt.locale(), "f", 0) + " / "
                                   + quota.unitsTotal.toLocaleString(Qt.locale(), "f", 0) + " units hôm nay") : "—"
                    color: Theme.text
                    font.pixelSize: 12
                    font.bold: true
                }
                Item { Layout.fillWidth: true }
                Label {
                    text: quota ? ("reset sau " + quota.resetCountdownStr) : ""
                    color: Theme.textMuted
                    font.pixelSize: 11
                    elide: Text.ElideRight
                    Layout.minimumWidth: 0
                }
            }

            Rectangle {
                Layout.fillWidth: true
                Layout.preferredHeight: 8
                radius: 4
                color: Theme.bg
                border.color: Theme.border
                border.width: 1
                Rectangle {
                    anchors.left: parent.left
                    anchors.verticalCenter: parent.verticalCenter
                    anchors.margins: 1
                    height: parent.height - 2
                    width: Math.max(0, (parent.width - 2) * root.usedRatio)
                    radius: 3
                    color: root.budgetColor
                    Behavior on width { NumberAnimation { duration: 300 } }
                }
            }

            Label {
                text: quota ? quota.runwayStr : ""
                color: quota && !quota.coversReset ? "#FFD93D" : Theme.textMuted
                font.pixelSize: 11
                font.bold: quota && !quota.coversReset
            }
        }

        // ─── Bốn ô chỉ số ──────────────────────────────────────────
        GridLayout {
            Layout.fillWidth: true
            visible: quota && quota.projectCount > 0
            columns: 4
            columnSpacing: 6
            rowSpacing: 6

            component Metric: Rectangle {
                property string metricLabel: ""
                property string metricValue: ""
                property color metricColor: Theme.text
                Layout.fillWidth: true
                Layout.preferredHeight: 44
                radius: Theme.radiusMd
                color: Theme.bg
                border.color: Theme.border
                border.width: 1
                ColumnLayout {
                    anchors.centerIn: parent
                    spacing: 1
                    Label {
                        text: metricValue
                        color: metricColor
                        font.pixelSize: 14
                        font.bold: true
                        Layout.alignment: Qt.AlignHCenter
                    }
                    Label {
                        text: metricLabel
                        color: Theme.textMuted
                        font.pixelSize: 9
                        Layout.alignment: Qt.AlignHCenter
                    }
                }
            }

            Metric {
                // Khi bị giãn, ghi luôn nhịp khách ĐẶT ngay trong nhãn — khách
                // phải thấy con số họ chỉnh không phải con số đang chạy.
                metricLabel: quota && quota.throttled
                    ? ("NHỊP (ĐẶT " + quota.desiredIntervalStr + ")")
                    : "NHỊP QUÉT"
                metricValue: quota ? quota.intervalStr : "—"
                metricColor: quota && quota.throttled ? "#FFD93D" : Theme.success
            }
            Metric {
                metricLabel: "UNITS / NHỊP"
                metricValue: quota ? String(quota.unitsPerTick) : "—"
                metricColor: Theme.accent
            }
            Metric {
                metricLabel: "ĐANG SOI"
                metricValue: quota ? String(quota.sentinelChannels + quota.hotChannels) : "—"
                metricColor: Theme.text
            }
            Metric {
                metricLabel: "ĐÃ ĐỦ HÔM NAY"
                metricValue: quota ? String(quota.satisfiedChannels) : "—"
                metricColor: quota && quota.satisfiedChannels > 0 ? Theme.success : Theme.textMuted
            }
        }

        Label {
            visible: quota && quota.throttled && !quota.exhausted
            Layout.fillWidth: true
            wrapMode: Text.WordWrap
            text: "Nhịp đang bị giãn để ngân sách đủ tới lúc reset. Muốn quét nhanh hơn: thêm project, hoặc đặt chính sách \"n video/ngày\" cho các kênh ít đăng."
            color: "#FFD93D"
            font.pixelSize: 11
        }

        // Project hỏng cấu hình phải nổi lên: chúng bị loại khỏi vòng xoay nên
        // ngân sách thật thấp hơn con số khách tưởng, và chỉ người dùng mới
        // sửa được (vào Cloud Console).
        Rectangle {
            Layout.fillWidth: true
            visible: root.deadCount > 0
            implicitHeight: deadRow.implicitHeight + 16
            color: Theme.error + "12"
            border.color: Theme.error + "60"
            border.width: 1
            radius: Theme.radiusMd
            RowLayout {
                id: deadRow
                anchors.fill: parent
                anchors.margins: 8
                spacing: 8
                Icon { name: "warning"; size: 13; color: Theme.error; Layout.alignment: Qt.AlignTop }
                Label {
                    Layout.fillWidth: true
                    wrapMode: Text.WordWrap
                    text: root.deadCount + " project đang không dùng được — lý do ghi ngay dưới từng dòng. "
                          + "Sửa xong trong Console thì bấm ↻ của dòng đó để đưa project quay lại ngay, không phải đợi reset."
                    color: Theme.error
                    font.pixelSize: 11
                }
            }
        }

        // ─── Danh sách project ─────────────────────────────────────
        ListView {
            id: projList
            Layout.fillWidth: true
            // Trang Lõi quét cho card fillHeight → danh sách ăn hết phần còn
            // lại; nơi khác (Onboarding) rơi về implicitHeight của từng hàng.
            Layout.fillHeight: true
            Layout.preferredHeight: contentHeight
            Layout.minimumHeight: visible ? 60 : 0
            visible: count > 0
            model: quota ? quota.projects : null
            clip: true
            spacing: 2
            boundsBehavior: Flickable.StopAtBounds

            delegate: Rectangle {
                id: projRow
                width: projList.width
                height: rowCol.implicitHeight + 10
                radius: 3
                color: index % 2 === 0 ? Theme.rowEven : "transparent"

                // Sao chép roles lên delegate: trong callback/closure `model`
                // có thể đã chết theo delegate (cùng lớp bẫy ComboBox của
                // ChannelPolicyTable).
                readonly property string pId: model.projectId
                readonly property string pName: model.name || model.projectId
                readonly property string pError: model.errorText || ""
                readonly property bool pBlocked: model.blocked

                ColumnLayout {
                    id: rowCol
                    anchors.left: parent.left
                    anchors.right: parent.right
                    anchors.verticalCenter: parent.verticalCenter
                    anchors.leftMargin: 8
                    anchors.rightMargin: 6
                    spacing: 3

                    RowLayout {
                        Layout.fillWidth: true
                        spacing: 8

                        StatusDot {
                            state: projRow.pBlocked ? "error" : (model.available > 0 ? "running" : "idle")
                            size: 7
                            showRing: !projRow.pBlocked && model.available > 0
                        }
                        Label {
                            text: projRow.pName
                            color: Theme.text
                            font.pixelSize: 11
                            Layout.preferredWidth: 120
                            elide: Text.ElideRight
                        }
                        // Thanh mức tiêu của riêng project này
                        Rectangle {
                            Layout.fillWidth: true
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
                            font.pixelSize: 10
                            font.family: "monospace"
                            Layout.preferredWidth: 84
                            horizontalAlignment: Text.AlignRight
                        }
                        Label {
                            visible: !model.hasKey
                            text: "OAuth"
                            color: Theme.textMuted
                            font.pixelSize: 9
                        }

                        IconButton {
                            iconName: "retry"
                            iconSize: 11
                            Layout.preferredWidth: 24
                            Layout.preferredHeight: 20
                            enabled: root.testingId === ""
                            // Đang test hàng này thì icon quay chậm bằng opacity
                            opacity: root.testingId === projRow.pId ? 0.4 : 1.0
                            ToolTip.text: "Kiểm tra lại bằng lời gọi thật — key dùng được thì project quay lại vòng xoay ngay"
                            ToolTip.visible: hovered
                            ToolTip.delay: 400
                            onClicked: root.testProject(projRow.pId)
                        }
                        IconButton {
                            iconName: "trash"
                            iconSize: 11
                            Layout.preferredWidth: 24
                            Layout.preferredHeight: 20
                            iconColorHover: Theme.error
                            ToolTip.text: "Xoá project khỏi pool quét"
                            ToolTip.visible: hovered
                            ToolTip.delay: 400
                            onClicked: root.removeProject(projRow.pId, projRow.pName)
                        }
                    }

                    // Lý do hỏng — TRỌN câu, kèm nút mở đúng trang Console.
                    // CHỈ hiện khi project bị CHẶN: lỗi vặt không chặn (resolve
                    // handle 404…) mà phơi đỏ thì khách tưởng cả pool chết.
                    RowLayout {
                        visible: projRow.pBlocked && projRow.pError !== ""
                        Layout.fillWidth: true
                        Layout.leftMargin: 15
                        spacing: 8
                        Label {
                            text: projRow.pError
                            color: Theme.error
                            font.pixelSize: 10
                            wrapMode: Text.WordWrap
                            Layout.fillWidth: true
                            // preferredWidth 0: label wrap lấy bề rộng theo phần
                            // được chia, không theo implicit của cả câu (implicit
                            // dài từng đẩy nút Console/xóa tràn khỏi card).
                            Layout.preferredWidth: 0
                            Layout.minimumWidth: 0
                        }
                        IconButton {
                            iconName: "forward"
                            label: "Mở Console"
                            iconSize: 10
                            Layout.preferredHeight: 20
                            Layout.alignment: Qt.AlignTop
                            onClicked: backend.send_command_async("system:openUrl",
                                {"url": root.consoleUrlFor(projRow.pId, projRow.pError)})
                        }
                    }
                }
            }
        }
    }
}
