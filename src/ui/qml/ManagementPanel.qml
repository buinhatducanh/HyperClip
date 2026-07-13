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
    property int totalCount: {
        let count = 0;
        for (let i = 0; i < workspaces.length; i++) {
            if (workspaces[i].id.indexOf("-part") === -1) {
                count++;
            }
        }
        return count;
    }
    property string errorText: ""
    property var selectedIds: []
    property bool isDeleteSelectMode: false

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
        root.isDeleteSelectMode = true
        let filtered = root.workspaces.filter(function(ws) {
            return ws.id.indexOf("-part") === -1;
        })
        let ids = []
        for (let i = 0; i < filtered.length; i++) {
            ids.push(filtered[i].id)
        }
        selectedIds = ids
    }

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
                    if (ws.id === root.currentVideoId || ws.id.startsWith(root.currentVideoId + "-part")) {
                        Qt.callLater(function() {
                            if (root.currentVideoId) {
                                const resp = backend.send_command("workspace:managementGet", {"id": root.currentVideoId});
                                if (resp && resp.ok !== false && resp.result) {
                                    root.currentVideoData = resp.result;
                                }
                            }
                        });
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
        }
    }

    function refreshList() {
        listLoading = true
        errorText = ""
        const resp = backend.send_command("workspace:managementList")
        if (resp && resp.ok !== false && resp.result) {
            workspaces = resp.result.workspaces || []
            // Clean up selectedIds to only keep existing ones
            let validIds = []
            for (let i = 0; i < selectedIds.length; i++) {
                let found = false
                for (let j = 0; j < workspaces.length; j++) {
                    if (workspaces[j].id === selectedIds[i]) {
                        found = true
                        break
                    }
                }
                if (found) validIds.push(selectedIds[i])
            }
            selectedIds = validIds
        } else {
            errorText = (resp && resp.error) || "Không tải được danh sách"
            workspaces = []
            selectedIds = []
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

    function getAggregateStatus(ws) {
        if (!ws || !ws.id) return "ready";
        let parts = getSplitPartsFor(ws.id);
        if (parts.length === 0) {
            return ws.status;
        }
        let hasError = false;
        let hasRendering = false;
        let hasDownloading = false;
        let hasWaiting = false;
        let allDone = true;
        for (let i = 0; i < parts.length; i++) {
            let status = parts[i].status;
            if (status === "error" || status === "failed") {
                hasError = true;
            }
            if (status === "rendering") {
                hasRendering = true;
            }
            if (status === "downloading") {
                hasDownloading = true;
            }
            if (status === "waiting") {
                hasWaiting = true;
            }
            if (status !== "done" && status !== "rendered") {
                allDone = false;
            }
        }
        if (hasError) return "error";
        if (hasRendering) return "rendering";
        if (hasDownloading) return "downloading";
        if (hasWaiting) return "waiting";
        if (allDone) return "done";
        return "ready";
    }

    function getAggregateProgress(ws) {
        if (!ws || !ws.id) return 0;
        let parts = getSplitPartsFor(ws.id);
        if (parts.length === 0) {
            return ws.progress || 0;
        }
        let total = 0;
        for (let i = 0; i < parts.length; i++) {
            let status = parts[i].status;
            if (status === "done" || status === "rendered") {
                total += 100;
            } else if (status === "rendering") {
                total += parts[i].progress || 0;
            }
        }
        return total / parts.length;
    }

    function getPartsSummary(wsId) {
        let parts = getSplitPartsFor(wsId);
        if (parts.length === 0) return "";
        let doneCount = 0;
        let renderingIndex = -1;
        for (let i = 0; i < parts.length; i++) {
            if (parts[i].status === "done" || parts[i].status === "rendered") {
                doneCount++;
            } else if (parts[i].status === "rendering" && renderingIndex === -1) {
                renderingIndex = i + 1;
            }
        }
        if (renderingIndex !== -1) {
            return " · " + parts.length + " phần (Đang render P" + renderingIndex + ")";
        }
        if (doneCount === parts.length) {
            return " · " + parts.length + " phần (Xong)";
        }
        return " · " + parts.length + " phần (" + doneCount + "/" + parts.length + ")";
    }

    // Returns whether rendering is complete (either the parent workspace is done, or all split parts are done)
    function getIsRendered(wsData) {
        if (!wsData || !wsData.id) return false;
        if (wsData.status === "done") return true;
        let parts = getSplitPartsFor(wsData.id);
        if (parts.length === 0) {
            return !!wsData.renderedMtime || wsData.status === "done";
        }
        for (let i = 0; i < parts.length; i++) {
            if (parts[i].status !== "done" && parts[i].status !== "rendered") {
                return false;
            }
        }
        return true;
    }

    function getRenderedMtime(wsData) {
        if (!wsData || !wsData.id) return 0;
        if (wsData.status === "done" && wsData.renderedMtime) {
            return wsData.renderedMtime;
        }
        let parts = getSplitPartsFor(wsData.id);
        if (parts.length === 0) {
            return wsData.renderedMtime || 0;
        }
        let maxMtime = 0;
        for (let i = 0; i < parts.length; i++) {
            if (parts[i].renderedMtime) {
                maxMtime = Math.max(maxMtime, parts[i].renderedMtime);
            } else {
                if (wsData.status === "done") continue;
                return 0;
            }
        }
        if (maxMtime > 0) return maxMtime;
        return wsData.renderedMtime || 0;
    }

    function getRenderDurationSec(wsData) {
        if (!wsData || !wsData.id) return 0.0;
        let parts = getSplitPartsFor(wsData.id);
        if (parts.length === 0) {
            return wsData.renderDurationSec || 0.0;
        }
        let totalDuration = 0.0;
        for (let i = 0; i < parts.length; i++) {
            totalDuration += parts[i].renderDurationSec || 0.0;
        }
        return totalDuration;
    }

    function getRenderStatusText(wsData) {
        if (!wsData || !wsData.id) return "Chưa render";
        let status = getAggregateStatus(wsData);
        if (status === "rendering") return "Đang render...";
        if (status === "error") return "Lỗi render";
        
        let mtime = getRenderedMtime(wsData);
        if (mtime > 0) {
            return fmtFullTime(mtime) + "  ·  mất " + fmtDuration(getRenderDurationSec(wsData));
        }
        return "Chưa render";
    }

    // ─── Time formatters ─────────────────────────────────────────────
    function fmtClockMS(sec) {
        if (sec === undefined || sec === null || sec <= 0) return "0:00"
        sec = Math.floor(sec)
        const m = Math.floor(sec / 60)
        const s = sec % 60
        return m + ":" + (s < 10 ? "0" : "") + s
    }
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
        if (sec === undefined || sec === null || sec < 0) return "—"
        if (sec < 60) return sec.toFixed(1) + "s"
        const h = Math.floor(sec / 3600)
        const m = Math.floor((sec % 3600) / 60)
        const s = sec % 60
        if (h > 0) return h + "h " + m + "m " + s.toFixed(1) + "s"
        if (m > 0) return m + "m " + s.toFixed(1) + "s"
        return s.toFixed(1) + "s"
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

    function getThumbnailSource(thumbnailLocal, videoId) {
        if (!thumbnailLocal) {
            return videoId
                ? "https://i.ytimg.com/vi/" + videoId + "/hqdefault.jpg"
                : "";
        }
        let t = thumbnailLocal.trim();
        if (t.indexOf("http://") === 0 || t.indexOf("https://") === 0 || t.indexOf("file://") === 0 || t.indexOf("qrc:") === 0) {
            return t;
        }
        return "file:///" + t.replace(/\\/g, "/");
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

    component PremiumSpinner: Item {
        id: spinnerRoot
        implicitWidth: 24
        implicitHeight: 24
        property real angle: 0.0

        NumberAnimation on angle {
            from: 0
            to: 360
            duration: 1000
            loops: Animation.Infinite
            running: spinnerRoot.visible
        }

        Rectangle {
            anchors.fill: parent
            radius: width / 2
            color: "transparent"
            border.color: "#222222"
            border.width: 2.5
        }

        Item {
            anchors.fill: parent
            rotation: spinnerRoot.angle

            Canvas {
                anchors.fill: parent
                onWidthChanged: requestPaint()
                onHeightChanged: requestPaint()
                onPaint: {
                    var ctx = getContext("2d");
                    ctx.reset();
                    ctx.strokeStyle = Theme.accent;
                    ctx.lineWidth = 2.5;
                    ctx.lineCap = "round";
                    ctx.beginPath();
                    ctx.arc(width/2, height/2, width/2 - 1.25, 0, Math.PI * 0.6);
                    ctx.stroke();
                }
            }
        }
    }

    component PanelLoadingPlaceholder: Rectangle {
        id: placeholderRoot
        property string message: "Đang xử lý..."
        color: "transparent"
        width: parent ? parent.width : 0
        implicitHeight: 80
        height: visible ? implicitHeight : 0
        visible: false

        RowLayout {
            anchors.centerIn: parent
            spacing: 12
            PremiumSpinner {
                Layout.preferredWidth: 24
                Layout.preferredHeight: 24
            }
            Label {
                text: placeholderRoot.message
                color: Theme.textMuted
                font.pixelSize: 12
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
        property var valueColor: null
        signal clicked()
        spacing: 12
        Layout.fillWidth: true
        Label {
            text: keyText
            color: Theme.textMuted
            font.pixelSize: 12
            Layout.preferredWidth: 130
            Layout.alignment: multiline ? Qt.AlignTop : Qt.AlignVCenter
            elide: Text.ElideRight
        }
        Label {
            text: valueText || "—"
            color: kvRow.valueColor !== null && kvRow.valueColor !== undefined ? kvRow.valueColor : (clickable && valueText && valueText !== "—" ? Theme.accent : (valueText ? Theme.text : Theme.textMuted))
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

                    // ─── General Actions Row ───
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
                                confirmDlg.openFor("all", "tất cả video trong 24h", function() {
                                    backend.send_command("workspace:clear")
                                    root.clearSelection()
                                    root.refreshList()
                                    root.currentVideoId = ""
                                    root.currentVideoData = {}
                                })
                            }
                        }
                    }

                    // ─── Bulk Deletion Bar (visible only when selectedIds.length > 0) ───
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
                                        confirmDlg.openFor("selection", root.selectedIds.length + " video đã chọn", function() {
                                            for (let i = 0; i < root.selectedIds.length; i++) {
                                                backend.send_command("workspace:delete", {"id": root.selectedIds[i]})
                                            }
                                            if (root.selectedIds.indexOf(root.currentVideoId) >= 0) {
                                                root.currentVideoId = ""
                                                root.currentVideoData = {}
                                            }
                                            root.clearSelection()
                                            root.refreshList()
                                        })
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

                    ListView {
                        id: queueList
                        Layout.fillWidth: true
                        Layout.fillHeight: true
                        model: root.workspaces.filter(function(ws) {
                            return ws.id.indexOf("-part") === -1;
                        })
                        clip: true
                        spacing: 4
                        boundsBehavior: Flickable.StopAtBounds

                        delegate: Rectangle {
                            id: delegateRoot
                            width: queueList.width
                            height: 64
                            radius: Theme.radiusMd
                            property bool isSelected: root.isDeleteSelectMode && (root.selectedIds.indexOf(modelData.id) >= 0)
                            color: isSelected || (!root.isDeleteSelectMode && root.currentVideoId === modelData.id)
                                ? Theme.accent + "22"
                                : (queueMa.containsMouse ? Theme.hoverBg : "transparent")
                            border.color: isSelected || (!root.isDeleteSelectMode && root.currentVideoId === modelData.id)
                                ? Theme.accent
                                : Theme.border
                            border.width: isSelected || (!root.isDeleteSelectMode && root.currentVideoId === modelData.id) ? 2 : 1

                            MouseArea {
                                id: queueMa
                                anchors.fill: parent
                                hoverEnabled: true
                                cursorShape: Qt.PointingHandCursor
                                onClicked: {
                                    if (root.isDeleteSelectMode) {
                                        root.toggleSelect(modelData.id)
                                    } else {
                                        root.selectVideo(modelData.id)
                                    }
                                }
                            }

                            // Delete button on the right
                            IconButton {
                                id: delBtn
                                anchors.right: parent.right
                                anchors.rightMargin: 8
                                anchors.verticalCenter: parent.verticalCenter
                                z: 10
                                iconName: "trash"
                                iconSize: 12
                                width: 24
                                height: 24
                                iconColorHover: Theme.error
                                opacity: delBtn.hovered ? 1.0 : (queueMa.containsMouse ? 0.85 : 0.0)
                                visible: true
                                onClicked: {
                                    confirmDlg.openFor(modelData.id, modelData.title || modelData.id, function() {
                                        backend.send_command("workspace:delete", {"id": modelData.id})
                                        if (root.currentVideoId === modelData.id) {
                                            root.currentVideoId = ""
                                            root.currentVideoData = {}
                                        }
                                        let idx = root.selectedIds.indexOf(modelData.id)
                                        if (idx >= 0) {
                                            let temp = root.selectedIds.slice()
                                            temp.splice(idx, 1)
                                            root.selectedIds = temp
                                        }
                                        root.refreshList()
                                    })
                                }
                                Behavior on opacity { NumberAnimation { duration: 150 } }
                            }

                            RowLayout {
                                anchors.left: parent.left
                                anchors.right: delBtn.left
                                anchors.top: parent.top
                                anchors.bottom: parent.bottom
                                anchors.leftMargin: 12
                                anchors.rightMargin: 4
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
                                        source: root.getThumbnailSource(modelData.thumbnailLocal, modelData.video_id)
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
                                        text: (modelData.channelName || modelData.channelId || modelData.channel_id || "—")
                                            + " · " + root.fmtTimeAgo(modelData.createdAt)
                                            + root.getPartsSummary(modelData.id)
                                        color: Theme.textMuted
                                        font.pixelSize: 10
                                        elide: Text.ElideRight
                                        Layout.fillWidth: true
                                        maximumLineCount: 1
                                    }
                                    RowLayout {
                                        spacing: 6
                                        StatusDot {
                                            state: root.statusToDotState(root.getAggregateStatus(modelData))
                                            size: 6
                                            showRing: false
                                        }
                                        Label {
                                            text: root.statusLabel(root.getAggregateStatus(modelData))
                                            color: Theme.textMuted
                                            font.pixelSize: 10
                                            font.bold: true
                                        }
                                        Label {
                                            text: {
                                                let total = (modelData.detectionDurationSec || 0) + (modelData.downloadDurationSec || 0) + (modelData.renderDurationSec || 0)
                                                return " · TỔNG: " + root.fmtDuration(total)
                                            }
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

                        // ─── Timeline (Moved to top) ─────────────────
                        SectionCard {
                            sectionTitle: {
                                let det = root.currentVideoData.detectionDurationSec || 0
                                let dl = root.currentVideoData.downloadDurationSec || 0
                                let ren = root.getRenderDurationSec(root.currentVideoData)
                                return "TIMELINE (TỔNG: " + root.fmtDuration(det + dl + ren) + ")"
                            }
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
                                        color: root.getIsRendered(root.currentVideoData)
                                            ? Theme.success
                                            : (root.getAggregateStatus(root.currentVideoData) === "rendering"
                                                ? Theme.accent
                                                : (root.getAggregateStatus(root.currentVideoData) === "error"
                                                    ? Theme.error
                                                    : Theme.textMuted))
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
                                                + (root.currentVideoData.isStartupCatchup 
                                                   ? "  ·  Khởi động ứng dụng (Catch-up)" 
                                                   : (root.currentVideoData.detectionDurationSec > 0 
                                                      ? "  ·  mất " + root.fmtDetectionDuration(root.currentVideoData.detectionDurationSec) 
                                                      : "  ·  Thời gian công chiếu ẩn"))
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
                                        Label {
                                            visible: (root.currentVideoData.queueWaitSec || 0) >= 1
                                            text: "⏸ Đợi hàng chờ tải tuần tự: " + root.fmtDuration(root.currentVideoData.queueWaitSec || 0)
                                                + " (không tính vào tổng)"
                                            color: Theme.textMuted
                                            font.pixelSize: 11
                                        }
                                    }

                                    // ③ Render
                                    ColumnLayout {
                                        Layout.fillWidth: true
                                        spacing: 2
                                        Label {
                                            text: "③ Render xong"
                                            color: root.getIsRendered(root.currentVideoData)
                                                ? Theme.success
                                                : (root.getAggregateStatus(root.currentVideoData) === "rendering"
                                                    ? Theme.accent
                                                    : (root.getAggregateStatus(root.currentVideoData) === "error"
                                                        ? Theme.error
                                                        : Theme.textMuted))
                                            font.pixelSize: 12
                                            font.bold: true
                                        }
                                        Label {
                                            text: {
                                                let statusText = root.getRenderStatusText(root.currentVideoData);
                                                if (root.getAggregateStatus(root.currentVideoData) === "error") {
                                                    let err = root.currentVideoData.error;
                                                    let parts = root.getSplitPartsFor(root.currentVideoId);
                                                    for (let i = 0; i < parts.length; i++) {
                                                        if (parts[i].error) {
                                                            err = "P" + (i+1) + ": " + parts[i].error;
                                                            break;
                                                        }
                                                    }
                                                    return "Lỗi: " + (err || "Không rõ nguyên nhân");
                                                }
                                                return statusText;
                                            }
                                            color: root.getAggregateStatus(root.currentVideoData) === "error" ? Theme.error : Theme.text
                                            font.pixelSize: 11
                                        }
                                    }
                                }
                            }
                        }

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
                                        source: root.getThumbnailSource(root.currentVideoData.thumbnailLocal, root.currentVideoData.video_id)
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
                                        || root.currentVideoData.channelId || root.currentVideoData.channel_id || ""
                                }
                                KVRow {
                                    keyText: "Channel ID"
                                    valueText: root.currentVideoData.channelId || root.currentVideoData.channel_id || ""
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
                                    valueText: {
                                        const original = root.fmtDuration(root.currentVideoData.originalDurationSec || root.currentVideoData.durationSec)
                                        const speed = root.currentVideoData.videoSpeed || 1.0
                                        const s = root.currentVideoData.trimStart || 0
                                        const e = root.currentVideoData.trimEnd || (root.currentVideoData.durationSec || 0)
                                        const hasTrim = s > 0 || (root.currentVideoData.trimEnd && e < (root.currentVideoData.durationSec || 0))
                                        if (speed !== 1.0 || hasTrim) {
                                            const target = (e - s) / speed
                                            return original + " (Đầu ra: " + root.fmtClockMS(target) + " do x" + speed + ")"
                                        }
                                        return original
                                    }
                                }
                                KVRow {
                                    keyText: "Chất lượng (gốc)"
                                    valueText: root.currentVideoData.originalQuality
                                        ? root.currentVideoData.originalQuality + "p"
                                        : "—"
                                }
                            }
                        }

                        // ─── 3. Download config ──────────────────────
                        SectionCard {
                            sectionTitle: "CẤU HÌNH TẢI VỀ"
                            Item {
                                width: parent.width
                                height: loadingDownload.visible ? loadingDownload.height : contentDownload.height

                                PanelLoadingPlaceholder {
                                    id: loadingDownload
                                    visible: {
                                        const s = root.currentVideoData.status
                                        return s === "downloading" || s === "waiting" || s === "pending" || s === "new"
                                    }
                                    message: root.currentVideoData.status === "downloading"
                                        ? "Đang tải video... " + (root.currentVideoData.progress ? Math.round(root.currentVideoData.progress) + "%" : "")
                                        : "Đang chờ tải video..."
                                }

                                ColumnLayout {
                                    id: contentDownload
                                    width: parent.width
                                    spacing: 4
                                    visible: !loadingDownload.visible
                                    height: visible ? implicitHeight : 0
                                    clip: true
                                    KVRow {
                                        keyText: "Quality target"
                                        valueText: root.currentVideoData.quality
                                            ? root.currentVideoData.quality + "p" : "—"
                                    }
                                    KVRow {
                                        keyText: "Client priority"
                                        valueText: {
                                            const pri = (typeof settings !== "undefined" && settings !== null && settings.ytDlpClientPriority)
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
                                        visible: (root.currentVideoData.queueWaitSec || 0) >= 1
                                        keyText: "Queue wait (tuần tự)"
                                        valueText: root.fmtDuration(root.currentVideoData.queueWaitSec || 0) + " — không tính vào tổng"
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
                        }

                        // ─── 4. Render config ────────────────────────
                        SectionCard {
                            sectionTitle: "CẤU HÌNH RENDER"
                            visible: {
                                const s = root.getAggregateStatus(root.currentVideoData)
                                return s !== "new" && s !== "waiting" && s !== "pending" && s !== "downloading"
                            }
                            Item {
                                width: parent.width
                                height: loadingRender.visible ? loadingRender.height : contentRender.height

                                PanelLoadingPlaceholder {
                                    id: loadingRender
                                    visible: root.getAggregateStatus(root.currentVideoData) === "rendering"
                                    message: "Đang render video... " + Math.round(root.getAggregateProgress(root.currentVideoData)) + "%"
                                }

                                ColumnLayout {
                                    id: contentRender
                                    width: parent.width
                                    spacing: 4
                                    visible: !loadingRender.visible
                                    height: visible ? implicitHeight : 0
                                    clip: true
                                    KVRow {
                                        keyText: "Auto render"
                                        valueText: root.currentVideoData.autoRender ? "BẬT" : "TẮT"
                                    }
                                    KVRow {
                                        keyText: "Speed (tăng tốc)"
                                        valueText: (root.currentVideoData.videoSpeed || 1.0) + "×"
                                    }
                                    KVRow {
                                        keyText: "Thời lượng đầu ra"
                                        valueText: {
                                            const speed = root.currentVideoData.videoSpeed || 1.0
                                            const dur = root.currentVideoData.durationSec || 0
                                            const s = root.currentVideoData.trimStart || 0
                                            const e = root.currentVideoData.trimEnd || dur
                                            const target = (e - s) / speed
                                            return root.fmtClockMS(target)
                                        }
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
                                            const fps = root.currentVideoData.fpsTarget || ((typeof settings !== "undefined" && settings !== null) ? settings.autoRenderFPS : 30) || 30
                                            return fps + " fps"
                                        }
                                    }
                                    KVRow {
                                        keyText: "Export resolution"
                                        valueText: root.currentVideoData.exportResolution || ((typeof settings !== "undefined" && settings !== null) ? settings.autoRenderResolution : "1080p") || "1080p"
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
                                        valueText: {
                                            if (root.currentVideoData.status === "error" || root.currentVideoData.status === "failed") {
                                                return "— (Lỗi: " + (root.currentVideoData.error || "Không rõ nguyên nhân") + ")"
                                            }
                                            return root.currentVideoData.renderedPath || "—"
                                        }
                                        valueColor: (root.currentVideoData.status === "error" || root.currentVideoData.status === "failed") ? Theme.error : Theme.text
                                        mono: true
                                        multiline: true
                                        clickable: !!root.currentVideoData.renderedPath && root.currentVideoData.status !== "error" && root.currentVideoData.status !== "failed"
                                        visible: getSplitPartsFor(root.currentVideoId).length === 0
                                        onClicked: {
                                            if (root.currentVideoData.renderedPath && root.currentVideoData.status !== "error" && root.currentVideoData.status !== "failed") {
                                                backend.send_command("system:openFolder", {"path": root.currentVideoData.renderedPath})
                                            }
                                        }
                                    }
                                    Repeater {
                                        model: getSplitPartsFor(root.currentVideoId)
                                        delegate: KVRow {
                                            keyText: "Đầu ra (Phần " + (index + 1) + ")"
                                            valueText: {
                                                if (modelData.status === "error" || modelData.status === "failed") {
                                                    return "— (Lỗi: " + (modelData.error || "Không rõ nguyên nhân") + ")"
                                                }
                                                return modelData.renderedPath || "— (đang render...)"
                                            }
                                            valueColor: (modelData.status === "error" || modelData.status === "failed") ? Theme.error : Theme.text
                                            mono: true
                                            multiline: true
                                            clickable: !!modelData.renderedPath && modelData.status !== "error" && modelData.status !== "failed"
                                            onClicked: {
                                                if (modelData.renderedPath && modelData.status !== "error" && modelData.status !== "failed") {
                                                    backend.send_command("system:openFolder", {"path": modelData.renderedPath})
                                                }
                                            }
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

    ConfirmationDialog {
        id: confirmDlg
    }
}

