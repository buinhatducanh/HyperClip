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

    // Ba hành động pool project dùng chung với QuotaPoolCard — logic ở
    // ProjectActions.js (trước đây copy nguyên văn ở cả hai file).
    readonly property var paDeps: ({ backend: backend, toast: (typeof toastService !== "undefined" ? toastService : null), quota: quota })
    function consoleUrlFor(projectId, errText) { return PA.consoleUrlFor(projectId, errText) }
    function testProject(projectId) { PA.testProject(root, root.paDeps, projectId) }
    function removeProject(projectId, name) { PA.removeProject(confirmRemove, root.paDeps, projectId, name) }

    ConfirmationDialog {
        id: confirmRemove
        anchors.centerIn: Overlay.overlay
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
