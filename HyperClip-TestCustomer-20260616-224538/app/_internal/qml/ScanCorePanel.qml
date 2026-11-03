// src/ui/qml/ScanCorePanel.qml
// Trang "Lõi quét" — quản trị units (redesign v2, 2026-08-11).
//
// v1 xếp pool project vào cột 480px cạnh bảng kênh: pool chật tới mức cắt cả
// nút, bảng kênh thì thừa chỗ. v2 xếp theo tầng đúng thứ tự câu hỏi của khách:
//   1. Dải trạng thái (luôn thấy): còn bao nhiêu units, nhịp thật, đủ tới
//      reset không, mấy project hỏng.
//   2. Hai tab full chiều ngang: "Project GCP" (CRUD pool) và "Chính sách kênh"
//      — mỗi bảng đủ rộng để mọi cột thẳng hàng và không bị cắt chữ.
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Rectangle {
    id: root
    color: Theme.bg

    // "pool" | "channels"
    property string zone: "pool"

    readonly property color budgetColor: {
        if (!quota) return Theme.textMuted
        if (quota.exhausted) return Theme.error
        if (!quota.coversReset) return "#FFD93D"
        return Theme.success
    }

    Component.onCompleted: {
        // Số liệu chỉ kéo về khi mở trang; sau đó event `quota:scan` mỗi nhịp
        // tự cập nhật, không tốn thêm lệnh JSON-RPC nào (nguyên tắc Pass 56).
        if (quota) quota.refresh_from_backend(backend)
        if (typeof policyChannelModel !== "undefined" && policyChannelModel) {
            policyChannelModel.pageSize = 15
            policyChannelModel.load_from_backend(backend)
        }
    }

    // Wizard ở gốc trang (không lồng trong ListView/ScrollView) để Popup không
    // bị hủy theo delegate.
    GcpWizard {
        id: gcpWizard
        onProjectAdded: {
            if (quota) quota.refresh_from_backend(backend)
            if (toastService) toastService.show("Đã thêm project",
                "Project đã kiểm chứng và vào pool quét", "success")
        }
    }

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: Theme.spacingLg
        spacing: Theme.spacingMd

        // ─── Header ────────────────────────────────────────────────
        RowLayout {
            Layout.fillWidth: true
            spacing: 8
            Label {
                text: "Lõi quét"
                color: Theme.text
                font.pixelSize: 22
                font.bold: true
            }
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
            Item { Layout.fillWidth: true }
            Label {
                text: quota && quota.projectCount > 0
                    ? ("reset quota sau " + quota.resetCountdownStr)
                    : ""
                color: Theme.textMuted
                font.pixelSize: 12
                Layout.alignment: Qt.AlignVCenter
            }
        }

        // ─── Dải trạng thái ────────────────────────────────────────
        Rectangle {
            Layout.fillWidth: true
            visible: quota && quota.projectCount > 0
            implicitHeight: stripCol.implicitHeight + 20
            color: Theme.cardBg
            border.color: Theme.border
            border.width: 1
            radius: Theme.radiusLg

            ColumnLayout {
                id: stripCol
                anchors.fill: parent
                anchors.margins: 10
                spacing: 6

                RowLayout {
                    Layout.fillWidth: true
                    spacing: 12

                    // Ngân sách + thanh tiêu
                    ColumnLayout {
                        Layout.fillWidth: true
                        Layout.preferredWidth: 0
                        Layout.minimumWidth: 260
                        spacing: 4
                        RowLayout {
                            Layout.fillWidth: true
                            Label {
                                text: quota ? (quota.unitsSpent.toLocaleString(Qt.locale(), "f", 0)
                                              + " / " + quota.unitsTotal.toLocaleString(Qt.locale(), "f", 0)
                                              + " units hôm nay") : "—"
                                color: Theme.text
                                font.pixelSize: 13
                                font.bold: true
                                elide: Text.ElideRight
                                Layout.fillWidth: true
                                Layout.minimumWidth: 0
                            }
                            Label {
                                text: quota ? quota.runwayStr : ""
                                color: quota && !quota.coversReset ? "#FFD93D" : Theme.textMuted
                                font.pixelSize: 11
                                font.bold: quota && !quota.coversReset
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
                                width: {
                                    if (!quota || quota.unitsTotal <= 0) return 0
                                    return Math.max(0, (parent.width - 2)
                                        * Math.min(1, quota.unitsSpent / quota.unitsTotal))
                                }
                                radius: 3
                                color: root.budgetColor
                                Behavior on width { NumberAnimation { duration: 300 } }
                            }
                        }
                    }

                    component Metric: Rectangle {
                        id: metricRoot
                        property string metricLabel: ""
                        property string metricValue: ""
                        property color metricColor: Theme.text
                        property string tipText: ""
                        Layout.preferredWidth: 124
                        Layout.preferredHeight: 52
                        radius: Theme.radiusMd
                        color: metricMa.containsMouse ? (Theme.cardBg) : Theme.bg
                        border.color: metricMa.containsMouse ? metricColor : Theme.border
                        border.width: 1

                        Behavior on border.color { ColorAnimation { duration: 150 } }
                        Behavior on color { ColorAnimation { duration: 150 } }

                        ColumnLayout {
                            anchors.centerIn: parent
                            spacing: 2
                            Label {
                                text: metricRoot.metricValue
                                color: metricRoot.metricColor
                                font.pixelSize: 15
                                font.bold: true
                                Layout.alignment: Qt.AlignHCenter
                            }
                            Label {
                                text: metricRoot.metricLabel
                                color: Theme.textMuted
                                font.pixelSize: 9
                                font.bold: true
                                font.letterSpacing: 0.5
                                Layout.alignment: Qt.AlignHCenter
                            }
                        }

                        MouseArea {
                            id: metricMa
                            anchors.fill: parent
                            hoverEnabled: true
                        }

                        ToolTip.visible: metricMa.containsMouse && tipText !== ""
                        ToolTip.text: tipText
                        ToolTip.delay: 300
                    }

                    Metric {
                        metricLabel: quota && quota.throttled
                            ? ("NHỊP (ĐẶT " + quota.desiredIntervalStr + ")")
                            : "NHỊP QUÉT"
                        metricValue: quota ? quota.intervalStr : "—"
                        metricColor: quota && quota.throttled ? "#FFD93D" : Theme.success
                        tipText: "Chu kỳ gửi request hỏi YouTube Data API v3 theo nhịp điều phối toàn máy."
                    }
                    Metric {
                        metricLabel: "UNITS / NHỊP"
                        metricValue: quota ? String(quota.unitsPerTick) : "—"
                        metricColor: Theme.accent
                        tipText: "Số đơn vị hạn mức YouTube tiêu hao trong mỗi vòng quét kênh."
                    }
                    Metric {
                        metricLabel: "ĐANG SOI"
                        metricValue: quota ? String(quota.sentinelChannels + quota.hotChannels) : "—"
                        metricColor: Theme.text
                        tipText: "Tổng số kênh ưu tiên (Hot) và kênh thường (Sentinel) đang quét."
                    }
                    Metric {
                        metricLabel: "ĐÃ ĐỦ HÔM NAY"
                        metricValue: quota ? String(quota.satisfiedChannels) : "—"
                        metricColor: quota && quota.satisfiedChannels > 0 ? Theme.success : Theme.textMuted
                        tipText: "Số kênh đã bắt đủ video hôm nay và được cho nghỉ để tiết kiệm quota."
                    }

                    // Project hỏng phải nổi lên ngay tầng trạng thái — bấm là
                    // nhảy về tab pool để sửa.
                    Rectangle {
                        visible: quota && quota.brokenProjects > 0
                        Layout.preferredWidth: brokenCol.implicitWidth + 20
                        Layout.preferredHeight: 46
                        radius: Theme.radiusMd
                        color: Theme.error + (brokenMa.containsMouse ? "28" : "15")
                        border.color: Theme.error
                        border.width: 1
                        ColumnLayout {
                            id: brokenCol
                            anchors.centerIn: parent
                            spacing: 1
                            Label {
                                text: quota ? (quota.brokenProjects + " project hỏng") : ""
                                color: Theme.error
                                font.pixelSize: 13
                                font.bold: true
                                Layout.alignment: Qt.AlignHCenter
                            }
                            Label {
                                text: "bấm để xem & sửa"
                                color: Theme.error
                                font.pixelSize: 9
                                Layout.alignment: Qt.AlignHCenter
                            }
                        }
                        MouseArea {
                            id: brokenMa
                            anchors.fill: parent
                            hoverEnabled: true
                            cursorShape: Qt.PointingHandCursor
                            onClicked: root.zone = "pool"
                        }
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
            }
        }

        // ─── Hai tab ───────────────────────────────────────────────
        RowLayout {
            Layout.fillWidth: true
            spacing: 6

            Repeater {
                model: [
                    {key: "pool", label: "Project GCP"},
                    {key: "channels", label: "Chính sách kênh"}
                ]
                delegate: Rectangle {
                    readonly property bool active: root.zone === modelData.key
                    readonly property string countStr: {
                        if (modelData.key === "pool")
                            return quota ? String(quota.projectCount) : "0"
                        return (typeof policyChannelModel !== "undefined" && policyChannelModel)
                            ? String(policyChannelModel.countAll) : "0"
                    }
                    Layout.preferredHeight: 28
                    Layout.preferredWidth: tabLbl.implicitWidth + 26
                    radius: 14
                    color: active ? Theme.accent + "25" : "transparent"
                    border.color: active ? Theme.accent : Theme.border
                    border.width: 1
                    Label {
                        id: tabLbl
                        anchors.centerIn: parent
                        text: modelData.label + "  " + parent.countStr
                        color: active ? Theme.accent : Theme.textMuted
                        font.pixelSize: 12
                        font.bold: active
                    }
                    MouseArea {
                        anchors.fill: parent
                        cursorShape: Qt.PointingHandCursor
                        onClicked: root.zone = modelData.key
                    }
                }
            }
            Item { Layout.fillWidth: true }
        }

        ProjectPoolTable {
            visible: root.zone === "pool"
            Layout.fillWidth: true
            Layout.fillHeight: true
            onAddProjectRequested: gcpWizard.open()
        }
        ChannelPolicyTable {
            visible: root.zone === "channels"
            Layout.fillWidth: true
            Layout.fillHeight: true
        }

        // Hai đồng hồ khác nhau trên cùng một trang — nói thẳng ra một lần ở
        // đây, đỡ mỗi lần khách lại hỏi vì sao "reset" và "chỉ tiêu ngày" lệch.
        Label {
            Layout.fillWidth: true
            text: "Quota Google reset theo ngày Pacific (0h Pacific ≈ 14–15h giờ VN). Chỉ tiêu \"n video/ngày\" của kênh tính theo ngày Việt Nam (UTC+7). Cả hai tính từ mốc UTC, không phụ thuộc đồng hồ máy."
            color: Theme.textMuted
            font.pixelSize: 10
            wrapMode: Text.WordWrap
            opacity: 0.8
        }
    }
}
