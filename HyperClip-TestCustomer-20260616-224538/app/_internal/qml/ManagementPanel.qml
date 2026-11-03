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
        running: root.visible
        repeat: true
        onTriggered: root.nowMs = Date.now()
    }

    // ─── Debounce Timer: detail panel RPC refresh ─────────────────────
    // Khi backend bắn 5-8 event trong 4 giây (RTX 5070 GPU render cực
    // nhanh), chỉ gọi managementGet RPC MỘT LẦN sau event cuối cùng
    // 300ms — tránh nghẽn UI do gọi đồng bộ RPC liên tục.
    Timer {
        id: detailRefreshTimer
        interval: 300
        repeat: false
        onTriggered: {
            if (root.currentVideoId) {
                const resp = backend.send_command("workspace:managementGet", {"id": root.currentVideoId});
                if (resp && resp.ok !== false && resp.result) {
                    root.currentVideoData = resp.result;
                }
            }
        }
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
    property string queueFilterMode: "all" // "all" | "done" | "active" | "high_delay" | "error"
    property string queueSearchQuery: ""

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
            if (ws.id.indexOf("-part") === -1 && (ws.status === "done" || ws.status === "rendered" || ws.renderedPath || (ws.renderedMtime && ws.renderedMtime > 0))) {
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
                let pubMs = (ws.publicMarkMs && ws.publicMarkMs > 0) ? ws.publicMarkMs : ((ws.publicAtMs && ws.publicAtMs > 0) ? ws.publicAtMs : ((ws.publishedAt && ws.publishedAt > 86400000) ? ws.publishedAt : 0));
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
                    // Instant merge: event payload từ Rust đã chứa data
                    // enriched (downloadedMtime, renderedMtime, status...)
                    // → cập nhật UI tức thì, không đợi RPC
                    let merged = Object.assign({}, root.currentVideoData, params);
                    root.currentVideoData = merged;
                    // Debounce full RPC refresh — chỉ gọi 1 lần sau 300ms
                    // thay vì mỗi event 1 lần (5-8 lần trong 4 giây)
                    detailRefreshTimer.restart();
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

            function getPublicMs(d) {
        if (!d) return 0
        if (d.publicMarkMs && d.publicMarkMs > 0) return d.publicMarkMs
        if (d.public_mark_ms && d.public_mark_ms > 0) return d.public_mark_ms
        if (d.publicAtMs && d.publicAtMs > 0) return d.publicAtMs
        if (d.public_at_ms && d.public_at_ms > 0) return d.public_at_ms
        if (d.publishedAt && d.publishedAt > 86400000) return d.publishedAt
        if (d.published_at && d.published_at > 86400000) return d.published_at
        return 0
    }

    function detectionSecForTotal(d) {
        if (!d) return 0.0
        const createdAt = d.createdAt || d.created_at || 0
        const dlStart = (d.downloadStartedAt && d.downloadStartedAt > 0) ? d.downloadStartedAt : ((d.download_started_at && d.download_started_at > 0) ? d.download_started_at : createdAt)
        const refStart = dlStart > 0 ? dlStart : createdAt
        const pubMs = getPublicMs(d)

        // Ưu tiên tính từ mốc công khai YouTube đến khi bắt đầu tải (độ trễ phát hiện thật)
        if (pubMs > 0 && refStart >= pubMs) {
            return (refStart - pubMs) / 1000.0
        }

        if (d.detectionPublicSec !== undefined && d.detectionPublicSec !== null && d.detectionPublicSec > 0)
            return d.detectionPublicSec
        if (d.detection_public_sec !== undefined && d.detection_public_sec !== null && d.detection_public_sec > 0)
            return d.detection_public_sec

        if (d.detectionBilledSec !== undefined && d.detectionBilledSec > 0) return d.detectionBilledSec
        if (d.detection_billed_sec !== undefined && d.detection_billed_sec > 0) return d.detection_billed_sec

        return d.detectionDurationSec || d.detection_duration_sec || 0.0
    }

    function e2eEndMs(d) {
        if (!d) return 0
        if (d.tiktokStatus === "uploaded" && d.tiktokUploadedAt > 0) return d.tiktokUploadedAt
        if ((d.status === "done" || d.status === "rendered") && getRenderedMtime(d) > 0) return getRenderedMtime(d)
        if (d.renderedMtime && d.renderedMtime > 0) return d.renderedMtime
        if (d.renderedAt && d.renderedAt > 0) return d.renderedAt
        return 0
    }

    function e2eTotalSec(d, renSec) {
        if (!d) return 0.0
        const createdAt = d.createdAt || d.created_at || 0
        const dlStart = (d.downloadStartedAt && d.downloadStartedAt > 0) ? d.downloadStartedAt : ((d.download_started_at && d.download_started_at > 0) ? d.download_started_at : createdAt)
        const pubMs = getPublicMs(d)
        const start = pubMs > 0 ? pubMs : (dlStart > 0 ? dlStart : createdAt)
        const end = e2eEndMs(d)
        if (start > 0 && end > start && getSplitPartsFor(d.id).length === 0)
            return (end - start) / 1000.0
        return detectionSecForTotal(d)
             + (d.downloadDurationSec || d.download_duration_sec || 0)
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

        if (s === "done" || s === "rendered" || s === "ready" || s === "detected") return "ready"

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

            "detected": "ĐÃ BẮT",

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
                color: Theme.cardBg
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
                        color: Theme.surfaceHover
                        border.color: Theme.cardBorder
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
                color: Theme.cardBg
                border.color: c2Ma.containsMouse ? Theme.cardBorderHover : Theme.cardBorder
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
                        color: Theme.surfaceHover
                        border.color: Theme.cardBorder
                        border.width: 1
                        Icon { anchors.centerIn: parent; name: "star"; size: 16; color: Theme.text }
                    }

                    ColumnLayout {
                        Layout.fillWidth: true
                        spacing: 2
                        RowLayout {
                            spacing: 8
                            Label {
                                text: root.statAvgDetectionSec > 0 ? (root.statAvgDetectionSec.toFixed(1) + "s") : "< 0.5s"
                                color: Theme.text
                                font.pixelSize: 17
                                font.bold: true
                            }
                            Rectangle {
                                radius: 4
                                color: "#10B98118"
                                border.color: "#10B98135"
                                border.width: 1
                                Layout.preferredHeight: 18
                                Layout.preferredWidth: spdLbl.implicitWidth + 10
                                Label {
                                    id: spdLbl
                                    anchors.centerIn: parent
                                    text: "Siêu tốc"
                                    color: Theme.text
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
                color: Theme.cardBg
                border.color: c3Ma.containsMouse ? Theme.cardBorderHover : Theme.cardBorder
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
                        color: Theme.surfaceHover
                        border.color: Theme.cardBorder
                        border.width: 1
                        Icon { anchors.centerIn: parent; name: "download"; size: 16; color: Theme.text }
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
                                color: "#38BDF818"
                                border.color: "#38BDF835"
                                border.width: 1
                                Layout.preferredHeight: 18
                                Layout.preferredWidth: dlPctLbl.implicitWidth + 10
                                Label {
                                    id: dlPctLbl
                                    anchors.centerIn: parent
                                    text: Math.round((root.statDownloadedCount / Math.max(1, root.statTotalCount)) * 100) + "%"
                                    color: "#38BDF8"
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
                color: Theme.cardBg
                border.color: c4Ma.containsMouse ? Theme.cardBorderHover : Theme.cardBorder
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
                        color: Theme.surfaceHover
                        border.color: Theme.cardBorder
                        border.width: 1
                        Icon { anchors.centerIn: parent; name: "render"; size: 16; color: Theme.text }
                    }

                    ColumnLayout {
                        Layout.fillWidth: true
                        spacing: 2
                        RowLayout {
                            spacing: 8
                            Label {
                                text: root.statRenderedCount + " video"
                                color: "#FFFFFF"
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

                    // ─── Search Bar ───
                    Rectangle {
                        Layout.fillWidth: true
                        Layout.preferredHeight: 28
                        radius: 4
                        color: "#161922"
                        border.color: searchInput.activeFocus ? Theme.accent : Theme.border
                        border.width: 1

                        RowLayout {
                            anchors.fill: parent
                            anchors.leftMargin: 8
                            anchors.rightMargin: 8
                            spacing: 6

                            Label {
                                text: "🔍"
                                font.pixelSize: 10
                            }

                            TextInput {
                                id: searchInput
                                Layout.fillWidth: true
                                text: root.queueSearchQuery
                                color: Theme.text
                                font.pixelSize: 11
                                clip: true
                                selectByMouse: true
                                onTextChanged: root.queueSearchQuery = text

                                Label {
                                    anchors.fill: parent
                                    visible: !parent.text && !parent.activeFocus
                                    text: "Tìm theo kênh hoặc tiêu đề..."
                                    color: Theme.textMuted
                                    font.pixelSize: 11
                                    verticalAlignment: Text.AlignVCenter
                                }
                            }

                            IconButton {
                                visible: !!root.queueSearchQuery
                                iconName: "close"
                                iconSize: 8
                                Layout.preferredHeight: 18
                                Layout.preferredWidth: 18
                                onClicked: {
                                    root.queueSearchQuery = ""
                                    searchInput.text = ""
                                }
                            }
                        }
                    }

                    // ─── Filter Pills Bar ───
                    RowLayout {
                        Layout.fillWidth: true
                        spacing: 4

                        Repeater {
                            model: [
                                { id: "all", label: "Tất cả" },
                                { id: "done", label: "Hoàn tất" },
                                { id: "active", label: "Đang chạy" },
                                { id: "high_delay", label: "Trễ >30s" },
                                { id: "error", label: "Lỗi" }
                            ]

                            Rectangle {
                                required property var modelData
                                readonly property bool isSelected: root.queueFilterMode === modelData.id
                                radius: 3
                                color: isSelected ? (Theme.accent + "30") : "#1D2230"
                                border.color: isSelected ? Theme.accent : "#2E3748"
                                border.width: 1
                                Layout.preferredHeight: 20
                                Layout.preferredWidth: pillLbl.implicitWidth + 10

                                Label {
                                    id: pillLbl
                                    anchors.centerIn: parent
                                    text: parent.modelData.label
                                    color: parent.isSelected ? Theme.accent : Theme.textMuted
                                    font.pixelSize: 9
                                    font.bold: parent.isSelected
                                }

                                MouseArea {
                                    anchors.fill: parent
                                    cursorShape: Qt.PointingHandCursor
                                    onClicked: root.queueFilterMode = parent.modelData.id
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
                                if (!ws || !ws.id || ws.id.indexOf("-part") !== -1 || ws.status === "deleted") return false;

                                if (root.queueSearchQuery) {
                                    let q = root.queueSearchQuery.toLowerCase().trim();
                                    let title = (ws.title || "").toLowerCase();
                                    let ch = (ws.channelName || ws.channelId || ws.channel_id || "").toLowerCase();
                                    let vid = (ws.video_id || ws.id || "").toLowerCase();
                                    if (title.indexOf(q) === -1 && ch.indexOf(q) === -1 && vid.indexOf(q) === -1) {
                                        return false;
                                    }
                                }

                                if (root.queueFilterMode === "done") {
                                    let isDone = (ws.status === "done" || ws.status === "rendered" || (ws.renderedPath && ws.renderedPath.length > 0));
                                    if (!isDone) return false;
                                } else if (root.queueFilterMode === "active") {
                                    let isActive = (ws.status === "downloading" || ws.status === "rendering" || ws.status === "uploading" || ws.status === "waiting");
                                    if (!isActive) return false;
                                } else if (root.queueFilterMode === "high_delay") {
                                    let pub = (ws.publicMarkMs && ws.publicMarkMs > 0) ? ws.publicMarkMs : (ws.publicAtMs || ws.publishedAt || 0);
                                    let start = (ws.downloadStartedAt && ws.downloadStartedAt > 0) ? ws.downloadStartedAt : (ws.createdAt || 0);
                                    let delaySec = (pub > 0 && start >= pub) ? (start - pub) / 1000.0 : 0;
                                    if (delaySec < 30.0) return false;
                                } else if (root.queueFilterMode === "error") {
                                    let isErr = (ws.status === "error" || ws.status === "failed" || ws.tiktokStatus === "failed");
                                    if (!isErr) return false;
                                }

                                return true;
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
                            height: (modelData && modelData.id && modelData.status !== "deleted") ? 66 : 0
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

                            // Quick Action Bar on Hover (Top-Right Floating Pill)
                            Rectangle {
                                id: cardHoverActions
                                anchors.top: parent.top
                                anchors.topMargin: 5
                                anchors.right: parent.right
                                anchors.rightMargin: 6
                                z: 20
                                height: 22
                                width: actionRow.implicitWidth + 6
                                radius: 4
                                color: "#161D2B"
                                border.color: "#2C384D"
                                border.width: 1
                                opacity: (queueMa.containsMouse || root.currentVideoId === modelData.id) ? 1.0 : 0.0
                                visible: opacity > 0
                                Behavior on opacity { NumberAnimation { duration: 150 } }

                                RowLayout {
                                    id: actionRow
                                    anchors.centerIn: parent
                                    spacing: 3

                                    // Quick Play
                                    IconButton {
                                        visible: !!modelData.renderedPath
                                        iconName: "play"
                                        iconSize: 10
                                        padding: 2
                                        minWidth: 18
                                        minHeight: 18
                                        radiusVal: 3
                                        colorIdle: "#133E3B"
                                        colorHover: "#2FD1C5"
                                        border.color: "#2FD1C566"
                                        iconColorIdle: "#2FD1C5"
                                        iconColorHover: "#0F172A"
                                        tooltipText: "Phát video đã render"
                                        onClicked: {
                                            if (modelData.renderedPath) {
                                                backend.send_command_async("system:openFile", {"path": modelData.renderedPath})
                                            }
                                        }
                                    }

                                    // Open Folder
                                    IconButton {
                                        visible: !!(modelData.renderedPath || modelData.downloadedPath)
                                        iconName: "folder"
                                        iconSize: 10
                                        padding: 2
                                        minWidth: 18
                                        minHeight: 18
                                        radiusVal: 3
                                        colorIdle: "#1E2533"
                                        colorHover: "#3B82F6"
                                        border.color: "#334155"
                                        iconColorIdle: "#E2E8F0"
                                        iconColorHover: "#FFFFFF"
                                        tooltipText: "Mở thư mục chứa"
                                        onClicked: {
                                            let p = modelData.renderedPath || modelData.downloadedPath
                                            if (p) backend.send_command_async("system:openFolder", {"path": p})
                                        }
                                    }

                                    // Open YouTube
                                    IconButton {
                                        visible: !!modelData.video_id
                                        iconName: "link"
                                        iconSize: 10
                                        padding: 2
                                        minWidth: 18
                                        minHeight: 18
                                        radiusVal: 3
                                        colorIdle: "#1E2533"
                                        colorHover: "#DC2626"
                                        border.color: "#334155"
                                        iconColorIdle: "#FCA5A5"
                                        iconColorHover: "#FFFFFF"
                                        tooltipText: "Mở YouTube"
                                        onClicked: {
                                            if (modelData.video_id) {
                                                backend.send_command_async("system:openUrl", {"url": "https://www.youtube.com/watch?v=" + modelData.video_id})
                                            }
                                        }
                                    }

                                    // Delete
                                    IconButton {
                                        iconName: "trash"
                                        iconSize: 10
                                        padding: 2
                                        minWidth: 18
                                        minHeight: 18
                                        radiusVal: 3
                                        colorIdle: "#1E2533"
                                        colorHover: "#EF4444"
                                        border.color: "#334155"
                                        iconColorIdle: "#CBD5E1"
                                        iconColorHover: "#FFFFFF"
                                        tooltipText: "Xóa video này"
                                        onClicked: {
                                            let targetId = (typeof modelData !== "undefined" && modelData) ? modelData.id : ""
                                            if (!targetId) return
                                            root.deleteWorkspace(targetId)
                                        }
                                    }
                                }
                            }

                            RowLayout {
                                z: 5
                                anchors.fill: parent
                                anchors.leftMargin: 8
                                anchors.rightMargin: 8
                                anchors.topMargin: 5
                                anchors.bottomMargin: 5
                                spacing: 8

                                // Thumbnail
                                Rectangle {
                                    Layout.preferredWidth: 76
                                    Layout.preferredHeight: 52
                                    Layout.alignment: Qt.AlignVCenter

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
                                        Layout.rightMargin: (cardHoverActions.width > 0) ? (cardHoverActions.width + 4) : 0
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
                                            font.pixelSize: 11
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

                                        // Hiển thị trạng thái của chính part này
                                        StatusDot {
                                            state: (modelData.tiktokStatus === "failed") ? "error" : root.statusToDotState(modelData.status)
                                            size: 6
                                            showRing: false
                                        }

                                        Label {
                                            text: {
                                                if (modelData.tiktokStatus === "failed") return "LỖI ĐĂNG"
                                                if (modelData.tiktokStatus === "uploading") return "ĐANG ĐĂNG"
                                                return root.statusLabel(modelData.status)
                                            }
                                            color: (modelData.tiktokStatus === "failed") ? Theme.error : Theme.textMuted
                                            font.pixelSize: 10
                                            font.bold: true
                                        }

                                        // Chip thời lượng video
                                        Rectangle {
                                            visible: (modelData.durationSec || modelData.duration || 0) > 0
                                            Layout.preferredHeight: 15
                                            Layout.preferredWidth: durChipLbl.implicitWidth + 8
                                            radius: 3
                                            color: "#1E2432"
                                            border.color: "#2C374A"
                                            border.width: 1
                                            Label {
                                                id: durChipLbl
                                                anchors.centerIn: parent
                                                text: root.fmtClockMS(modelData.durationSec || modelData.duration || 0)
                                                color: Theme.textMuted
                                                font.pixelSize: 9
                                                font.family: "Consolas"
                                            }
                                        }

                                        // Chip độ trễ phát hiện / tổng thời gian E2E
                                        Rectangle {
                                            readonly property double pub: (modelData.publicMarkMs && modelData.publicMarkMs > 0)
                                                ? modelData.publicMarkMs
                                                : ((modelData.publicAtMs && modelData.publicAtMs > 0) ? modelData.publicAtMs : ((modelData.publishedAt && modelData.publishedAt > 86400000) ? modelData.publishedAt : 0))
                                            readonly property double start: (modelData.downloadStartedAt && modelData.downloadStartedAt > 0)
                                                ? modelData.downloadStartedAt
                                                : (modelData.createdAt || 0)
                                            readonly property double latSec: (pub > 0 && start >= pub) ? (start - pub) / 1000.0 : -1
                                            readonly property double totalSec: root.e2eTotalSec(modelData, modelData.renderDurationSec || 0)
                                            readonly property bool isDone: (modelData.status === "done" || modelData.status === "rendered")

                                            visible: isDone ? (totalSec > 0) : (latSec >= 0)
                                            Layout.preferredHeight: 15
                                            Layout.preferredWidth: latChipLbl.implicitWidth + 8
                                            radius: 3

                                            property color badgeColor: {
                                                if (isDone) return Theme.accent
                                                if (latSec > 30.0) return "#FFA726"
                                                if (latSec > 10.0) return Theme.accent
                                                return Theme.success
                                            }

                                            color: badgeColor + "20"
                                            border.color: badgeColor + "70"
                                            border.width: 1

                                            Label {
                                                id: latChipLbl
                                                anchors.centerIn: parent
                                                text: {
                                                    if (parent.isDone) {
                                                        return "TỔNG: " + root.fmtDuration(parent.totalSec)
                                                    }
                                                    if (parent.latSec > 30.0) {
                                                        return "⏱️ " + root.fmtDuration(parent.latSec) + " (YT)"
                                                    }
                                                    return "⚡ " + root.fmtDuration(parent.latSec)
                                                }
                                                color: parent.badgeColor
                                                font.pixelSize: 9
                                                font.bold: true
                                            }
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

                                        Item { Layout.fillWidth: true }
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
                    id: detailScrollView
                    anchors.fill: parent
                    clip: true
                    contentWidth: availableWidth
                    ScrollBar.horizontal.policy: ScrollBar.AlwaysOff
                    visible: !root.detailLoading
                             && root.currentVideoId
                             && root.currentVideoData._error === undefined

                    ColumnLayout {
                        id: detailCol
                        width: detailScrollView.availableWidth - 24
                        x: 12; y: 12
                        spacing: Theme.spacingMd

                        // ─── 1. Header Card (Video Info) ─────────────
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

                        // ─── 2. Timeline Card (4-5 chặng trực quan, đẹp, mốc chuẩn) ──
                        ManagementTimelineCard {
                            Layout.fillWidth: true
                            width: detailCol.width
                            videoData: root.currentVideoData
                            nowMs: root.nowMs
                            isRendered: root.getIsRendered(root.currentVideoData)
                            aggregateStatus: root.getAggregateStatus(root.currentVideoData) || "ready"
                            renderStatusText: root.getRenderStatusText(root.currentVideoData) || ""
                            splitParts: root.getSplitPartsFor(root.currentVideoId)
                            e2eTotalSec: root.e2eTotalSec(root.currentVideoData, root.getRenderDurationSec(root.currentVideoData))
                            tiktokBonusSec: root.tiktokBonusSec(root.currentVideoData)
                        }

                        // ─── 3. Developer Inspector (Thông số chi tiết kỹ thuật) ──────
                        ManagementPipelineDetails {
                            Layout.fillWidth: true
                            width: detailCol.width
                            videoData: root.currentVideoData
                            aggregateStatus: root.getAggregateStatus(root.currentVideoData) || "ready"
                            aggregateProgress: root.getAggregateProgress(root.currentVideoData)
                            splitParts: root.getSplitPartsFor(root.currentVideoId)
                            onRetryTikTok: function(vid) {
                                tiktokModel.retry_upload(vid)
                                toastService.show("TikTok", "Đang kill Chrome + mở fresh để đăng lại...", "info")
                            }
                            onOpenFolder: function(path) {
                                backend.send_command_async("system:openFolder", {"path": path})
                            }
                            onOpenUrl: function(url) {
                                backend.send_command_async("system:openUrl", {"url": url})
                            }
                        }

                        // ─── 4. Error message (nếu có lỗi tổng) ───────
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
                                    text: "LỖI PIPELINE"
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
        onConfirmed: function(id, name) {
            if (id === "all") {
                backend.send_command("workspace:clear")
                root.workspaces = []
                root.clearSelection()
                root.refreshList()
                root.currentVideoId = ""
                root.currentVideoData = {}
            } else if (id === "selection") {
                let toDelete = root.selectedIds.slice()
                for (let i = 0; i < toDelete.length; i++) {
                    backend.send_command("workspace:delete", {"id": toDelete[i]})
                }
                root.clearSelection()
                root.refreshList()
            } else if (id) {
                root.deleteWorkspace(id)
            }
        }
    }

}

