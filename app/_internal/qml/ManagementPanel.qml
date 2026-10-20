// src/ui/qml/ManagementPanel.qml

// Quản lí — left: 24h download queue (newest first). Right: full video detail

// (YouTube config, download config, render config, timeline).

//

// Khối "Lõi quét & chính sách kênh" đã tách sang trang riêng (ScanCorePanel,

// redesign 2026-08-10) — ở đây chỉ còn badge nhịp/units trên header, bấm vào

// để nhảy sang trang đó.

import QtQuick

import QtQuick.Layouts

import QtQuick.Controls

Rectangle {

    id: root

    color: Theme.bg

    /// main.qml nối signal này vào changeView("scancore").

    signal openScanCore()

    // ─── State ───────────────────────────────────────────────────────
    property double nowMs: Date.now()
    Timer {
        interval: 1000
        running: true
        repeat: true
        onTriggered: root.nowMs = Date.now()
    }


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

    // ─── Analytics 24h KPIs ──────────────────────────────────────────
    property int statTotalCount: {
        let cnt = 0;
        for (let i = 0; i < workspaces.length; i++) {
            if (workspaces[i].id.indexOf("-part") === -1) cnt++;
        }
        return cnt;
    }

    property int statDownloadedCount: {
        let cnt = 0;
        for (let i = 0; i < workspaces.length; i++) {
            let ws = workspaces[i];
            if (ws.id.indexOf("-part") === -1 && (ws.downloadedAt || ws.downloadedMtime || ws.status === "ready" || ws.status === "rendered")) {
                cnt++;
            }
        }
        return cnt;
    }

    property int statRenderedCount: {
        let cnt = 0;
        for (let i = 0; i < workspaces.length; i++) {
            let ws = workspaces[i];
            if (ws.id.indexOf("-part") === -1 && (ws.status === "rendered" || ws.isRendered)) {
                cnt++;
            }
        }
        return cnt;
    }

    property real statTotalBytes: {
        let bytes = 0;
        for (let i = 0; i < workspaces.length; i++) {
            let ws = workspaces[i];
            if (ws.id.indexOf("-part") === -1 && ws.fileSize) {
                bytes += ws.fileSize;
            }
        }
        return bytes;
    }

    property real statAvgDetectionSec: {
        let totalSec = 0;
        let count = 0;
        for (let i = 0; i < workspaces.length; i++) {
            let ws = workspaces[i];
            if (ws.id.indexOf("-part") === -1) {
                let pubMs = (ws.publicAtMs && ws.publicAtMs > 0) ? ws.publicAtMs : ((ws.publishedAt && ws.publishedAt > 86400000) ? ws.publishedAt : 0);
                let sec = (pubMs > 0 && ws.createdAt >= pubMs) ? ((ws.createdAt - pubMs) / 1000) : (ws.detectionPublicSec || ws.detectionDurationSec || 0);
                if (sec > 0 && sec < 3600) {
                    totalSec += sec;
                    count++;
                }
            }
        }
        return count > 0 ? (totalSec / count) : 0;
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

    Component.onCompleted: {

        refreshList()

        // Số liệu quota chỉ kéo về khi mở trang; sau đó event `quota:scan` mỗi

        // nhịp tự cập nhật, không tốn thêm lệnh JSON-RPC nào.

        if (quota) quota.refresh_from_backend(backend)

    }

    function handleWorkspaceDeleted(wsId) {
        let id = (typeof wsId === "object" && wsId) ? (wsId.id || "") : (wsId || "");
        if (!id) return;
        root.workspaces = root.workspaces.filter(function(ws) {
            return ws && ws.id !== id && !ws.id.startsWith(id + "-part");
        });
        if (root.currentVideoId === id || root.currentVideoId.startsWith(id + "-part")) {
            root.currentVideoId = "";
            root.currentVideoData = {};
        }
        let selIdx = root.selectedIds.indexOf(id);
        if (selIdx >= 0) {
            let temp = root.selectedIds.slice();
            temp.splice(selIdx, 1);
            root.selectedIds = temp;
        }
        root.refreshList();
    }

    function handleWorkspaceUpdated(params) {
        if (!params || !params.id) return;
        if (params.status === "deleted") {
            root.handleWorkspaceDeleted(params.id);
            return;
        }
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
            // TUYỆT ĐỐI KHÔNG thêm mới nếu status === "deleted" hoặc không có videoId/title hợp lệ!
            if (params.id && params.status !== "deleted" && (params.video_id || params.videoId || params.title)) {
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

    function handleNewVideoDetected(params) {
        if (!params || !params.id) return;
        for (let i = 0; i < root.workspaces.length; i++) {
            if (root.workspaces[i].id === params.id) return;
        }
        let newWs = {
            "id": params.id,
            "video_id": params.videoId || params.video_id || "",
            "channel_id": params.channelId || params.channel_id || "",
            "channelName": params.channelName || params.channel_name || "",
            "title": params.title || "",
            "status": params.status || "waiting",
            "createdAt": params.detectedAt || Date.now(),
            "thumbnailLocal": params.thumbnailUrl || ""
        };
        root.workspaces = [newWs].concat(root.workspaces);
    }

    function deleteWorkspace(delId) {
        if (!delId) return;
        if (typeof backend !== "undefined" && backend) {
            backend.send_command("workspace:delete", {"id": delId});
        }
        root.handleWorkspaceDeleted(delId);
    }

    Connections {
        target: typeof eventBus !== "undefined" ? eventBus : null
        ignoreUnknownSignals: true

        function onWorkspace_deleted(wsId) { root.handleWorkspaceDeleted(wsId); }
        function onWorkspaceDeleted(wsId) { root.handleWorkspaceDeleted(wsId); }
        function onWorkspace_updated(params) { root.handleWorkspaceUpdated(params); }
        function onWorkspaceUpdated(params) { root.handleWorkspaceUpdated(params); }
        function onNew_video_detected(params) { root.handleNewVideoDetected(params); }
        function onNewVideoDetected(params) { root.handleNewVideoDetected(params); }
    }

    function refreshList() {

        listLoading = true

        errorText = ""

        if (typeof backend === "undefined" || !backend || !backend.send_command) {
            listLoading = false
            return
        }

        const resp = backend.send_command("workspace:managementList")

        if (resp && resp.ok !== false && resp.result) {

            let rawWorkspaces = resp.result.workspaces || []
            workspaces = rawWorkspaces.filter(function(ws) {
                return ws && ws.id && ws.status !== "deleted";
            })

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

        // Hoãn fetch ra khỏi stack click delegate: send_command đồng bộ spin

        // nested loop, push event workspace:update reassign root.workspaces

        // giữa chừng → Repeater rebuild, delegate video bị hủy → crash 18/07.

        Qt.callLater(function() {

            const resp = backend.send_command("workspace:managementGet", {"id": id})

            if (resp && resp.ok !== false && resp.result) {

                currentVideoData = resp.result

            } else {

                currentVideoData = {"id": id, "_error": (resp && resp.error) || "not found"}

            }

            detailLoading = false

        })

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

    // Thời gian upload TikTok tính vào e2e chỉ khi đã đăng XONG (uploaded/

    // failed đều có số đo thật); "queued"/"uploading" chưa có mốc kết thúc nên

    // không cộng — cộng dở sẽ thấy tổng nhảy lùi khi upload xong.

    function tiktokBonusSec(d) {

        if (!d || !d.tiktokStatus) return 0.0

        if (d.tiktokStatus === "queued" || d.tiktokStatus === "uploading") return 0.0

        let ttSec = (d.tiktokUploadMs || 0) / 1000.0

        return ttSec > 0 ? ttSec : 0.0

    }

    // Đọc một chặng từ chuỗi tiktokPhases ("total=6.5;app=0.9;tiktok=5.6;...").

    // Trả "" khi không có → mọi hàng dùng nó tự ẩn (video đăng bằng bản cũ).

    function ttPhase(key) {

        let raw = root.currentVideoData.tiktokPhases

        if (!raw) return ""

        let parts = String(raw).split(";")

        for (let i = 0; i < parts.length; i++) {

            let kv = parts[i].split("=")

            if (kv[0] === key) return kv[1] || ""

        }

        return ""

    }

    // MỘT công thức e2e cho MỌI chỗ hiển thị tổng (card danh sách trái +

    // timeline chi tiết). Ưu tiên trừ mốc CÔNG KHAI thật (YouTube publicAtMs).

    function detectionSecForTotal(d) {

        if (!d) return 0.0

        if (d.publicAtMs !== undefined && d.publicAtMs !== null && d.publicAtMs > 0

            && d.createdAt > 0 && d.createdAt >= d.publicAtMs)

            return (d.createdAt - d.publicAtMs) / 1000

        if (d.detectionPublicSec !== undefined && d.detectionPublicSec !== null

            && d.detectionPublicSec > 0) return d.detectionPublicSec

        if (d.detectionBilledSec !== undefined) return d.detectionBilledSec || 0

        if (d.isStartupCatchup) return 0.0

        return d.detectionDurationSec || 0

    }

    function e2eEndMs(d) {

        if (!d) return 0

        if (d.tiktokStatus === "uploaded" && d.tiktokUploadedAt > 0) return d.tiktokUploadedAt

        if ((d.status === "done" || d.status === "rendered") && getRenderedMtime(d) > 0) return getRenderedMtime(d)

        return 0

    }

    function e2eTotalSec(d, renSec) {

        if (!d) return 0.0

        const start = (d.publicAtMs && d.publicAtMs > 0 && d.createdAt >= d.publicAtMs) ? d.publicAtMs : 0

        const end = e2eEndMs(d)

        if (start > 0 && end > start && getSplitPartsFor(d.id).length === 0)

            return (end - start) / 1000

        return detectionSecForTotal(d)

             + (d.downloadDurationSec || 0)

             + (renSec || 0)

             + tiktokBonusSec(d)

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

        // ─── HEADER BAR (Tiêu đề & Chỉ báo Viễn trắc thời gian thực) ─────────────────
        RowLayout {
            Layout.fillWidth: true
            spacing: 12

            RowLayout {
                spacing: 10
                Label {
                    text: "Quản lí"
                    color: "#FFFFFF"
                    font.pixelSize: 22
                    font.bold: true
                }
                Rectangle {
                    width: 1
                    height: 16
                    color: "#2C3242"
                    Layout.alignment: Qt.AlignVCenter
                }
                Label {
                    text: "Theo dõi thời gian thực 24h"
                    color: "#8A99AD"
                    font.pixelSize: 13
                    Layout.alignment: Qt.AlignVCenter
                }
            }

            Item { Layout.fillWidth: true }

            // Chỉ báo nhịp quét & Quota Google Cloud
            Rectangle {
                visible: quota && quota.projectCount > 0
                Layout.preferredHeight: 26
                Layout.preferredWidth: hdrPaceRow.implicitWidth + 20
                radius: 13
                color: (quota && quota.throttled ? "#FFD93D15" : "#00FF8812")
                border.color: quota && quota.throttled ? "#FFD93D60" : (hdrPaceMa.containsMouse ? "#00FF8890" : "#00FF8835")
                border.width: 1

                RowLayout {
                    id: hdrPaceRow
                    anchors.centerIn: parent
                    spacing: 7

                    Rectangle {
                        width: 7; height: 7; radius: 3.5
                        color: quota && quota.throttled ? "#FFD93D" : "#00FF88"
                    }

                    Label {
                        id: hdrPace
                        text: quota ? ("Live: nhịp " + quota.intervalStr + " · " + (quota.unitsRemaining ? Number(quota.unitsRemaining).toLocaleString() : "0") + " units") : ""
                        color: quota && quota.throttled ? "#FFD93D" : "#00FF88"
                        font.pixelSize: 11
                        font.bold: true
                    }
                }

                MouseArea {
                    id: hdrPaceMa
                    anchors.fill: parent
                    hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onClicked: root.openScanCore()
                    ToolTip.text: quota
                        ? ("Đang soi " + (quota.sentinelChannels + quota.hotChannels) + " kênh · "
                           + quota.satisfiedChannels + " kênh đã đủ hôm nay · reset sau "
                           + quota.resetCountdownStr + "\nBấm để mở trang Lõi quét")
                        : ""
                    ToolTip.visible: containsMouse
                    ToolTip.delay: 300
                }
            }

            // Cảnh báo chưa có project
            Rectangle {
                visible: quota && quota.projectCount === 0
                Layout.preferredHeight: 26
                Layout.preferredWidth: hdrWarn.implicitWidth + 20
                radius: 13
                color: Theme.error + (hdrWarnMa.containsMouse ? "35" : "20")
                border.color: Theme.error
                border.width: 1

                Label {
                    id: hdrWarn
                    anchors.centerIn: parent
                    text: "⚠ CHƯA CÓ PROJECT — CẤU HÌNH LÕI QUÉT"
                    color: Theme.error
                    font.pixelSize: 11
                    font.bold: true
                }

                MouseArea {
                    id: hdrWarnMa
                    anchors.fill: parent
                    hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onClicked: root.openScanCore()
                }
            }

            // Huy hiệu số lượng video trong hàng đợi
            Rectangle {
                Layout.preferredHeight: 26
                Layout.preferredWidth: totalCountLbl.implicitWidth + 18
                radius: 6
                color: "#161922"
                border.color: "#282E3B"
                border.width: 1

                Label {
                    id: totalCountLbl
                    anchors.centerIn: parent
                    text: totalCount + " video"
                    color: "#A0AEC0"
                    font.pixelSize: 11
                    font.bold: true
                }
            }

            // Nút làm mới danh sách
            IconButton {
                iconName: "refresh"
                iconSize: 13
                Layout.preferredWidth: 28
                Layout.preferredHeight: 26
                enabled: !listLoading
                ToolTip.text: "Làm mới danh sách"
                ToolTip.visible: hovered
                ToolTip.delay: 400
                onClicked: refreshList()
            }
        }

        // ─── DẢI 4 THẺ KPI HIỆN ĐẠI (METRICS DASHBOARD) ─────────────────
        RowLayout {
            Layout.fillWidth: true
            spacing: 12

            // Card 1: Tổng Video 24h
            Rectangle {
                Layout.fillWidth: true
                Layout.preferredHeight: 64
                radius: 8
                color: "#141722"
                border.color: c1Ma.containsMouse ? "#00B4FF80" : "#232838"
                border.width: 1

                MouseArea {
                    id: c1Ma
                    anchors.fill: parent
                    hoverEnabled: true
                }

                RowLayout {
                    anchors.fill: parent
                    anchors.margins: 12
                    spacing: 12

                    Rectangle {
                        width: 40; height: 40; radius: 10
                        color: "#00B4FF15"
                        border.color: "#00B4FF40"
                        border.width: 1
                        Icon { anchors.centerIn: parent; name: "bolt"; size: 18; color: "#00B4FF" }
                    }

                    ColumnLayout {
                        Layout.fillWidth: true
                        spacing: 2
                        Label {
                            text: root.statTotalCount + " video"
                            color: "#FFFFFF"
                            font.pixelSize: 17
                            font.bold: true
                        }
                        Label {
                            text: "TỔNG PHÁT HIỆN 24H"
                            color: "#7E8B9B"
                            font.pixelSize: 9
                            font.bold: true
                            font.letterSpacing: 0.8
                        }
                    }
                }
            }

            // Card 2: Hiệu Năng Bắt Video (Độ Trễ TB)
            Rectangle {
                Layout.fillWidth: true
                Layout.preferredHeight: 64
                radius: 8
                color: "#141722"
                border.color: c2Ma.containsMouse ? "#00FF8880" : "#232838"
                border.width: 1

                MouseArea {
                    id: c2Ma
                    anchors.fill: parent
                    hoverEnabled: true
                }

                RowLayout {
                    anchors.fill: parent
                    anchors.margins: 12
                    spacing: 12

                    Rectangle {
                        width: 40; height: 40; radius: 10
                        color: "#00FF8815"
                        border.color: "#00FF8840"
                        border.width: 1
                        Icon { anchors.centerIn: parent; name: "star"; size: 16; color: "#00FF88" }
                    }

                    ColumnLayout {
                        Layout.fillWidth: true
                        spacing: 2
                        RowLayout {
                            spacing: 8
                            Label {
                                text: root.statAvgDetectionSec > 0 ? (root.statAvgDetectionSec.toFixed(1) + "s") : "< 0.5s"
                                color: "#00FF88"
                                font.pixelSize: 17
                                font.bold: true
                            }
                            Rectangle {
                                radius: 4
                                color: "#00FF8818"
                                border.color: "#00FF8845"
                                border.width: 1
                                Layout.preferredHeight: 18
                                Layout.preferredWidth: spdLbl.implicitWidth + 10
                                Label {
                                    id: spdLbl
                                    anchors.centerIn: parent
                                    text: "Siêu tốc"
                                    color: "#00FF88"
                                    font.pixelSize: 9
                                    font.bold: true
                                }
                            }
                        }
                        Label {
                            text: "ĐỘ TRỄ BẮT TRUNG BÌNH"
                            color: "#7E8B9B"
                            font.pixelSize: 9
                            font.bold: true
                            font.letterSpacing: 0.8
                        }
                    }
                }
            }

            // Card 3: Tiến Độ Tải Xuống & Dung Lượng
            Rectangle {
                Layout.fillWidth: true
                Layout.preferredHeight: 64
                radius: 8
                color: "#141722"
                border.color: c3Ma.containsMouse ? "#FF980080" : "#232838"
                border.width: 1

                MouseArea {
                    id: c3Ma
                    anchors.fill: parent
                    hoverEnabled: true
                }

                RowLayout {
                    anchors.fill: parent
                    anchors.margins: 12
                    spacing: 12

                    Rectangle {
                        width: 40; height: 40; radius: 10
                        color: "#FF980015"
                        border.color: "#FF980040"
                        border.width: 1
                        Icon { anchors.centerIn: parent; name: "download"; size: 18; color: "#FF9800" }
                    }

                    ColumnLayout {
                        Layout.fillWidth: true
                        spacing: 2
                        RowLayout {
                            spacing: 6
                            Label {
                                text: root.statDownloadedCount + " / " + root.statTotalCount
                                color: "#FFFFFF"
                                font.pixelSize: 17
                                font.bold: true
                            }
                            Label {
                                visible: root.statTotalBytes > 0
                                text: "· " + root.fmtBytes(root.statTotalBytes)
                                color: "#8A99AD"
                                font.pixelSize: 12
                                font.weight: Font.Medium
                            }
                            Rectangle {
                                visible: root.statTotalCount > 0
                                radius: 4
                                color: "#FF980018"
                                border.color: "#FF980045"
                                border.width: 1
                                Layout.preferredHeight: 18
                                Layout.preferredWidth: dlPctLbl.implicitWidth + 10
                                Label {
                                    id: dlPctLbl
                                    anchors.centerIn: parent
                                    text: Math.round((root.statDownloadedCount / Math.max(1, root.statTotalCount)) * 100) + "%"
                                    color: "#FF9800"
                                    font.pixelSize: 9
                                    font.bold: true
                                }
                            }
                        }
                        Label {
                            text: "TIẾN ĐỘ TẢI XUỐNG"
                            color: "#7E8B9B"
                            font.pixelSize: 9
                            font.bold: true
                            font.letterSpacing: 0.8
                        }
                    }
                }
            }

            // Card 4: Hiệu Suất Render (NVENC)
            Rectangle {
                Layout.fillWidth: true
                Layout.preferredHeight: 64
                radius: 8
                color: "#141722"
                border.color: c4Ma.containsMouse ? "#B388FF80" : "#232838"
                border.width: 1

                MouseArea {
                    id: c4Ma
                    anchors.fill: parent
                    hoverEnabled: true
                }

                RowLayout {
                    anchors.fill: parent
                    anchors.margins: 12
                    spacing: 12

                    Rectangle {
                        width: 40; height: 40; radius: 10
                        color: "#B388FF15"
                        border.color: "#B388FF40"
                        border.width: 1
                        Icon { anchors.centerIn: parent; name: "render"; size: 16; color: "#B388FF" }
                    }

                    ColumnLayout {
                        Layout.fillWidth: true
                        spacing: 2
                        RowLayout {
                            spacing: 8
                            Label {
                                text: root.statRenderedCount + " video"
                                color: root.statRenderedCount > 0 ? "#B388FF" : "#FFFFFF"
                                font.pixelSize: 17
                                font.bold: true
                            }
                            Rectangle {
                                radius: 4
                                color: "#B388FF18"
                                border.color: "#B388FF45"
                                border.width: 1
                                Layout.preferredHeight: 18
                                Layout.preferredWidth: nvBadgeLbl.implicitWidth + 10
                                Label {
                                    id: nvBadgeLbl
                                    anchors.centerIn: parent
                                    text: "NVENC"
                                    color: "#B388FF"
                                    font.pixelSize: 9
                                    font.bold: true
                                }
                            }
                        }
                        Label {
                            text: "RENDER HOÀN TẤT"
                            color: "#7E8B9B"
                            font.pixelSize: 9
                            font.bold: true
                            font.letterSpacing: 0.8
                        }
                    }
                }
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

                                    root.workspaces = []

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

                                            let toDelete = root.selectedIds.slice()
                                            for (let i = 0; i < toDelete.length; i++) {
                                                backend.send_command("workspace:delete", {"id": toDelete[i]})
                                            }
                                            root.workspaces = root.workspaces.filter(function(ws) {
                                                return ws && toDelete.indexOf(ws.id) === -1 && !toDelete.some(function(selId) { return ws.id.startsWith(selId + "-part"); });
                                            })

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
                        reuseItems: true
                        cacheBuffer: 640

                        Layout.fillWidth: true

                        Layout.fillHeight: true

                        model: {

                            // Video cha (= part 1) trước, các part 2/3 xếp

                            // NGAY DƯỚI — trước đây part bị ẩn hoàn toàn khỏi

                            // danh sách (khách báo "part 2 không xuất hiện",

                            // 2026-07-17).

                            let parents = root.workspaces.filter(function(ws) {
                                return ws && ws.id && ws.id.indexOf("-part") === -1 && ws.status !== "deleted";
                            });

                            let out = [];

                            for (let i = 0; i < parents.length; i++) {

                                out.push(parents[i]);

                                let parts = root.getSplitPartsFor(parents[i].id);

                                for (let j = 0; j < parts.length; j++) {
                                    if (parts[j] && parts[j].status !== "deleted") {
                                        out.push(parts[j]);
                                    }
                                }

                            }

                            return out;

                        }

                        clip: true

                        spacing: 4

                        boundsBehavior: Flickable.StopAtBounds

                        delegate: Rectangle {
                            id: delegateRoot
                            width: queueList.width
                            height: (modelData && modelData.id && modelData.status !== "deleted") ? 64 : 0
                            visible: !!(modelData && modelData.id && modelData.status !== "deleted")

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

                                anchors.rightMargin: 6

                                anchors.verticalCenter: parent.verticalCenter

                                z: 10

                                iconName: "trash"

                                iconSize: 12

                                padding: 4

                                radiusVal: 3

                                iconColorIdle: Theme.textMuted

                                iconColorHover: Theme.error

                                opacity: delBtn.hovered ? 1.0 : (queueMa.containsMouse ? 0.85 : 0.0)

                                onClicked: {
                                    let targetId = (typeof modelData !== "undefined" && modelData) ? modelData.id : ""
                                    let targetTitle = (typeof modelData !== "undefined" && modelData) ? (modelData.title || modelData.id) : ""
                                    if (!targetId) return
                                    confirmDlg.openFor(targetId, targetTitle, function(confirmedId) {
                                        root.deleteWorkspace(confirmedId || targetId)
                                    })
                                }

                                Behavior on opacity { NumberAnimation { duration: 150 } }

                            }

                            RowLayout {

                                z: 5

                                anchors.left: parent.left

                                anchors.right: delBtn.left

                                anchors.top: parent.top

                                anchors.bottom: parent.bottom

                                anchors.leftMargin: 12

                                anchors.rightMargin: 8

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
                                        sourceSize.width: 160
                                        sourceSize.height: 104

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

                                    RowLayout {

                                        Layout.fillWidth: true

                                        spacing: 6

                                        Rectangle {

                                            visible: (modelData.partTotal || 0) >= 2 && (modelData.partIndex || 0) >= 1

                                            Layout.preferredHeight: 16

                                            Layout.preferredWidth: mgmtPartLabel.implicitWidth + 8

                                            radius: 3

                                            color: Theme.accent + "25"

                                            border.color: Theme.accent

                                            border.width: 1

                                            Label {

                                                id: mgmtPartLabel

                                                anchors.centerIn: parent

                                                text: "P" + (modelData.partIndex || 0) + "/" + (modelData.partTotal || 0)

                                                color: Theme.accent

                                                font.pixelSize: 9

                                                font.bold: true

                                            }

                                        }

                                        Label {

                                            text: modelData.title || "(không có tiêu đề)"

                                            color: Theme.text

                                            font.pixelSize: 12

                                            font.bold: true

                                            elide: Text.ElideRight

                                            Layout.fillWidth: true

                                            maximumLineCount: 1

                                        }

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

                                        // Part đã hiện thành hàng riêng — mỗi hàng

                                        // hiển thị trạng thái CỦA CHÍNH NÓ (aggregate

                                        // cũ làm part 1 xong vẫn báo "đang tải").

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

                                        Label {

                                            text: {

                                                // Tổng của CHÍNH hàng này (render riêng của nó —

                                                // part là hàng riêng từ pass 29) + chặng TikTok.

                                                let total = root.e2eTotalSec(modelData, modelData.renderDurationSec || 0)

                                                return " · TỔNG: " + root.fmtDuration(total)

                                            }

                                            color: Theme.textMuted

                                            font.pixelSize: 10

                                            font.bold: true

                                        }

                                        // Pass 38: trạng thái auto-upload TikTok của part này

                                        Rectangle {

                                            visible: !!modelData.tiktokStatus

                                            Layout.preferredHeight: 15

                                            Layout.preferredWidth: ttBadgeLabel.implicitWidth + 8

                                            radius: 3

                                            property color ttColor: modelData.tiktokStatus === "uploaded" ? Theme.success

                                                : modelData.tiktokStatus === "failed" ? Theme.error

                                                : Theme.accent

                                            color: ttColor + "20"

                                            border.color: ttColor

                                            border.width: 1

                                            Label {

                                                id: ttBadgeLabel

                                                anchors.centerIn: parent

                                                text: modelData.tiktokStatus === "uploaded" ? "TikTok ✓"

                                                    : modelData.tiktokStatus === "failed" ? "TikTok ✗"

                                                    : modelData.tiktokStatus === "uploading" ? "TikTok đang đăng"

                                                    : "TikTok chờ"

                                                color: parent.ttColor

                                                font.pixelSize: 9

                                                font.bold: true

                                            }

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

                                                // ─── Timeline (Modern Flow Stepper Cards) ─────────────────
                        // ─── Timeline (Modern Flow Stepper Cards) ─────────────────
                        SectionCard {
                            sectionTitle: {
                                let ren = root.getRenderDurationSec(root.currentVideoData)
                                let total = root.e2eTotalSec(root.currentVideoData, ren)
                                let ttSec = root.tiktokBonusSec(root.currentVideoData)
                                let label = "TIMELINE TOÀN TRÌNH E2E (TỔNG: " + root.fmtDuration(total) + ")"
                                if (ttSec > 0) label += "  ·  upload " + root.fmtDuration(ttSec)
                                return label
                            }

                            ColumnLayout {
                                width: parent.width
                                spacing: 10

                                // ① Bước Phát hiện (Detected)
                                Rectangle {
                                    Layout.fillWidth: true
                                    Layout.preferredHeight: detStepCol.implicitHeight + 20
                                    radius: 6
                                    color: "#161922"
                                    border.color: Theme.accent + "40"
                                    border.width: 1

                                    RowLayout {
                                        id: detStepCol
                                        anchors.fill: parent
                                        anchors.margins: 12
                                        spacing: 12

                                        Rectangle {
                                            width: 36; height: 36; radius: 18
                                            color: Theme.accent + "18"
                                            border.color: Theme.accent + "60"
                                            border.width: 1
                                            Icon { anchors.centerIn: parent; name: "bolt"; size: 16; color: Theme.accent }
                                        }

                                        ColumnLayout {
                                            Layout.fillWidth: true
                                            spacing: 4

                                            RowLayout {
                                                spacing: 8
                                                Label {
                                                    text: "① PHÁT HIỆN VIDEO (DETECTED)"
                                                    color: Theme.accent
                                                    font.pixelSize: 11
                                                    font.bold: true
                                                }
                                                Rectangle {
                                                    property var pubMs: (root.currentVideoData.publicMarkMs && root.currentVideoData.publicMarkMs > 0)
                                                                        ? root.currentVideoData.publicMarkMs
                                                                        : ((root.currentVideoData.publicAtMs && root.currentVideoData.publicAtMs > 0)
                                                                            ? root.currentVideoData.publicAtMs
                                                                            : ((root.currentVideoData.publishedAt && root.currentVideoData.publishedAt > 86400000) ? root.currentVideoData.publishedAt : 0))
                                                    property real rawDiffSec: pubMs > 0 ? (root.currentVideoData.createdAt - pubMs) / 1000.0 : 0
                                                    property string detDelayText: {
                                                        if (pubMs <= 0) return ""
                                                        if (rawDiffSec >= 0) return root.fmtDetectionDuration(rawDiffSec)
                                                        if (rawDiffSec >= -2.0) return "< 0.5s (Tức thì)"
                                                        return "0.0s"
                                                    }
                                                    visible: pubMs > 0
                                                    radius: 4
                                                    color: Theme.accent + "25"
                                                    border.color: Theme.accent + "50"
                                                    border.width: 1
                                                    Layout.preferredHeight: 20
                                                    Layout.preferredWidth: detBadgeLbl.implicitWidth + 12
                                                    Label {
                                                        id: detBadgeLbl
                                                        anchors.centerIn: parent
                                                        text: "Độ trễ: " + parent.detDelayText
                                                        color: Theme.accent
                                                        font.pixelSize: 10
                                                        font.bold: true
                                                    }
                                                }
                                                Rectangle {
                                                    readonly property bool isDualRace: (root.currentVideoData.surface === "playlistHtml" || root.currentVideoData.surface === "cdp" || root.currentVideoData.anchor === "player_microformat")
                                                    radius: 4
                                                    color: isDualRace ? "#B388FF25" : "#00E67620"
                                                    border.color: isDualRace ? "#B388FF60" : "#00E67650"
                                                    border.width: 1
                                                    Layout.preferredHeight: 20
                                                    Layout.preferredWidth: apiBadgeLbl.implicitWidth + 12
                                                    Label {
                                                        id: apiBadgeLbl
                                                        anchors.centerIn: parent
                                                        text: parent.parent.isDualRace ? "⚡ ĐUA KÉP: HTML/CDP THẮNG" : "YouTube API v3"
                                                        color: parent.parent.isDualRace ? "#B388FF" : "#00E676"
                                                        font.pixelSize: 10
                                                        font.bold: true
                                                    }
                                                }
                                            }

                                            Label {
                                                property var pubMs: (root.currentVideoData.publicMarkMs && root.currentVideoData.publicMarkMs > 0)
                                                                    ? root.currentVideoData.publicMarkMs
                                                                    : ((root.currentVideoData.publicAtMs && root.currentVideoData.publicAtMs > 0)
                                                                        ? root.currentVideoData.publicAtMs
                                                                        : ((root.currentVideoData.publishedAt && root.currentVideoData.publishedAt > 86400000) ? root.currentVideoData.publishedAt : 0))
                                                property real rawDiffSec: pubMs > 0 ? (root.currentVideoData.createdAt - pubMs) / 1000.0 : 0
                                                text: {
                                                    if (pubMs <= 0) return "Bắt lúc: " + root.fmtFullTime(root.currentVideoData.createdAt)
                                                    let s = "Chủ kênh bấm Đăng (Công khai): " + root.fmtFullTime(pubMs) + "  →  Bắt lúc: " + root.fmtFullTime(root.currentVideoData.createdAt)
                                                    if (rawDiffSec >= 0) {
                                                        return s + " (độ trễ: " + root.fmtDetectionDuration(rawDiffSec) + ")"
                                                    } else if (rawDiffSec >= -2.0) {
                                                        return s + " (⚡ Bắt tức thì — chênh lệch với tem YouTube: " + Math.round(rawDiffSec * 1000) + "ms)"
                                                    } else {
                                                        return s + " (mất " + root.fmtDetectionDuration(Math.abs(rawDiffSec)) + ")"
                                                    }
                                                }
                                                color: Theme.text
                                                font.pixelSize: 11
                                                font.weight: Font.Medium
                                            }

                                            Label {
                                                readonly property bool isDualRace: (root.currentVideoData.surface === "playlistHtml" || root.currentVideoData.surface === "cdp" || root.currentVideoData.anchor === "player_microformat")
                                                text: isDualRace 
                                                      ? "⚡ Mốc công khai là thời điểm chủ kênh bấm Đăng (khớp nhãn 'vài giây trước'). Mặt phẳng Đua kép bắt trước API ~3.5s."
                                                      : "⚡ Mốc công khai là thời điểm chủ kênh bấm Đăng trên YouTube Studio (khớp nhãn 'vài giây trước'). Quét tự động qua YouTube API v3."
                                                color: isDualRace ? "#B388FF" : Theme.textMuted
                                                font.pixelSize: 10
                                            }
                                        }
                                    }
                                }

                                // ② Bước Tải về (Download)
                                Rectangle {
                                    readonly property bool isDownloaded: !!(root.currentVideoData.downloadedAt || root.currentVideoData.downloadedMtime)
                                    readonly property bool isDownloading: root.currentVideoData.status === "downloading"
                                    readonly property bool isDlError: root.currentVideoData.status === "error" && !root.currentVideoData.downloadedPath
                                    Layout.fillWidth: true
                                    Layout.preferredHeight: dlStepCol.implicitHeight + 20
                                    radius: 6
                                    color: "#161922"
                                    border.color: isDownloaded ? (Theme.success + "40") : (isDownloading ? (Theme.statusDownloading + "50") : (isDlError ? Theme.error : "#232836"))
                                    border.width: 1

                                    RowLayout {
                                        id: dlStepCol
                                        anchors.fill: parent
                                        anchors.margins: 12
                                        spacing: 12

                                        Rectangle {
                                            width: 36; height: 36; radius: 18
                                            color: parent.parent.isDownloaded ? (Theme.success + "18") : (parent.parent.isDownloading ? (Theme.statusDownloading + "18") : "#232836")
                                            border.color: parent.parent.isDownloaded ? Theme.success : (parent.parent.isDownloading ? Theme.statusDownloading : "#3A4456")
                                            border.width: 1
                                            Icon {
                                                anchors.centerIn: parent
                                                name: parent.parent.parent.isDownloaded ? "check" : "download"
                                                size: 16
                                                color: parent.parent.parent.isDownloaded ? Theme.success : (parent.parent.parent.isDownloading ? Theme.statusDownloading : Theme.textMuted)
                                            }
                                        }

                                        ColumnLayout {
                                            Layout.fillWidth: true
                                            spacing: 4

                                            RowLayout {
                                                spacing: 8
                                                Label {
                                                    text: "② TẢI XUỐNG BỘ NHỚ ĐỆM (DOWNLOAD)"
                                                    color: parent.parent.parent.parent.isDownloaded ? Theme.success : (parent.parent.parent.parent.isDownloading ? Theme.statusDownloading : (parent.parent.parent.parent.isDlError ? Theme.error : Theme.textMuted))
                                                    font.pixelSize: 11
                                                    font.bold: true
                                                }
                                                Rectangle {
                                                    visible: parent.parent.parent.parent.isDownloaded && root.currentVideoData.fileSize > 0
                                                    radius: 4
                                                    color: Theme.success + "20"
                                                    border.color: Theme.success + "50"
                                                    border.width: 1
                                                    Layout.preferredHeight: 20
                                                    Layout.preferredWidth: dlSizeLbl.implicitWidth + 12
                                                    Label {
                                                        id: dlSizeLbl
                                                        anchors.centerIn: parent
                                                        text: root.fmtBytes(root.currentVideoData.fileSize)
                                                        color: Theme.success
                                                        font.pixelSize: 10
                                                        font.bold: true
                                                    }
                                                }
                                                Rectangle {
                                                    visible: !!root.currentVideoData.downloadPath
                                                    radius: 4
                                                    color: "#232836"
                                                    border.color: "#3A4456"
                                                    border.width: 1
                                                    Layout.preferredHeight: 20
                                                    Layout.preferredWidth: dlEngineLbl.implicitWidth + 12
                                                    Label {
                                                        id: dlEngineLbl
                                                        anchors.centerIn: parent
                                                        text: root.currentVideoData.downloadPath || "yt-dlp"
                                                        color: Theme.textMuted
                                                        font.pixelSize: 10
                                                    }
                                                }
                                            }

                                            Label {
                                                property var dlTime: (root.currentVideoData.downloadedAt || root.currentVideoData.downloadedMtime || 0)
                                                property real dlSec: (root.currentVideoData.downloadDurationSec > 0)
                                                                     ? root.currentVideoData.downloadDurationSec
                                                                     : (root.currentVideoData.downloadTime ? parseFloat(root.currentVideoData.downloadTime) : 0)
                                                property string subInfo: {
                                                    let parts = []
                                                    if (root.currentVideoData.downloadSpeed) parts.push("Tốc độ: " + root.currentVideoData.downloadSpeed)
                                                    return parts.length > 0 ? ("  ·  " + parts.join(" · ")) : ""
                                                }
                                                text: dlTime > 0
                                                    ? ("Hoàn tất tải: " + root.fmtFullTime(dlTime) + "  ·  Thời gian tải: " + root.fmtDuration(dlSec) + subInfo)
                                                    : (parent.parent.parent.parent.isDownloading ? "Đang truyền dữ liệu video về đĩa..." : (root.currentVideoData.status === "waiting" ? "Chờ slot tải downlink..." : (parent.parent.parent.parent.isDlError ? ("Lỗi tải: " + (root.currentVideoData.error || "")) : "Chưa tải")))
                                                color: Theme.text
                                                font.pixelSize: 11
                                                font.weight: Font.Medium
                                            }

                                            Label {
                                                text: root.currentVideoData.downloadedPath ? ("📁 Vị trí lưu: " + root.currentVideoData.downloadedPath) : "📁 Tệp lưu trữ: Bộ nhớ đệm cục bộ /downloads"
                                                color: Theme.textMuted
                                                font.pixelSize: 10
                                                elide: Text.ElideMiddle
                                                Layout.fillWidth: true
                                            }
                                        }
                                    }
                                }

                                // ③ Bước Render (Rendered)
                                Rectangle {
                                    readonly property bool isRenderDone: root.getIsRendered(root.currentVideoData)
                                    readonly property bool isRendering: root.getAggregateStatus(root.currentVideoData) === "rendering"
                                    readonly property bool isRenderError: root.getAggregateStatus(root.currentVideoData) === "error"
                                    Layout.fillWidth: true
                                    Layout.preferredHeight: renStepCol.implicitHeight + 20
                                    radius: 6
                                    color: "#161922"
                                    border.color: isRenderDone ? ("#B388FF50") : (isRendering ? (Theme.accent + "50") : (isRenderError ? Theme.error : "#232836"))
                                    border.width: 1

                                    RowLayout {
                                        id: renStepCol
                                        anchors.fill: parent
                                        anchors.margins: 12
                                        spacing: 12

                                        Rectangle {
                                            width: 36; height: 36; radius: 18
                                            color: parent.parent.isRenderDone ? ("#B388FF20") : (parent.parent.isRendering ? (Theme.accent + "20") : "#232836")
                                            border.color: parent.parent.isRenderDone ? "#B388FF" : (parent.parent.isRendering ? Theme.accent : "#3A4456")
                                            border.width: 1
                                            Icon {
                                                anchors.centerIn: parent
                                                name: parent.parent.parent.isRenderDone ? "check" : "render"
                                                size: 16
                                                color: parent.parent.parent.isRenderDone ? "#B388FF" : (parent.parent.parent.isRendering ? Theme.accent : Theme.textMuted)
                                            }
                                        }

                                        ColumnLayout {
                                            Layout.fillWidth: true
                                            spacing: 4

                                            RowLayout {
                                                spacing: 8
                                                Label {
                                                    text: "③ BIÊN TẬP & RENDER VIDEO"
                                                    color: parent.parent.parent.parent.isRenderDone ? "#B388FF" : (parent.parent.parent.parent.isRendering ? Theme.accent : (parent.parent.parent.parent.isRenderError ? Theme.error : Theme.textMuted))
                                                    font.pixelSize: 11
                                                    font.bold: true
                                                }
                                                Rectangle {
                                                    radius: 4
                                                    color: parent.parent.parent.parent.isRenderDone ? "#B388FF25" : "#232836"
                                                    border.color: parent.parent.parent.parent.isRenderDone ? "#B388FF50" : "#3A4456"
                                                    border.width: 1
                                                    Layout.preferredHeight: 20
                                                    Layout.preferredWidth: renBadgeLbl.implicitWidth + 12
                                                    Label {
                                                        id: renBadgeLbl
                                                        anchors.centerIn: parent
                                                        text: parent.parent.parent.parent.parent.isRenderDone ? "NVENC Xong" : "NVENC Sẵn sàng"
                                                        color: parent.parent.parent.parent.parent.isRenderDone ? "#B388FF" : Theme.textMuted
                                                        font.pixelSize: 10
                                                        font.bold: true
                                                    }
                                                }
                                            }

                                            Label {
                                                text: {
                                                    let statusText = root.getRenderStatusText(root.currentVideoData);
                                                    if (parent.parent.parent.parent.isRenderError) {
                                                        let err = root.currentVideoData.error;
                                                        let parts = root.getSplitPartsFor(root.currentVideoId);
                                                        for (let i = 0; i < parts.length; i++) {
                                                            if (parts[i].error) { err = "P" + (i+1) + ": " + parts[i].error; break; }
                                                        }
                                                        return "Lỗi: " + (err || "Không rõ nguyên nhân");
                                                    }
                                                    if (parent.parent.parent.parent.isRenderDone) return statusText;
                                                    return "Cấu hình: " + (root.currentVideoData.exportResolution || "1080p") + " · Tốc độ " + (root.currentVideoData.videoSpeed || 1.1) + "x · FPS " + (root.currentVideoData.fpsTarget || 30) + " · Cắt " + (root.currentVideoData.durationSec || 300) + "s";
                                                }
                                                color: parent.parent.parent.parent.isRenderError ? Theme.error : Theme.text
                                                font.pixelSize: 11
                                                font.weight: Font.Medium
                                            }

                                            Label {
                                                text: parent.parent.parent.parent.isRenderDone 
                                                      ? "🚀 Công nghệ: NVIDIA NVENC Hardware Accelerated · Preset P1 ULL"
                                                      : "⏸ Video nguồn đã hoàn tất trong bộ nhớ đệm, sẵn sàng render tự động hoặc thủ công"
                                                color: Theme.textMuted
                                                font.pixelSize: 10
                                            }
                                        }
                                    }
                                }

                                // ④ Bước Đăng TikTok (Luôn hiển thị trạng thái rõ ràng)
                                Rectangle {
                                    readonly property bool isTtUploaded: root.currentVideoData.tiktokStatus === "uploaded"
                                    readonly property bool isTtFailed: root.currentVideoData.tiktokStatus === "failed"
                                    readonly property bool isTtConfigured: !!root.currentVideoData.tiktokStatus
                                    Layout.fillWidth: true
                                    Layout.preferredHeight: ttStepCol.implicitHeight + 20
                                    radius: 6
                                    color: "#161922"
                                    border.color: isTtUploaded ? (Theme.success + "40") : (isTtFailed ? Theme.error : "#232836")
                                    border.width: 1

                                    RowLayout {
                                        id: ttStepCol
                                        anchors.fill: parent
                                        anchors.margins: 12
                                        spacing: 12

                                        Rectangle {
                                            width: 36; height: 36; radius: 18
                                            color: parent.parent.isTtUploaded ? (Theme.success + "18") : (parent.parent.isTtFailed ? (Theme.error + "18") : "#232836")
                                            border.color: parent.parent.isTtUploaded ? Theme.success : (parent.parent.isTtFailed ? Theme.error : "#3A4456")
                                            border.width: 1
                                            Icon {
                                                anchors.centerIn: parent
                                                name: parent.parent.parent.isTtUploaded ? "check" : "upload"
                                                size: 16
                                                color: parent.parent.parent.isTtUploaded ? Theme.success : (parent.parent.parent.isTtFailed ? Theme.error : Theme.textMuted)
                                            }
                                        }

                                        ColumnLayout {
                                            Layout.fillWidth: true
                                            spacing: 4

                                            RowLayout {
                                                spacing: 8
                                                Label {
                                                    text: "④ XUẤT BẢN TIKTOK"
                                                    color: parent.parent.parent.parent.isTtUploaded ? Theme.success : (parent.parent.parent.parent.isTtFailed ? Theme.error : Theme.textMuted)
                                                    font.pixelSize: 11
                                                    font.bold: true
                                                }
                                                Rectangle {
                                                    radius: 4
                                                    color: parent.parent.parent.parent.isTtUploaded ? (Theme.success + "20") : "#232836"
                                                    border.color: parent.parent.parent.parent.isTtUploaded ? (Theme.success + "50") : "#3A4456"
                                                    border.width: 1
                                                    Layout.preferredHeight: 20
                                                    Layout.preferredWidth: ttBadgeLbl.implicitWidth + 12
                                                    Label {
                                                        id: ttBadgeLbl
                                                        anchors.centerIn: parent
                                                        text: parent.parent.parent.parent.parent.isTtUploaded ? "Đã đăng bài" : "Chờ kích hoạt"
                                                        color: parent.parent.parent.parent.parent.isTtUploaded ? Theme.success : Theme.textMuted
                                                        font.pixelSize: 10
                                                        font.bold: true
                                                    }
                                                }
                                            }

                                            Label {
                                                text: {
                                                    let s = root.currentVideoData.tiktokStatus
                                                    let tt = root.currentVideoData.tiktokUploadedAt
                                                    let ms = root.currentVideoData.tiktokUploadMs
                                                    if (s === "uploaded") return "Đăng thành công lúc: " + root.fmtFullTime(tt) + (ms ? ("  ·  Thời gian upload: " + root.fmtDuration(ms / 1000.0)) : "")
                                                    if (s === "failed") return "Lỗi đăng: " + (root.currentVideoData.tiktokError || "Không rõ nguyên nhân")
                                                    if (s === "uploading") return "Đang đẩy tệp lên TikTok..."
                                                    if (s === "queued") return "Chờ xuất bản TikTok theo lịch"
                                                    return "Chưa bật chế độ đăng bài tự động hoặc chưa liên kết tài khoản TikTok"
                                                }
                                                color: parent.parent.parent.parent.isTtFailed ? Theme.error : Theme.text
                                                font.pixelSize: 11
                                                font.weight: Font.Medium
                                            }

                                            Label {
                                                text: "🎵 Nền tảng: TikTok Web Automation qua Chrome CDP an toàn · Không lưu cookie ngoài phạm vi"
                                                color: Theme.textMuted
                                                font.pixelSize: 10
                                            }
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

                                            backend.send_command_async("system:openUrl", {"url": valueText})

                                        }

                                    }

                                }

                                KVRow {
                                    property var pubMs: (root.currentVideoData.publicMarkMs && root.currentVideoData.publicMarkMs > 0)
                                                        ? root.currentVideoData.publicMarkMs
                                                        : ((root.currentVideoData.publicAtMs && root.currentVideoData.publicAtMs > 0)
                                                            ? root.currentVideoData.publicAtMs
                                                            : ((root.currentVideoData.publishedAt && root.currentVideoData.publishedAt > 86400000) ? root.currentVideoData.publishedAt : 0))
                                    keyText: "Chủ kênh bấm Đăng"
                                    valueText: pubMs > 0 
                                                ? root.fmtFullTime(pubMs) + (root.currentVideoData.anchor ? " (" + root.currentVideoData.anchor + ")" : (root.currentVideoData.publicAnchor ? " (" + root.currentVideoData.publicAnchor + ")" : " (Công khai)"))
                                                : "Chưa rõ"
                                }

                                KVRow {
                                    property var pubMs: (root.currentVideoData.publicMarkMs && root.currentVideoData.publicMarkMs > 0)
                                                        ? root.currentVideoData.publicMarkMs
                                                        : ((root.currentVideoData.publicAtMs && root.currentVideoData.publicAtMs > 0) ? root.currentVideoData.publicAtMs : 0)
                                    visible: pubMs > 0 && root.currentVideoData.publishedAt > 0 && Math.abs(root.currentVideoData.publishedAt - pubMs) >= 5000
                                    keyText: "Bắt đầu tải lên (Upload)"
                                    valueText: root.fmtFullTime(root.currentVideoData.publishedAt) + " (lệch " + root.fmtDuration(Math.abs(pubMs - root.currentVideoData.publishedAt) / 1000) + ")"
                                }

                                KVRow {
                                    keyText: "App bắt được (Detected)"
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

                                                backend.send_command_async("system:openFolder", {"path": valueText})

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

                                                backend.send_command_async("system:openFolder", {"path": root.currentVideoData.renderedPath})

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

                                                    backend.send_command_async("system:openFolder", {"path": modelData.renderedPath})

                                                }

                                            }

                                        }

                                    }

                                }

                            }

                        }

                        // ─── 5. TikTok Upload detail ──────────────────

                        SectionCard {

                            sectionTitle: "TIKTOK UPLOAD"

                            visible: !!root.currentVideoData.tiktokStatus

                            Item {

                                width: parent.width

                                height: contentTikTok.height

                                ColumnLayout {

                                    id: contentTikTok

                                    width: parent.width

                                    spacing: 4

                                    // Status + badge row

                                    RowLayout {

                                        Layout.fillWidth: true

                                        spacing: 8

                                        Rectangle {

                                            Layout.preferredHeight: 18

                                            Layout.preferredWidth: ttStatusLabel.implicitWidth + 16

                                            radius: 4

                                            property color ttColor: root.currentVideoData.tiktokStatus === "uploaded" ? Theme.success

                                                : root.currentVideoData.tiktokStatus === "failed" ? Theme.error

                                                : Theme.accent

                                            color: ttColor + "20"

                                            border.color: ttColor

                                            border.width: 1

                                            Label {

                                                id: ttStatusLabel

                                                anchors.centerIn: parent

                                                text: ({

                                                    "uploaded": "✓ ĐÃ ĐĂNG",

                                                    "failed": "✗ THẤT BẠI",

                                                    "uploading": "⏳ ĐANG ĐĂNG",

                                                    "queued": "⏳ CHỜ ĐĂNG",

                                                // `|| status` để nguyên sẽ trả UNDEFINED khi

                                                // status chưa có → QML warn "Unable to assign

                                                // [undefined] to QString" (ui-qt.log máy khách

                                                // 26/07, 21 dòng). Ép về "" cho chắc.

                                                })[root.currentVideoData.tiktokStatus] || (root.currentVideoData.tiktokStatus || "")

                                                color: parent.ttColor

                                                font.pixelSize: 10

                                                font.bold: true

                                            }

                                        }

                                        Item { Layout.fillWidth: true }

                                        // Retry button when failed

                                        Rectangle {

                                            visible: root.currentVideoData.tiktokStatus === "failed"

                                            Layout.preferredHeight: 24

                                            Layout.preferredWidth: retryTtLabel.implicitWidth + 16

                                            radius: 4

                                            color: retryTtMa.containsMouse ? Theme.error + "40" : Theme.error + "20"

                                            border.color: Theme.error

                                            border.width: 1

                                            Label {

                                                id: retryTtLabel

                                                anchors.centerIn: parent

                                                text: "↻ Đăng lại"

                                                color: Theme.error

                                                font.pixelSize: 10

                                                font.bold: true

                                            }

                                            MouseArea {

                                                id: retryTtMa

                                                anchors.fill: parent

                                                hoverEnabled: true

                                                cursorShape: Qt.PointingHandCursor

                                                onClicked: {

                                                    tiktokModel.retry_upload(root.currentVideoId)

                                                    toastService.show("TikTok", "Đang kill Chrome + mở fresh để đăng lại...", "info")

                                                }

                                            }

                                        }

                                        // Retry button when uploaded (upload again)

                                        Rectangle {

                                            visible: root.currentVideoData.tiktokStatus === "uploaded"

                                            Layout.preferredHeight: 24

                                            Layout.preferredWidth: retryAgainTtLabel.implicitWidth + 16

                                            radius: 4

                                            color: retryAgainTtMa.containsMouse ? Theme.accent + "40" : Theme.accent + "20"

                                            border.color: Theme.accent

                                            border.width: 1

                                            Label {

                                                id: retryAgainTtLabel

                                                anchors.centerIn: parent

                                                text: "↻ Đăng lại"

                                                color: Theme.accent

                                                font.pixelSize: 10

                                                font.bold: true

                                            }

                                            MouseArea {

                                                id: retryAgainTtMa

                                                anchors.fill: parent

                                                hoverEnabled: true

                                                cursorShape: Qt.PointingHandCursor

                                                onClicked: {

                                                    tiktokModel.retry_upload(root.currentVideoId)

                                                    toastService.show("TikTok", "Đang kill Chrome + mở fresh để đăng lại...", "info")

                                                }

                                            }

                                        }

                                    }

                                    // Upload time

                                    KVRow {

                                        keyText: "Thời gian upload"

                                        valueText: {

                                            let ms = root.currentVideoData.tiktokUploadMs

                                            if (!ms) return "—"

                                            return root.fmtDuration(ms / 1000.0)

                                        }

                                        valueColor: root.currentVideoData.tiktokUploadMs ? Theme.accent : null

                                    }

                                    // Pass 48c: quy trách nhiệm thời gian upload —

                                    // "app" là phần HyperClip điều khiển (CDP,

                                    // nạp file, gõ caption), "TikTok" là phần

                                    // phía họ (nhận file, xử lý video, đăng).

                                    // Không có dòng này thì mọi báo cáo "đăng

                                    // chậm" đều phải mở log mới phân xử được.

                                    KVRow {

                                        visible: !!root.ttPhase("app")

                                        keyText: "Trong đó"

                                        valueText: "app " + root.ttPhase("app") + "s · TikTok " + root.ttPhase("tiktok") + "s"

                                        valueColor: parseFloat(root.ttPhase("app")) > 1.5 ? Theme.warning : Theme.textMuted

                                    }

                                    KVRow {

                                        visible: !!root.ttPhase("tiktok")

                                        keyText: "Chi tiết chặng"

                                        valueText: "nạp file " + root.ttPhase("file") + "s · TikTok nhận " + root.ttPhase("editor")

                                            + "s · caption " + root.ttPhase("caption") + "s · TikTok xử lý " + root.ttPhase("process")

                                            + "s · đăng " + root.ttPhase("confirm") + "s"

                                    }

                                    // Upload completed at

                                    KVRow {

                                        visible: !!root.currentVideoData.tiktokUploadedAt

                                        keyText: "Đăng xong lúc"

                                        valueText: root.fmtFullTime(root.currentVideoData.tiktokUploadedAt)

                                    }

                                    // Error message

                                    Rectangle {

                                        visible: !!root.currentVideoData.tiktokError

                                        Layout.fillWidth: true

                                        Layout.preferredHeight: ttErrCol.implicitHeight + 12

                                        radius: 4

                                        color: Theme.error + "15"

                                        border.color: Theme.error + "50"

                                        border.width: 1

                                        ColumnLayout {

                                            id: ttErrCol

                                            anchors.fill: parent

                                            anchors.margins: 6

                                            spacing: 2

                                            Label {

                                                text: "LỖI"

                                                color: Theme.error

                                                font.pixelSize: 10

                                                font.bold: true

                                                font.letterSpacing: 0.6

                                            }

                                            Label {

                                                text: root.currentVideoData.tiktokError || ""

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

