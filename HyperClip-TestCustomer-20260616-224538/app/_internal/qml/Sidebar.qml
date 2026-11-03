// src/ui/qml/Sidebar.qml
// Fixed-width left sidebar (220px) — shows channel list, detection status, add channel.
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls
import QtQuick.Shapes
import Qt5Compat.GraphicalEffects

Rectangle {
    id: sideRoot

    // ─── State ───────────────────────────────────────────────────────
    property string activeChannelId: ""
    property bool expanded: true
    property bool showAddForm: false
    signal channelSelected(string id)
    signal addChannel(string url)

    width: 220
    color: Theme.cardBg
    border.color: Theme.border
    border.width: 0

    // ─── Section Header: Kênh theo dõi ─────────────────────────────
    Rectangle {
        id: logoBlock
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        height: 38
        color: "transparent"

        RowLayout {
            anchors.fill: parent
            anchors.leftMargin: 12
            anchors.rightMargin: 12
            spacing: 8

            Rectangle {
                Layout.preferredWidth: 20
                Layout.preferredHeight: 20
                radius: 4
                color: Theme.accent + "20"
                border.color: Theme.accent + "50"
                border.width: 1
                Icon {
                    anchors.centerIn: parent
                    name: "folder"
                    size: 10
                    color: Theme.accent
                }
            }
            Label {
                text: "KÊNH THEO DÕI"
                color: Theme.text
                font.pixelSize: 11
                font.bold: true
                font.letterSpacing: 0.5
                Layout.fillWidth: true
            }
            Rectangle {
                Layout.preferredHeight: 18
                Layout.preferredWidth: chCountBadge.implicitWidth + 10
                radius: 9
                color: Theme.surfaceHover
                border.color: Theme.cardBorder
                border.width: 1
                Label {
                    id: chCountBadge
                    anchors.centerIn: parent
                    text: channelListModel ? (channelListModel.rowCount ? channelListModel.rowCount() : 0) : 0
                    color: Theme.accent
                    font.pixelSize: 10
                    font.bold: true
                }
            }
        }
    }

    // ─── Detection status bar ──────────────────────────────────────
    Rectangle {
        id: detBar
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: logoBlock.bottom
        height: 28
        color: Theme.bg
        border.color: Theme.border
        border.width: 0

        RowLayout {
            anchors.fill: parent
            anchors.leftMargin: 8
            anchors.rightMargin: 6
            spacing: 4

            StatusDot {
                state: (poller && poller.active) ? "running" : "paused"
                size: 8
                showRing: poller && poller.active
                Layout.alignment: Qt.AlignVCenter
            }
            Label {
                text: (poller && poller.active) ? "ĐANG CHẠY" : "TẠM DỪNG"
                color: (poller && poller.active) ? Theme.success : Theme.textMuted
                font.pixelSize: 10
                font.bold: true
            }
            Item { Layout.fillWidth: true }
            RowLayout {
                spacing: 2
                Icon {
                    name: "settings"
                    size: 10
                    color: Theme.textMuted
                }
                Label {
                    text: (typeof sessionModel !== 'undefined' && sessionModel ? sessionModel.rowCount() : 0) + " ses"
                    color: Theme.textMuted
                    font.pixelSize: 9
                    font.family: "monospace"
                }
            }
        }

        Rectangle {
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.bottom: parent.bottom
            height: 1
            color: Theme.border
            opacity: 0.5
        }
    }

    // ─── Search & Add Row ──────────────────────────────────────────
    Rectangle {
        id: searchAddRow
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: detBar.bottom
        height: 36
        color: "transparent"

        RowLayout {
            anchors.fill: parent
            anchors.leftMargin: 8
            anchors.rightMargin: 8
            anchors.topMargin: 4
            anchors.bottomMargin: 4
            spacing: 6

            // Search bar
            Rectangle {
                Layout.fillWidth: true
                Layout.preferredHeight: 28
                color: Theme.bg
                border.color: searchInput.activeFocus ? Theme.accent : Theme.border
                border.width: 1
                radius: Theme.radiusMd

                RowLayout {
                    anchors.fill: parent
                    anchors.leftMargin: 6
                    anchors.rightMargin: 6
                    spacing: 4

                    Icon {
                        name: "search"
                        size: 11
                        color: Theme.textMuted
                    }

                    TextField {
                        id: searchInput
                        Layout.fillWidth: true
                        placeholderText: "Tìm kiếm..."
                        color: Theme.text
                        font.pixelSize: 11
                        background: Rectangle { color: "transparent"; border.width: 0 }
                        onTextChanged: {
                            channelListModel.filterText = text.trim()
                        }
                    }
                }
            }

            // Toggle Add Form Button
            Rectangle {
                Layout.preferredWidth: 28
                Layout.preferredHeight: 28
                radius: Theme.radiusMd
                color: showAddForm ? Theme.accent : Theme.bg
                border.color: Theme.border
                border.width: 1

                Icon {
                    anchors.centerIn: parent
                    name: "add"
                    size: 14
                    color: showAddForm ? "white" : Theme.text
                }

                MouseArea {
                    anchors.fill: parent
                    cursorShape: Qt.PointingHandCursor
                    onClicked: {
                        showAddForm = !showAddForm
                        if (showAddForm) {
                            addInput.forceActiveFocus()
                        }
                    }
                }
            }
        }
    }

    // ─── Add channel input slide-out ────────────────────────────────
    Rectangle {
        id: addBox
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: searchAddRow.bottom
        height: showAddForm ? 70 : 0
        visible: height > 0
        clip: true
        color: "transparent"

        Behavior on height {
            NumberAnimation { duration: 180; easing.type: Easing.InOutQuad }
        }

        ColumnLayout {
            anchors.fill: parent
            anchors.leftMargin: 8
            anchors.rightMargin: 8
            anchors.topMargin: 2
            anchors.bottomMargin: 2
            spacing: 6

            // Row 1: Nhập link/handle + nút thêm
            RowLayout {
                Layout.fillWidth: true
                Layout.preferredHeight: 28
                spacing: 4

                Rectangle {
                    Layout.fillWidth: true
                    Layout.preferredHeight: 28
                    color: Theme.bg
                    border.color: addInput.activeFocus ? Theme.accent : Theme.border
                    border.width: 1
                    radius: Theme.radiusMd
                    clip: true

                    TextField {
                        id: addInput
                        anchors.fill: parent
                        anchors.leftMargin: 6
                        anchors.rightMargin: 6
                        placeholderText: "Nhập URL hoặc @handle..."
                        color: Theme.text
                        font.pixelSize: 11
                        selectByMouse: true
                        background: Rectangle { color: "transparent"; border.width: 0 }
                        onAccepted: {
                            if (text.length > 0) {
                                sideRoot.addChannel(text.trim())
                                text = ""
                                showAddForm = false
                            }
                        }
                    }
                }

                Rectangle {
                    Layout.preferredWidth: 28
                    Layout.preferredHeight: 28
                    radius: Theme.radiusMd
                    color: addInput.text.length > 0 ? Theme.accent : Theme.bg
                    border.color: Theme.border
                    border.width: 1
                    Icon {
                        anchors.centerIn: parent
                        name: "upload"
                        size: 13
                        color: addInput.text.length > 0 ? "white" : Theme.text
                    }
                    MouseArea {
                        anchors.fill: parent
                        cursorShape: Qt.PointingHandCursor
                        onClicked: {
                            if (addInput.text.length > 0) {
                                sideRoot.addChannel(addInput.text.trim())
                                addInput.text = ""
                                showAddForm = false
                            }
                        }
                    }
                }
            }

            // Row 2: Pass 54 — dọn kênh trùng
            Rectangle {
                id: dedupeBtn
                Layout.fillWidth: true
                Layout.preferredHeight: 24
                radius: Theme.radiusMd
                color: dedupeMa.containsMouse ? Theme.hoverBg : Theme.bg
                border.color: dedupeFound > 0 ? Theme.warning : Theme.border
                border.width: 1
                property int dedupeFound: -1   // -1 = chưa quét
                Label {
                    anchors.centerIn: parent
                    text: dedupeBtn.dedupeFound < 0
                        ? "Kiểm tra kênh trùng"
                        : (dedupeBtn.dedupeFound === 0
                            ? "Không có kênh trùng ✓"
                            : "Gộp " + dedupeBtn.dedupeFound + " kênh trùng →")
                    color: dedupeBtn.dedupeFound > 0 ? Theme.warning : Theme.textMuted
                    font.pixelSize: 10
                    font.bold: true
                }
                MouseArea {
                    id: dedupeMa
                    anchors.fill: parent
                    hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onClicked: {
                        if (dedupeBtn.dedupeFound > 0) {
                            var applied = channelListModel.find_duplicates(true)
                            if (toastService)
                                toastService.show("Đã gộp kênh trùng",
                                    "Xoá " + (applied.duplicateCount || 0) + " kênh trùng", "success")
                            dedupeBtn.dedupeFound = 0
                            return
                        }
                        var r = channelListModel.find_duplicates(false)
                        dedupeBtn.dedupeFound = r.duplicateCount || 0
                        if (toastService) {
                            if (dedupeBtn.dedupeFound === 0)
                                toastService.show("Kênh trùng", "Không tìm thấy kênh trùng", "success")
                            else
                                toastService.show("Tìm thấy kênh trùng",
                                    dedupeBtn.dedupeFound + " kênh trùng — bấm lần nữa để gộp", "warning")
                        }
                    }
                }
            }
        }
    }

    // ─── Channel list ──────────────────────────────────────────────
    ListView {
        id: chList
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: addBox.bottom
        anchors.bottom: paginator.top
        model: channelListModel
        clip: true
        spacing: 0
        boundsBehavior: Flickable.StopAtBounds

        delegate: Rectangle {
            width: chList.width
            height: 42
            color: sideRoot.activeChannelId === model.id ? Qt.rgba(0, 180, 255, 0.08) : "transparent"

            property bool rowHover: rowMa.containsMouse
            Rectangle {
                anchors.fill: parent
                color: Theme.hoverBg
                opacity: (parent.rowHover && sideRoot.activeChannelId !== model.id) ? 0.35 : 0.0
                Behavior on opacity { NumberAnimation { duration: 120 } }
            }

            // Pill-style left active indicator
            Rectangle {
                anchors.left: parent.left
                anchors.verticalCenter: parent.verticalCenter
                width: 3
                height: 24
                radius: 1.5
                color: sideRoot.activeChannelId === model.id ? Theme.accent : "transparent"
            }

            MouseArea {
                id: rowMa
                anchors.fill: parent
                hoverEnabled: true
                cursorShape: Qt.PointingHandCursor
                onClicked: {
                    if (sideRoot.activeChannelId === model.id) {
                        sideRoot.channelSelected("")
                    } else {
                        sideRoot.channelSelected(model.id)
                    }
                }
            }

            RowLayout {
                anchors.fill: parent
                anchors.leftMargin: 12
                anchors.rightMargin: 8
                spacing: 8

                // --- ROUND CHANNEL AVATAR / FALLBACK PLACEHOLDER ---
                Rectangle {
                    id: avatarWrapper
                    width: 28
                    height: 28
                    Layout.preferredWidth: 28
                    Layout.preferredHeight: 28
                    radius: 14
                    color: (model.avatarColor || Theme.accent) + "22"
                    border.color: sideRoot.activeChannelId === model.id 
                        ? Theme.accent 
                        : ((model.avatarColor || Theme.accent) + "44")
                    border.width: 1

                    scale: rowHover ? 1.05 : 1.0
                    Behavior on scale {
                        NumberAnimation { duration: 120; easing.type: Easing.OutQuad }
                    }

                    Image {
                        id: avatarImg
                        anchors.fill: parent
                        source: model.avatarUrl || ""
                        fillMode: Image.PreserveAspectCrop
                        visible: false
                        asynchronous: true
                    }

                    Rectangle {
                        id: roundMask
                        anchors.fill: parent
                        radius: 14
                        visible: false
                    }

                    OpacityMask {
                        anchors.fill: parent
                        source: avatarImg
                        maskSource: roundMask
                        visible: !!model.avatarUrl && avatarImg.status === Image.Ready
                    }

                    Label {
                        anchors.centerIn: parent
                        visible: !model.avatarUrl || avatarImg.status !== Image.Ready
                        text: model.name ? model.name[0].toUpperCase() : "?"
                        color: model.avatarColor || Theme.accent
                        font.pixelSize: 11
                        font.bold: true
                    }
                }

                Label {
                    text: model.name
                    color: model.paused ? Theme.textMuted : (sideRoot.activeChannelId === model.id ? Theme.accent : Theme.text)
                    font.pixelSize: 12
                    font.bold: sideRoot.activeChannelId === model.id
                    elide: Text.ElideRight
                    Layout.fillWidth: true
                    opacity: model.paused ? 0.6 : 1.0
                }

                // Fast-probe (priority detection) indicator — always visible
                // so the operator can see which channels are being HTML-probed
                Label {
                    visible: model.fastProbe === true
                    text: "⚡"
                    font.pixelSize: 10
                    color: "#FFD93D"
                }

                // Standard focus channel indicator (CDP Tab Watcher)
                Label {
                    visible: model.isStandard === true
                    text: "★"
                    font.pixelSize: 10
                    color: "#38BDF8"
                }

                // Paused indicator (small icon)
                Icon {
                    visible: model.paused === true
                    name: "pause"
                    size: 10
                    color: Theme.textMuted
                }

                // New videos count badge
                Rectangle {
                    visible: (model.newCount || 0) > 0
                    Layout.preferredWidth: 18
                    Layout.preferredHeight: 16
                    radius: 8
                    color: Theme.accent
                    Label {
                        anchors.centerIn: parent
                        text: model.newCount > 99 ? "99+" : model.newCount
                        color: "white"
                        font.pixelSize: 9
                        font.bold: true
                    }
                }

                // Action buttons (visible on hover when expanded)
                RowLayout {
                    visible: sideRoot.expanded
                    opacity: rowHover ? 1.0 : 0.0
                    spacing: 2
                    Layout.preferredWidth: 66

                    Behavior on opacity {
                        NumberAnimation { duration: 120 }
                    }

                    // Fast-probe toggle: channel gets the playlist-HTML probe
                    // every cycle → catches uploads minutes before the API
                    // index (for KR channels whose auto-dub delays listing).
                    Rectangle {
                        Layout.preferredWidth: 18
                        Layout.preferredHeight: 18
                        color: probeMa.containsMouse ? Theme.hoverBg : "transparent"
                        radius: 3
                        Label {
                            anchors.centerIn: parent
                            text: "⚡"
                            font.pixelSize: 11
                            color: model.fastProbe ? "#FFD93D" : Theme.textMuted
                            opacity: model.fastProbe ? 1.0 : 0.45
                        }
                        MouseArea {
                            id: probeMa
                            anchors.fill: parent
                            hoverEnabled: true
                            cursorShape: Qt.PointingHandCursor
                            onClicked: {
                                backend.send_command_async("channel:setFastProbe", {"id": model.id, "value": !model.fastProbe})
                            }
                        }
                        ToolTip.visible: probeMa.containsMouse
                        ToolTip.delay: 400
                        ToolTip.text: model.fastProbe
                            ? "Đang ưu tiên dò nhanh (HTML probe mỗi chu kỳ) — bấm để tắt"
                            : "Bật ưu tiên dò nhanh: bắt video mới sớm hơn với kênh bị YouTube liệt kê muộn (nhãn YT) — tốn ~0.9GB/giờ mỗi kênh"
                    }

                    Rectangle {
                        Layout.preferredWidth: 18
                        Layout.preferredHeight: 18
                        color: pauseMa.containsMouse ? Theme.hoverBg : "transparent"
                        radius: 3
                        Icon {
                            anchors.centerIn: parent
                            name: model.paused ? "play" : "pause"
                            size: 10
                            color: model.paused ? Theme.success : "#FFD93D"
                        }
                        MouseArea {
                            id: pauseMa
                            anchors.fill: parent
                            hoverEnabled: true
                            cursorShape: Qt.PointingHandCursor
                            onClicked: {
                                if (model.paused) {
                                    backend.send_command_async("channel:resume", {"id": model.id})
                                } else {
                                    backend.send_command_async("channel:pause", {"id": model.id})
                                }
                            }
                        }
                    }
                    Rectangle {
                        Layout.preferredWidth: 18
                        Layout.preferredHeight: 18
                        color: delMa.containsMouse ? Theme.error + "30" : "transparent"
                        radius: 3
                        Icon {
                            anchors.centerIn: parent
                            name: "delete"
                            size: 12
                            color: delMa.containsMouse ? Theme.error : Theme.textMuted
                        }
                        MouseArea {
                            id: delMa
                            anchors.fill: parent
                            hoverEnabled: true
                            cursorShape: Qt.PointingHandCursor
                            onClicked: {
                                backend.send_command_async("channel:remove", {"id": model.id})
                            }
                        }
                    }
                }
            }
        }

        Label {
            anchors.centerIn: parent
            visible: chList.count === 0
            text: "Chưa có kênh"
            color: Theme.textMuted
            font.pixelSize: 10
        }
    }

    // ─── Pagination Controls ─────────────────────────────────────────
    Rectangle {
        id: paginator
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.bottom: parent.bottom
        height: (channelListModel && channelListModel.pageCount > 1) ? 40 : 0
        visible: channelListModel && channelListModel.pageCount > 1
        color: Theme.cardBg
        clip: true

        Rectangle {
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.top: parent.top
            height: 1
            color: Theme.border
            opacity: 0.5
        }

        RowLayout {
            anchors.fill: parent
            anchors.leftMargin: 12
            anchors.rightMargin: 12
            spacing: 8

            IconButton {
                iconName: "back"
                iconSize: 12
                Layout.preferredWidth: 26
                Layout.preferredHeight: 26
                enabled: channelListModel && channelListModel.page > 0
                opacity: enabled ? 1.0 : 0.4
                onClicked: {
                    if (channelListModel) channelListModel.page -= 1
                }
            }

            Label {
                text: "Trang " + ((channelListModel ? channelListModel.page : 0) + 1) + " / " + (channelListModel ? channelListModel.pageCount : 1)
                color: Theme.textMuted
                font.pixelSize: 11
                font.bold: true
                horizontalAlignment: Text.AlignHCenter
                Layout.fillWidth: true
            }

            IconButton {
                iconName: "play"
                iconSize: 12
                Layout.preferredWidth: 26
                Layout.preferredHeight: 26
                enabled: channelListModel && channelListModel.page < channelListModel.pageCount - 1
                opacity: enabled ? 1.0 : 0.4
                onClicked: {
                    if (channelListModel) channelListModel.page += 1
                }
            }
        }
    }
}
