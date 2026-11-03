// src/ui/qml/WorkspaceQueue.qml
// Queue: status filter + workspace list
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Rectangle {
    id: root
    color: Theme.bg
    border.color: Theme.border
    border.width: 1

    property string channelFilter: ""
    property string statusFilter: "all"
    property var selectedIds: []
    property bool isDeleteSelectMode: false
    property var channelOptions: []

    signal openWorkspace(string ws_id)
    signal selectChannelFilter(string channelId)

    function passFilter(itemStatus, itemTitle, itemChannel) {
        if (statusFilter !== "all" && statusFilter !== itemStatus)
            return false
        if (channelFilter && channelFilter !== itemChannel)
            return false
        return true
    }

    function toggleSelect(wsId) {
        var temp = selectedIds.slice()
        var idx = temp.indexOf(wsId)
        if (idx >= 0) {
            temp.splice(idx, 1)
        } else {
            temp.push(wsId)
        }
        selectedIds = temp
    }

    function clearSelection() {
        selectedIds = []
    }

    function selectAllVisible() {
        if (workspaceModel) {
            root.isDeleteSelectMode = true
            selectedIds = workspaceModel.get_filtered_ids(root.statusFilter, root.channelFilter)
        }
    }

    function refreshChannelOptions() {
        var opts = [{"name": "Tất cả kênh", "channelId": ""}]
        if (channelListModel) {
            var raw = channelListModel.get_all_channels()
            for (var i = 0; i < raw.length; i++) {
                opts.push(raw[i])
            }
        }
        channelOptions = opts
    }

    Component.onCompleted: refreshChannelOptions()

    Connections {
        target: channelListModel
        function onRowsInserted() { root.refreshChannelOptions() }
        function onRowsRemoved() { root.refreshChannelOptions() }
        function onModelReset() { root.refreshChannelOptions() }
    }

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 6
        spacing: 6

        // ─── Status filter pills ────────────────────────────────
        RowLayout {
            Layout.fillWidth: true
            spacing: 6
            FilterPills {
                Layout.fillWidth: true
                current: root.statusFilter
                onFilterChanged: function(v) { 
                    root.statusFilter = v 
                    root.clearSelection()
                }
            }
        }

        // ─── Channel Filter ComboBox ──────────────────────────────
        RowLayout {
            Layout.fillWidth: true
            spacing: 6

            Label {
                text: "Kênh:"
                color: Theme.textMuted
                font.pixelSize: 12
                Layout.alignment: Qt.AlignVCenter
            }

            ComboBox {
                id: channelCombo
                Layout.fillWidth: true
                Layout.preferredHeight: 24
                model: root.channelOptions
                textRole: "name"
                currentIndex: {
                    for (var i = 0; i < root.channelOptions.length; i++) {
                        if (root.channelOptions[i].channelId === root.channelFilter) {
                            return i
                        }
                    }
                    return 0
                }
                onActivated: function(index) {
                    var opt = root.channelOptions[index]
                    root.selectChannelFilter(opt.channelId)
                    root.clearSelection()
                }

                background: Rectangle {
                    color: Theme.cardBg
                    border.color: Theme.border
                    border.width: 1
                    radius: 4
                }
                contentItem: Label {
                    text: channelCombo.displayText
                    color: Theme.text
                    font.pixelSize: 12
                    verticalAlignment: Text.AlignVCenter
                    leftPadding: 6
                }
            }
        }

        // ─── General Actions Row ──────────────────────────────────
        RowLayout {
            Layout.fillWidth: true
            spacing: 6

            IconButton {
                iconName: "check"
                label: "Chọn tất cả"
                iconSize: 10
                Layout.fillWidth: true
                Layout.preferredHeight: 24
                onClicked: root.selectAllVisible()
            }

            IconButton {
                id: selectModeBtn
                iconName: root.isDeleteSelectMode ? "close" : "list"
                label: root.isDeleteSelectMode ? "Hủy chọn" : "Chọn xóa"
                iconSize: 10
                Layout.fillWidth: true
                Layout.preferredHeight: 24
                colorIdle: root.isDeleteSelectMode ? Theme.accent + "30" : "transparent"
                colorHover: root.isDeleteSelectMode ? Theme.accent + "50" : Theme.hoverBg
                iconColorIdle: root.isDeleteSelectMode ? Theme.accent : Theme.text
                iconColorHover: root.isDeleteSelectMode ? Theme.accent : Theme.text
                border.color: root.isDeleteSelectMode ? Theme.accent : Theme.border
                onClicked: {
                    root.isDeleteSelectMode = !root.isDeleteSelectMode
                    if (!root.isDeleteSelectMode) {
                        root.clearSelection()
                    }
                }
            }

            IconButton {
                iconName: "trash"
                label: "Xóa toàn bộ"
                iconSize: 10
                Layout.fillWidth: true
                Layout.preferredHeight: 24
                onClicked: {
                    // Vá 18/08 (giữ khi trả UI cũ): đụng model SAU CÙNG và hoãn
                    // ra khỏi stack sự kiện — clear_all → load_from_backend →
                    // beginResetModel huỷ delegate đang chạy dở handler.
                    if (!workspaceModel) return
                    root.clearSelection()
                    Qt.callLater(function() { workspaceModel.clear_all(backend) })
                }
            }
        }

        // ─── Bulk Deletion Bar (visible only when selectedIds.length > 0) ──
        RowLayout {
            Layout.fillWidth: true
            spacing: 6
            visible: root.selectedIds.length > 0

            Rectangle {
                Layout.fillWidth: true
                Layout.preferredHeight: 26
                color: Theme.accent + "20"
                border.color: Theme.accent
                border.width: 1
                radius: 4

                RowLayout {
                    anchors.fill: parent
                    anchors.leftMargin: 8
                    anchors.rightMargin: 8
                    spacing: 6

                    Label {
                        text: "Đã chọn: " + root.selectedIds.length
                        color: Theme.accent
                        font.bold: true
                        font.pixelSize: 12
                        Layout.alignment: Qt.AlignVCenter
                    }

                    Item { Layout.fillWidth: true }

                    IconButton {
                        iconName: "trash"
                        label: "Xóa đã chọn"
                        iconSize: 10
                        Layout.preferredHeight: 20
                        Layout.preferredWidth: 95
                        onClicked: {
                            // Vá 18/08: chụp danh sách trước, đụng model sau.
                            if (!workspaceModel) return
                            const ids = root.selectedIds.slice()
                            root.clearSelection()
                            Qt.callLater(function() { workspaceModel.delete_workspaces(backend, ids) })
                        }
                    }

                    IconButton {
                        iconName: "close"
                        label: "Hủy"
                        iconSize: 10
                        Layout.preferredHeight: 20
                        Layout.preferredWidth: 45
                        onClicked: {
                            root.clearSelection()
                            root.isDeleteSelectMode = false
                        }
                    }
                }
            }
        }

        Rectangle {
            Layout.fillWidth: true; Layout.preferredHeight: 1
            color: Theme.border
            Layout.topMargin: 2; Layout.bottomMargin: 2
        }

        // ─── Workspace list ─────────────────────────────────────
        ListView {
            id: queueList
            Layout.fillWidth: true
            Layout.fillHeight: true
            model: workspaceModel
            clip: true
            spacing: 2
            delegate: WorkspaceCard {
                width: queueList.width
                ws_id: model.id
                status: root.passFilter(model.status || "pending", model.title, model.channelId) ? model.status || "pending" : "hidden"
                visible: status !== "hidden"
                height: status === "hidden" ? 0 : 82
                title: model.title
                progress: model.progress || 0
                channel_name: model.channel_name
                channelId: model.channelId || ""
                thumbnail: model.thumbnail
                isShort: model.isShort
                durationSec: model.durationSec || 0
                quality: model.quality || 1080
                speed: model.speed || 1.0
                fileSize: model.fileSize || ""
                ageLabel: model.ageLabel || ""
                publishedTimeStr: model.publishedTimeStr || ""
                totalDurationSec: model.totalDurationSec || 0
                isStartupCatchup: model.isStartupCatchup || false
                partIndex: model.partIndex || 0
                partTotal: model.partTotal || 0
                sourceDupRatio: model.sourceDupRatio || 0

                isSelected: root.isDeleteSelectMode && root.selectedIds.indexOf(model.id) >= 0
                selectionActive: root.isDeleteSelectMode && root.selectedIds.length > 0
                onSelectToggled: {
                    root.toggleSelect(model.id)
                }
                // Vá 18/08 (LỖI THẬT trong ui-qt.log khách 14:19:52 —
                // "WorkspaceQueue.qml:307 ReferenceError: root is not defined"):
                // delete_workspace → load_from_backend → beginResetModel huỷ
                // SẠCH delegate, kể cả delegate đang chạy dở chính handler này;
                // dòng sau đó đọc `root`/`model` là đọc object đã chết. Luật:
                // CHỤP giá trị trước, đụng model SAU CÙNG qua Qt.callLater.
                onDeleteClicked: {
                    if (!workspaceModel) return
                    const wsId = model.id
                    const idx = root.selectedIds.indexOf(wsId)
                    if (idx >= 0) {
                        var temp = root.selectedIds.slice()
                        temp.splice(idx, 1)
                        root.selectedIds = temp
                    }
                    Qt.callLater(function() { workspaceModel.delete_workspace(backend, wsId) })
                }
                onWorkspaceClicked: function(id) {
                    if (root.isDeleteSelectMode) {
                        root.toggleSelect(id)
                    } else {
                        root.openWorkspace(id)
                    }
                }
            }

            Label {
                anchors.centerIn: parent
                visible: queueList.count === 0
                text: "Chưa có video nào"
                color: Theme.textMuted
                font.pixelSize: 16
            }
        }
    }
}

