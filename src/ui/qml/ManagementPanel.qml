// src/ui/qml/ManagementPanel.qml
// Quản lí — left: 24h download queue (newest first). Right: full video detail
// (YouTube config, download config, render config, timeline).
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Rectangle {
    id: root
    color: Theme.bg

    // ─── State ───────────────────────────────────────────────────────
    property var workspaces: []
    property string currentVideoId: ""
    property var currentVideoData: ({})
    property bool listLoading: false
    property bool detailLoading: false
    property int totalCount: 0
    property string errorText: ""

    Component.onCompleted: refreshList()

    Connections {
        target: eventBus
        function onWorkspace_updated(params) {
            let updatedList = [];
            let found = false;
            for (let i = 0; i < root.workspaces.length; i++) {
                let ws = root.workspaces[i];
                if (ws.id === params.id) {
                    let newWs = Object.assign({}, ws);
                    if (params.field) {
                        newWs[params.field] = params.value;
                    } else {
                        Object.assign(newWs, params);
                    }
                    updatedList.push(newWs);
                    found = true;
                    if (ws.id === root.currentVideoId) {
                        let merged = Object.assign({}, root.currentVideoData, params);
                        if (params.status === "done" || params.status === "ready" || !params.field) {
                            Qt.callLater(function() {
                                if (root.currentVideoId === params.id) {
                                    const resp = backend.send_command("workspace:managementGet", {"id": params.id});
                                    if (resp && resp.ok !== false && resp.result) {
                                        root.currentVideoData = resp.result;
                                    }
                                }
                            });
                        } else {
                            root.currentVideoData = merged;
                        }
                    }
                } else {
                    updatedList.push(ws);
                }
            }
            if (found) {
                root.workspaces = updatedList;
            } else {
                if (params.id) {
                    let newWs = {
                        "id": params.id,
                        "video_id": params.video_id || params.videoId || "",
                        "channel_id": params.channel_id || params.channelId || "",
                        "channelName": params.channelName || params.channel_name || "",
                        "title": params.title || "",
                        "status": params.status || "ready",
                        "createdAt": params.createdAt || params.created_at || Date.now(),
                        "thumbnailLocal": params.thumbnailLocal || params.thumbnail_local || ""
                    };
                    root.workspaces = [newWs].concat(root.workspaces);
                    root.totalCount = root.workspaces.length;
                }
            }
        }
        function onNew_video_detected(params) {
            for (let i = 0; i < root.workspaces.length; i++) {
                if (root.workspaces[i].id === params.id) return;
            }
            let newWs = {
                "id": params.id,
                "video_id": params.videoId,
                "channel_id": params.channelId,
                "channelName": params.channelName,
                "title": params.title,
                "status": params.status || "waiting",
                "createdAt": params.detectedAt || Date.now(),
                "thumbnailLocal": params.thumbnailUrl || ""
            };
            let list = [newWs].concat(root.workspaces);
            root.workspaces = list;
            root.totalCount = list.length;
        }
    }

    function refreshList() {
        listLoading = true
        errorText = ""
        const resp = backend.send_command("workspace:managementList")
        if (resp && resp.ok !== false && resp.result) {
            workspaces = resp.result.workspaces || []
            totalCount = resp.result.count || workspaces.length
        } else {
            errorText = (resp && resp.error) || "Không tải được danh sách"
            workspaces = []
            totalCount = 0
        }
        listLoading = false
    }

    function selectVideo(id) {
        if (id === currentVideoId && currentVideoData && currentVideoData.id) return
        currentVideoId = id
        currentVideoData = {}
        detailLoading = true
        const resp = backend.send_command("workspace:managementGet", {"id": id})
        if (resp && resp.ok !== false && resp.result) {
            currentVideoData = resp.result
        } else {
            currentVideoData = {"id": id, "_error": (resp && resp.error) || "not found"}
        }
        detailLoading = false
    }

    function getSplitPartsFor(parentId) {
        if (!parentId) return [];
        let parts = [];
        for (let i = 0; i < root.workspaces.length; i++) {
            let ws = root.workspaces[i];
            if (ws.id.startsWith(parentId + "-part")) {
                parts.push(ws);
            }
        }
        parts.sort((a, b) => a.id.localeCompare(b.id));
        return parts;
    }

    // ─── Time formatters ─────────────────────────────────────────────
    function fmtAbsTime(ms) {
        if (!ms || ms <= 0) return "—"
        const d = new Date(ms)
        const pad = n => (n < 10 ? "0" + n : "" + n)
        return pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds())
            + " · " + pad(d.getDate()) + "/" + pad(d.getMonth() + 1)
    }
    function fmtFullTime(ms) {
        if (!ms || ms <= 0) return "—"
        const d = new Date(ms)
        const pad = n => (n < 10 ? "0" + n : "" + n)
        return pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds())
            + " " + pad(d.getDate()) + "/" + pad(d.getMonth() + 1) + "/" + d.getFullYear()
    }
    function fmtTimeAgo(ms) {
        if (!ms || ms <= 0) return "—"
        const diff = (Date.now() - ms) / 1000
        if (diff < 60) return Math.floor(diff) + " giây trước"
        if (diff < 3600) return Math.floor(diff / 60) + " phút trước"
        if (diff < 86400) return Math.floor(diff / 3600) + " giờ trước"
        return Math.floor(diff / 86400) + " ngày trước"
    }
    function fmtDuration(sec) {
        if (!sec || sec <= 0) return "—"
        sec = Math.floor(sec)
        const h = Math.floor(sec / 3600)
        const m = Math.floor((sec % 3600) / 60)
        const s = sec % 60
        if (h > 0) return h + "h " + m + "m " + s + "s"
        if (m > 0) return m + "m " + s + "s"
        return s + "s"
    }
    function fmtDetectionDuration(sec) {
        if (!sec || sec <= 0) return "—"
        if (sec < 60) return sec.toFixed(1) + "s"
        const h = Math.floor(sec / 3600)
        const m = Math.floor((sec % 3600) / 60)
        const s = sec % 60
        if (h > 0) return h + "h " + m + "m " + s.toFixed(1) + "s"
        if (m > 0) return m + "m " + s.toFixed(1) + "s"
        return s.toFixed(1) + "s"
    }
    function fmtBytes(b) {
        if (!b || b <= 0) return "—"
        if (b >= 1073741824) return (b / 1073741824).toFixed(2) + " GB"
        if (b >= 1048576) return (b / 1048576).toFixed(2) + " MB"
        if (b >= 1024) return (b / 1024).toFixed(1) + " KB"
        return b + " B"
    }
    function fmtClock(sec) {
        if (sec === undefined || sec === null || sec <= 0) return "00:00:00"
        sec = Math.floor(sec)
        const h = Math.floor(sec / 3600)
        const m = Math.floor((sec % 3600) / 60)
        const s = sec % 60
        const pad = n => (n < 10 ? "0" + n : "" + n)
        return pad(h) + ":" + pad(m) + ":" + pad(s)
    }

    function statusToDotState(s) {
        if (s === "done" || s === "rendered") return "ready"
        if (s === "error" || s === "failed") return "error"
        if (s === "downloading" || s === "rendering" || s === "waiting") return "running"
        return "idle"
    }
    function statusLabel(s) {
        return ({
            "new": "MỚI",
            "waiting": "CHỜ",
            "downloading": "ĐANG TẢI",
            "ready": "SẴN SÀNG",
            "rendering": "ĐANG RENDER",
            "done": "HOÀN TẤT",
            "rendered": "HOÀN TẤT",
            "error": "LỖI",
            "failed": "LỖI",
        })[s] || (s || "—").toUpperCase()
    }

    // ─── Reusable: detail section card ───────────────────────────────
    // Pass children as `data: [...]` or as default-property children via JS array.
    component SectionCard: Rectangle {
        property string sectionTitle: ""
        default property alias bodyData: bodyHolder.data
        color: Theme.cardBg
        border.color: Theme.border
        border.width: 1
        radius: Theme.radiusLg
        Layout.fillWidth: true
        implicitHeight: cardCol.implicitHeight + 24
        ColumnLayout {
            id: cardCol
            anchors.fill: parent
            anchors.margins: 12
            spacing: 8
            Label {
                text: sectionTitle
                color: Theme.accent
                font.pixelSize: 11
                font.bold: true
                font.letterSpacing: 0.6
            }
            Item {
                id: bodyHolder
                Layout.fillWidth: true
                implicitHeight: bodyHolder.childrenRect.height
            }
        }
    }

    component KVRow: RowLayout {
        id: kvRow
        property string keyText: ""
        property string valueText: ""
        property bool mono: false
        property bool multiline: false
        property bool clickable: false
        signal clicked()
        spacing: 12
        Layout.fillWidth: true
        Label {
            text: keyText
            color: Theme.textMuted
            font.pixelSize: 12
            Layout.preferredWidth: 130
            Layout.alignment: multiline ? Qt.AlignTop : Qt.AlignVCenter
        }
        Label {
            text: valueText || "—"
            color: clickable && valueText && valueText !== "—" ? Theme.accent : (valueText ? Theme.text : Theme.textMuted)
            font.pixelSize: 12
            font.family: mono ? "monospace" : "sans-serif"
            font.underline: clickable && valueText && valueText !== "—"
            elide: multiline ? Text.ElideNone : Text.ElideRight
            wrapMode: multiline ? Text.WordWrap : Text.NoWrap
            Layout.fillWidth: true

            MouseArea {
                anchors.fill: parent
                enabled: clickable && valueText && valueText !== "—"
                cursorShape: Qt.PointingHandCursor
                onClicked: kvRow.clicked()
            }
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
                text: "Quản lí"
                color: Theme.text
                font.pixelSize: 22
                font.bold: true
            }
            Label {
                text: "— 24h gần nhất"
                color: Theme.textMuted
                font.pixelSize: 14
                Layout.alignment: Qt.AlignVCenter
            }
            Item { Layout.fillWidth: true }
            Label {
                text: totalCount + " video"
                color: Theme.textMuted
                font.pixelSize: 12
                Layout.alignment: Qt.AlignVCenter
            }
            IconButton {
                iconName: "refresh"
                iconSize: 12
                Layout.preferredWidth: 28
                Layout.preferredHeight: 24
                enabled: !listLoading
                ToolTip.text: "Làm mới"
                ToolTip.visible: hovered
                ToolTip.delay: 400
                onClicked: refreshList()
            }
        }

        // ─── Two-column area ──────────────────────────────────────
        RowLayout {
            Layout.fillWidth: true
            Layout.fillHeight: true
            spacing: Theme.spacingMd

            // ─── LEFT: 24h list ────────────────────────────────────
            Rectangle {
                Layout.preferredWidth: 380
                Layout.minimumWidth: 320
                Layout.fillHeight: true
                color: Theme.cardBg
                border.color: Theme.border
                border.width: 1
                radius: Theme.radiusLg
                clip: true

                ColumnLayout {
                    anchors.fill: parent
                    anchors.margins: 8
                    spacing: 6

                    Label {
                        text: "QUEUE 24H (MỚI NHẤT TRÊN)"
                        color: Theme.textMuted
                        font.pixelSize: 10
                        font.bold: true
                        font.letterSpacing: 0.8
                    }

                    ListView {
                        id: queueList
                        Layout.fillWidth: true
                        Layout.fillHeight: true
                        model: root.workspaces
                        clip: true
                        spacing: 4
                        boundsBehavior: Flickable.StopAtBounds

                        delegate: Rectangle {
                            width: queueList.width
                            height: 64
                            radius: Theme.radiusMd
                            color: root.currentVideoId === modelData.id
                                ? Theme.accent + "22"
                                : (queueMa.containsMouse ? Theme.hoverBg : "transparent")
                            border.color: root.currentVideoId === modelData.id
                                ? Theme.accent
                                : Theme.border
                            border.width: 1

                            MouseArea {
                                id: queueMa
                                anchors.fill: parent
                                hoverEnabled: true
                                cursorShape: Qt.PointingHandCursor
                                onClicked: root.selectVideo(modelData.id)
                            }

                            RowLayout {
                                anchors.fill: parent
                                anchors.margins: 6
                                spacing: 8

                                // Thumbnail
                                Rectangle {
                                    Layout.preferredWidth: 80
                                    Layout.preferredHeight: 52
                                    radius: 3
                                    color: Theme.bg
                                    border.color: Theme.border
                                    border.width: 1
                                    clip: true
                                    Image {
                                        anchors.fill: parent
                                        source: modelData.thumbnailLocal
                                            ? "file:///" + modelData.thumbnailLocal.replace(/\\/g, "/")
                                            : (modelData.video_id
                                                ? "https://img.youtube.com/vi/" + modelData.video_id + "/mqdefault.jpg"
                                                : "")
                                        fillMode: Image.PreserveAspectCrop
                                        asynchronous: true
                                        cache: true
                                    }
                                }

                                // Title + meta
                                ColumnLayout {
                                    Layout.fillWidth: true
                                    Layout.fillHeight: true
                                    spacing: 2
                                    Label {
                                        text: modelData.title || "(không có tiêu đề)"
                                        color: Theme.text
                                        font.pixelSize: 12
                                        font.bold: true
                                        elide: Text.ElideRight
                                        Layout.fillWidth: true
                                        maximumLineCount: 1
                                    }
                                    Label {
                                        text: (modelData.channelName || modelData.channel_id || "—")
                                            + " · " + root.fmtTimeAgo(modelData.createdAt)
                                        color: Theme.textMuted
                                        font.pixelSize: 10
                                        elide: Text.ElideRight
                                        Layout.fillWidth: true
                                        maximumLineCount: 1
                                    }
                                    RowLayout {
                                        spacing: 6
                                        StatusDot {
                                            state: root.statusToDotState(modelData.status)
                                            size: 6
                                            showRing: false
                                        }
                                        Label {
                                            text: root.statusLabel(modelData.status)
                                            color: Theme.textMuted
                                            font.pixelSize: 10
                                            font.bold: true
                                        }
                                    }
                                }
                            }
                        }

                        Label {
                            anchors.centerIn: parent
                            visible: queueList.count === 0 && !root.listLoading
                            text: root.errorText
                                ? root.errorText
                                : "Chưa có video nào trong 24h qua"
                            color: Theme.textMuted
                            font.pixelSize: 13
                        }
                    }
                }
            }

            // ─── RIGHT: detail ──────────────────────────────────────
            Rectangle {
                Layout.fillWidth: true
                Layout.fillHeight: true
                color: "transparent"

                // Empty state
                ColumnLayout {
                    anchors.centerIn: parent
                    visible: !root.currentVideoId
                    spacing: 8
                    Label {
                        text: "Chọn một video để xem chi tiết"
                        color: Theme.textMuted
                        font.pixelSize: 14
                        Layout.alignment: Qt.AlignHCenter
                    }
                    Label {
                        text: "Danh sách bên trái chỉ hiển thị video trong 24h gần nhất"
                        color: Theme.textMuted
                        font.pixelSize: 11
                        Layout.alignment: Qt.AlignHCenter
                    }
                }

                // Loading
                Label {
                    anchors.centerIn: parent
                    visible: root.detailLoading
                    text: "Đang tải chi tiết…"
                    color: Theme.textMuted
                    font.pixelSize: 14
                }

                // Error
                ColumnLayout {
                    anchors.centerIn: parent
                    visible: !root.detailLoading && root.currentVideoId
                             && root.currentVideoData._error !== undefined
                    spacing: 6
                    Label {
                        text: "Không tải được chi tiết"
                        color: Theme.error
                        font.pixelSize: 14
                        font.bold: true
                        Layout.alignment: Qt.AlignHCenter
                    }
                    Label {
                        text: root.currentVideoData._error || ""
                        color: Theme.textMuted
                        font.pixelSize: 12
                        Layout.alignment: Qt.AlignHCenter
                    }
                }

                // Detail content
                ScrollView {
                    anchors.fill: parent
                    clip: true
                    visible: !root.detailLoading
                             && root.currentVideoId
                             && root.currentVideoData._error === undefined

                    ColumnLayout {
                        width: parent.width - 24
                        x: 12; y: 12
                        spacing: Theme.spacingMd

                        // ─── 1. Header card ──────────────────────────
                        SectionCard {
                            sectionTitle: "VIDEO"
                            RowLayout {
                                width: parent.width
                                spacing: 12
                                Rectangle {
                                    Layout.preferredWidth: 200
                                    Layout.preferredHeight: 112
                                    radius: Theme.radiusMd
                                    color: Theme.bg
                                    border.color: Theme.border
                                    border.width: 1
                                    clip: true
                                    Image {
                                        anchors.fill: parent
                                        source: root.currentVideoData.thumbnailLocal
                                            ? "file:///" + root.currentVideoData.thumbnailLocal.replace(/\\/g, "/")
                                            : (root.currentVideoData.video_id
                                                ? "https://img.youtube.com/vi/" + root.currentVideoData.video_id + "/mqdefault.jpg"
                                                : "")
                                        fillMode: Image.PreserveAspectCrop
                                        asynchronous: true
                                        cache: true
                                    }
                                }
                                ColumnLayout {
                                    Layout.fillWidth: true
                                    spacing: 4
                                    Label {
                                        text: root.currentVideoData.title || "(không có tiêu đề)"
                                        color: Theme.text
                                        font.pixelSize: 16
                                        font.bold: true
                                        wrapMode: Text.WordWrap
                                        Layout.fillWidth: true
                                        maximumLineCount: 3
                                        elide: Text.ElideRight
                                    }
                                    RowLayout {
                                        spacing: 6
                                        StatusDot {
                                            state: root.statusToDotState(root.currentVideoData.status)
                                            size: 8
                                            showRing: true
                                        }
                                        Label {
                                            text: root.statusLabel(root.currentVideoData.status)
                                            color: Theme.accent
                                            font.pixelSize: 12
                                            font.bold: true
                                        }
                                    }
                                    Label {
                                        text: root.currentVideoData.video_id || ""
                                        color: Theme.textMuted
                                        font.pixelSize: 10
                                        font.family: "monospace"
                                    }
                                    Label {
                                        text: root.currentVideoData.video_id
                                            ? "https://youtu.be/" + root.currentVideoData.video_id
                                            : "—"
                                        color: Theme.accent
                                        font.pixelSize: 11
                                        font.family: "monospace"
                                    }
                                }
                            }
                        }

                        // ─── 2. YouTube gốc ───────────────────────────
                        SectionCard {
                            sectionTitle: "YOUTUBE GỐC"
                            ColumnLayout {
                                width: parent.width
                                spacing: 4
                                KVRow {
                                    keyText: "Channel"
                                    valueText: root.currentVideoData.channelName
                                        || root.currentVideoData.channel_id || ""
                                }
                                KVRow {
                                    keyText: "Channel ID"
                                    valueText: root.currentVideoData.channel_id || ""
                                    mono: true
                                }
                                KVRow {
                                    keyText: "Video ID"
                                    valueText: root.currentVideoData.video_id || ""
                                    mono: true
                                }
                                KVRow {
                                    keyText: "URL"
                                    valueText: root.currentVideoData.video_id
                                        ? "https://www.youtube.com/watch?v=" + root.currentVideoData.video_id
                                        : ""
                                    mono: true
                                    clickable: true
                                    onClicked: {
                                        if (valueText) {
                                            backend.send_command("system:openUrl", {"url": valueText})
                                        }
                                    }
                                }
                                KVRow {
                                    keyText: "Published"
                                    valueText: root.fmtFullTime(root.currentVideoData.publishedAt)
                                }
                                KVRow {
                                    keyText: "Detected"
                                    valueText: root.fmtFullTime(root.currentVideoData.createdAt)
                                }
                                KVRow {
                                    keyText: "Duration (gốc)"
                                    valueText: root.fmtDuration(root.currentVideoData.durationSec)
                                }
                            }
                        }

                        // ─── 3. Download config ──────────────────────
                        SectionCard {
                            sectionTitle: "CẤU HÌNH TẢI VỀ"
                            ColumnLayout {
                                width: parent.width
                                spacing: 4
                                KVRow {
                                    keyText: "Quality target"
                                    valueText: root.currentVideoData.quality
                                        ? root.currentVideoData.quality + "p" : "—"
                                }
                                KVRow {
                                    keyText: "Client priority"
                                    valueText: {
                                        const pri = (typeof settings !== "undefined" && settings.ytDlpClientPriority)
                                            ? settings.ytDlpClientPriority.join(" → ")
                                            : "tv_embedded → web → ios"
                                        return pri
                                    }
                                }
                                KVRow {
                                    keyText: "Trim range"
                                    valueText: {
                                        const s = root.currentVideoData.trimStart || 0
                                        const e = root.currentVideoData.trimEnd || 0
                                        return (s > 0 || e > 0)
                                            ? root.fmtClock(s) + " → " + root.fmtClock(e)
                                            : "Không cắt"
                                    }
                                }
                                KVRow {
                                    keyText: "Concurrent frag."
                                    valueText: "16"
                                }
                                KVRow {
                                    keyText: "File size"
                                    valueText: root.fmtBytes(root.currentVideoData.fileSize
                                        || root.currentVideoData.downloadedSize)
                                }
                                KVRow {
                                    keyText: "Download speed"
                                    valueText: root.currentVideoData.downloadSpeed || "—"
                                }
                                KVRow {
                                    keyText: "Download time"
                                    valueText: root.fmtDuration(root.currentVideoData.downloadDurationSec)
                                }
                                KVRow {
                                    keyText: "Downloaded at"
                                    valueText: root.fmtFullTime(
                                        root.currentVideoData.downloadedMtime
                                        || root.currentVideoData.downloadedAt)
                                }
                                KVRow {
                                    keyText: "Path"
                                    valueText: root.currentVideoData.downloadedPath || ""
                                    mono: true
                                    multiline: true
                                    clickable: true
                                    onClicked: {
                                        if (valueText) {
                                            backend.send_command("system:openFolder", {"path": valueText})
                                        }
                                    }
                                }
                            }
                        }

                        // ─── 4. Render config ────────────────────────
                        SectionCard {
                            sectionTitle: "CẤU HÌNH RENDER"
                            visible: !!root.currentVideoData.autoRender || !!root.currentVideoData.renderedPath || root.currentVideoData.status === "rendering" || root.currentVideoData.status === "done"
                            ColumnLayout {
                                width: parent.width
                                spacing: 4
                                KVRow {
                                    keyText: "Auto render"
                                    valueText: root.currentVideoData.autoRender ? "BẬT" : "TẮT"
                                }
                                KVRow {
                                    keyText: "Speed (tăng tốc)"
                                    valueText: (root.currentVideoData.videoSpeed || 1.0) + "×"
                                }
                                KVRow {
                                    keyText: "Trim start"
                                    valueText: root.fmtClock(root.currentVideoData.trimStart || 0)
                                }
                                KVRow {
                                    keyText: "Trim end"
                                    valueText: root.currentVideoData.trimEnd ? root.fmtClock(root.currentVideoData.trimEnd) : "Hết video"
                                }
                                KVRow {
                                    keyText: "FPS target"
                                    valueText: {
                                        const fps = root.currentVideoData.fpsTarget || (typeof settings !== "undefined" ? settings.autoRenderFPS : 30) || 30
                                        return fps + " fps"
                                    }
                                }
                                KVRow {
                                    keyText: "Export resolution"
                                    valueText: root.currentVideoData.exportResolution || (typeof settings !== "undefined" ? settings.autoRenderResolution : "1080p") || "1080p"
                                }
                                KVRow {
                                    keyText: "Render FPS (thực tế)"
                                    valueText: root.currentVideoData.renderFps
                                        ? root.currentVideoData.renderFps + " fps" : "—"
                                }
                                KVRow {
                                    keyText: "Render preset"
                                    valueText: root.currentVideoData.renderPreset || "—"
                                }
                                KVRow {
                                    keyText: "Render codec"
                                    valueText: root.currentVideoData.renderCodec || "—"
                                }
                                KVRow {
                                    keyText: "Render workers"
                                    valueText: root.currentVideoData.renderWorkers
                                        ? "" + root.currentVideoData.renderWorkers : "—"
                                }
                                KVRow {
                                    keyText: "Render time"
                                    valueText: root.fmtDuration(root.currentVideoData.renderDurationSec)
                                }
                                KVRow {
                                    keyText: "Rendered at"
                                    valueText: root.fmtFullTime(root.currentVideoData.renderedMtime)
                                }
                                KVRow {
                                    keyText: "Output path"
                                    valueText: root.currentVideoData.renderedPath || "—"
                                    mono: true
                                    multiline: true
                                    clickable: true
                                    visible: getSplitPartsFor(root.currentVideoId).length === 0
                                    onClicked: {
                                        if (valueText && valueText !== "—") {
                                            backend.send_command("system:openFolder", {"path": valueText})
                                        }
                                    }
                                }
                                Repeater {
                                    model: getSplitPartsFor(root.currentVideoId)
                                    delegate: KVRow {
                                        keyText: "Đầu ra (" + (modelData.title || modelData.id) + ")"
                                        valueText: modelData.renderedPath || "— (đang render...)"
                                        mono: true
                                        multiline: true
                                        clickable: !!modelData.renderedPath
                                        onClicked: {
                                            if (modelData.renderedPath) {
                                                backend.send_command("system:openFolder", {"path": modelData.renderedPath})
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        // ─── 5. Timeline ─────────────────────────────
                        SectionCard {
                            sectionTitle: "TIMELINE"
                            RowLayout {
                                width: parent.width
                                spacing: 0

                                // Vertical timeline column
                                ColumnLayout {
                                    Layout.preferredWidth: 24
                                    spacing: 0

                                    Rectangle {
                                        Layout.preferredWidth: 12
                                        Layout.preferredHeight: 12
                                        radius: 6
                                        color: Theme.accent
                                        Layout.alignment: Qt.AlignHCenter
                                    }
                                    Rectangle {
                                        Layout.preferredWidth: 2
                                        Layout.fillHeight: true
                                        Layout.alignment: Qt.AlignHCenter
                                        color: Theme.border
                                    }
                                    Rectangle {
                                        Layout.preferredWidth: 12
                                        Layout.preferredHeight: 12
                                        radius: 6
                                        color: root.currentVideoData.downloadedMtime
                                            ? Theme.success : Theme.textMuted
                                        Layout.alignment: Qt.AlignHCenter
                                    }
                                    Rectangle {
                                        Layout.preferredWidth: 2
                                        Layout.preferredHeight: 12
                                        Layout.alignment: Qt.AlignHCenter
                                        color: Theme.border
                                    }
                                    Rectangle {
                                        Layout.preferredWidth: 12
                                        Layout.preferredHeight: 12
                                        radius: 6
                                        color: root.currentVideoData.renderedMtime
                                            ? Theme.success : Theme.textMuted
                                        Layout.alignment: Qt.AlignHCenter
                                    }
                                }

                                // Events column
                                ColumnLayout {
                                    Layout.fillWidth: true
                                    Layout.leftMargin: 12
                                    spacing: 12

                                    // ① Detected
                                    ColumnLayout {
                                        Layout.fillWidth: true
                                        spacing: 2
                                        Label {
                                            text: "① Phát hiện (Detected)"
                                            color: Theme.accent
                                            font.pixelSize: 12
                                            font.bold: true
                                        }
                                        Label {
                                            text: root.fmtFullTime(root.currentVideoData.createdAt)
                                                + "  ·  mất " + root.fmtDetectionDuration(root.currentVideoData.detectionDurationSec || 0)
                                            color: Theme.text
                                            font.pixelSize: 11
                                        }
                                    }

                                    // ② Download
                                    ColumnLayout {
                                        Layout.fillWidth: true
                                        spacing: 2
                                        Label {
                                            text: "② Tải về (Download)"
                                            color: root.currentVideoData.downloadedMtime
                                                ? Theme.success : Theme.textMuted
                                            font.pixelSize: 12
                                            font.bold: true
                                        }
                                        Label {
                                            text: root.currentVideoData.downloadedMtime
                                                ? (root.fmtFullTime(root.currentVideoData.downloadedMtime)
                                                    + "  ·  mất " + root.fmtDuration(root.currentVideoData.downloadDurationSec))
                                                : "Chưa tải xong"
                                            color: Theme.text
                                            font.pixelSize: 11
                                        }
                                    }

                                    // ③ Render
                                    ColumnLayout {
                                        Layout.fillWidth: true
                                        spacing: 2
                                        Label {
                                            text: "③ Render xong"
                                            color: root.currentVideoData.renderedMtime
                                                ? Theme.success : Theme.textMuted
                                            font.pixelSize: 12
                                            font.bold: true
                                        }
                                        Label {
                                            text: root.currentVideoData.renderedMtime
                                                ? (root.fmtFullTime(root.currentVideoData.renderedMtime)
                                                    + "  ·  mất " + root.fmtDuration(root.currentVideoData.renderDurationSec))
                                                : "Chưa render"
                                            color: Theme.text
                                            font.pixelSize: 11
                                        }
                                    }
                                }
                            }
                        }

                        // Error message (if any)
                        Rectangle {
                            visible: !!root.currentVideoData.error
                            Layout.fillWidth: true
                            color: Theme.error + "20"
                            border.color: Theme.error + "60"
                            border.width: 1
                            radius: Theme.radiusMd
                            implicitHeight: errCol.implicitHeight + 16
                            ColumnLayout {
                                id: errCol
                                anchors.fill: parent
                                anchors.margins: 8
                                Label {
                                    text: "LỖI"
                                    color: Theme.error
                                    font.pixelSize: 10
                                    font.bold: true
                                    font.letterSpacing: 0.8
                                }
                                Label {
                                    text: root.currentVideoData.error || ""
                                    color: Theme.text
                                    font.pixelSize: 12
                                    wrapMode: Text.WordWrap
                                    Layout.fillWidth: true
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
