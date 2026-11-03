// src/ui/qml/ManagementPanel.qml
// Quản lí — left: 24h download queue (newest first). Right: full video detail
// (YouTube config, download config, render config, timeline).
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Rectangle {
    id: root
    color: Theme.bg

    // ─── Màu từng CHẶNG timeline — NGUỒN DUY NHẤT cho thanh tỉ lệ + chữ
    //     các bước để text đồng bộ màu với đoạn thanh tương ứng ────────
    readonly property color cDetect: Theme.accent      // ① phát hiện
    readonly property color cDownload: "#7F77DD"       // ② tải (tím)
    readonly property color cRender: "#EF9F27"         // ③ render (cam)
    readonly property color cUpload: Theme.success     // ④ đăng (xanh lá)
    readonly property color cWait: "#3A3A3A"           // các chặng chờ (xám)

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
        // Render = HIỆU 2 MỐC (render xong − tải xong) để −2s ở mốc render vào
        // thẳng duration → nhất quán với timeline/TỔNG. Fallback: giá trị đo được.
        let renDone = getRenderedMtime(wsData);
        let dlDone = wsData.downloadedMtime || 0;
        if (renDone > 0 && dlDone > 0 && renDone > dlDone) {
            return (renDone - dlDone) / 1000.0;
        }
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
    // Tổng theo TỪNG CHẶNG ĐO ĐƯỢC (detection + tải + render + upload TikTok).
    // Dùng khi cần tổng "cộng dồn số đo" kể cả lúc thiếu mốc thời gian; MỌI chỗ
    // HIỂN THỊ tổng (card trái + TIMELINE + thanh tỉ lệ) đi qua getTimeline()
    // bên dưới để hai màn hình không bao giờ báo hai tổng khác nhau.
    function e2eTotalSec(d, renSec) {
        if (!d) return 0.0
        return (d.detectionDurationSec || 0)
             + (d.downloadDurationSec || 0)
             + (renSec || 0)
             + tiktokBonusSec(d)
    }

    // ─── Timeline CHUẨN — nguồn DUY NHẤT cho MỌI chỗ hiển thị thời gian ──
    // Quy tắc bất biến: mọi chặng = HIỆU 2 MỐC liên tiếp. Nhờ vậy −2s ở mốc
    // render tự làm render ngắn 2s / upload dài 2s, còn TỔNG = mốc cuối − mốc
    // đầu (createdAt) KHÔNG đổi. Card, TIMELINE, thanh tỉ lệ đều gọi hàm này để
    // không nơi nào tính lệch nhau. Latency phát hiện (published→detected) là
    // metric riêng, KHÔNG nằm trong TỔNG (đúng như e2e 14→30 = 16 khách nêu).
    function getTimeline(wsData) {
        let z = { detection: 0, prep: 0, queueWait: 0, download: 0, render: 0, uploadWait: 0, upload: 0, total: 0, finalMs: 0 };
        if (!wsData || !wsData.id) return z;
        let t0 = wsData.createdAt || 0;                       // ① phát hiện
        let dlStart = wsData.downloadStartedAt || t0;         // bắt đầu tải (sau chờ queue)
        let dlDone = wsData.downloadedMtime || 0;             // ② tải xong
        let renDone = getRenderedMtime(wsData);               // ③ render xong (đã −2s, gộp split)
        let upDone = (wsData.tiktokStatus === "uploaded" && wsData.tiktokUploadedAt > 0)
                     ? wsData.tiktokUploadedAt : 0;           // ④ đăng xong (chỉ khi đã đăng OK)

        z.detection = wsData.detectionDurationSec || 0;
        // Khoảng trống phát hiện→bắt đầu tải = chờ hàng đợi THẬT (contention, backend
        // đo qua queueWaitSec) + chuẩn bị (lên lịch pipeline/daemon/IP). Chỉ phần
        // contention mới được gọi "hàng đợi tuần tự"; phần còn lại là "prep".
        let gap0 = (dlStart > t0) ? (dlStart - t0) / 1000.0 : 0;
        z.queueWait = Math.min(wsData.queueWaitSec || 0, gap0);
        z.prep = Math.max(0, gap0 - z.queueWait);
        z.download  = (dlDone > dlStart) ? (dlDone - dlStart) / 1000.0 : (wsData.downloadDurationSec || 0);
        z.render    = (renDone > 0 && dlDone > 0 && renDone > dlDone)
                      ? (renDone - dlDone) / 1000.0 : getRenderDurationSec(wsData);
        let upMs = wsData.tiktokUploadMs || 0;      // hoisted: dùng cả ở uploadEstMs bên dưới
        if (upDone > 0 && renDone > 0) {
            let upStart = upMs > 0 ? (upDone - upMs) : renDone;
            z.uploadWait = (upStart > renDone) ? (upStart - renDone) / 1000.0 : 0;
            z.upload = upMs > 0 ? upMs / 1000.0 : (upDone - renDone) / 1000.0;
        }
        // TỔNG (e2e) = mốc cuối − mốc đầu, CỘNG thêm trễ phát hiện (28/07:
        // khách chốt "gộp hết vào tổng cho client nghiệm thu" — TỔNG nay đo
        // từ lúc video LÊN YouTube tới lúc đăng TikTok xong, không còn khoản
        // nào "ngoài TỔNG" trừ catch-up/ẩn giờ công chiếu vốn không đo được).
        // Khi TikTok đang đăng/uploading, ước tính bằng renDone + tiktokUploadMs
        // để card list hiển thị TỔNG nhất quán với TIMELINE detail ngay từ đầu.
        let uploadEstMs = (wsData.tiktokStatus && wsData.tiktokStatus !== "uploaded" && upMs > 0)
                          ? renDone + upMs : 0;
        z.finalMs = upDone > 0 ? upDone
                    : (uploadEstMs > 0 ? uploadEstMs
                    : (renDone > 0 ? renDone : (dlDone > 0 ? dlDone : t0)));
        z.total = ((z.finalMs > t0) ? (z.finalMs - t0) / 1000.0 : (z.download + z.render))
                  + z.detection;
        return z;
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
                        model: {
                            // Video cha (= part 1) trước, các part 2/3 xếp
                            // NGAY DƯỚI — trước đây part bị ẩn hoàn toàn khỏi
                            // danh sách (khách báo "part 2 không xuất hiện",
                            // 2026-07-17).
                            let parents = root.workspaces.filter(function(ws) {
                                return ws.id.indexOf("-part") === -1;
                            });
                            let out = [];
                            for (let i = 0; i < parents.length; i++) {
                                out.push(parents[i]);
                                let parts = root.getSplitPartsFor(parents[i].id);
                                for (let j = 0; j < parts.length; j++) {
                                    out.push(parts[j]);
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
                                            // TỔNG = e2e (mốc cuối − mốc phát hiện), TÍNH CHUNG 1 nơi
                                            // với TIMELINE + thanh tỉ lệ qua getTimeline() → không lệch.
                                            // Vẫn là tổng của CHÍNH hàng này (part là hàng riêng từ
                                            // pass 29) và vẫn gồm chặng TikTok — getTimeline lấy mốc
                                            // ④ tiktokUploadedAt / ước tính theo tiktokUploadMs.
                                            text: " · TỔNG: " + root.fmtDuration(root.getTimeline(modelData).total)
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

                        // ─── Timeline (Moved to top) ─────────────────
                        SectionCard {
                            sectionTitle: {
                                let tl = root.getTimeline(root.currentVideoData)
                                // TỔNG e2e = từ lúc video LÊN YouTube tới đăng TikTok xong —
                                // 28/07 khách chốt gộp CẢ trễ phát hiện vào tổng cho client
                                // nghiệm thu (trước đây trễ này đứng "ngoài TỔNG" ở bước ①).
                                // Cùng công thức với card danh sách (root.getTimeline) — khác biệt
                                // duy nhất: render ở đây là TỔNG các part.
                                let label = "TIMELINE · TỔNG e2e: " + root.fmtDuration(tl.total)
                                // Chặng upload lấy từ timeline (mốc ④, nguồn chính). Khi TikTok
                                // THẤT BẠI thì không có mốc ④ → rơi về số đo tiktokUploadMs để vẫn
                                // thấy đăng mất bao lâu trước khi hỏng (giữ hành vi bản main).
                                let upSec = tl.upload > 0 ? tl.upload : root.tiktokBonusSec(root.currentVideoData)
                                if (upSec > 0) label += "  ·  upload " + root.fmtDuration(upSec)
                                return label
                            }

                            // Thanh timeline TỈ LỆ — nhìn phát thấy thời gian đổ
                            // vào đâu (phát hiện / tải / render / đăng TikTok).
                            Item {
                                id: tlBar
                                anchors { top: parent.top; left: parent.left; right: parent.right }
                                height: 12
                                // MỘT nguồn: các chặng đều là hiệu 2 mốc, cộng lại = TỔNG.
                                property var tl: root.getTimeline(root.currentVideoData)
                                // Chờ hàng đợi hiển thị màu xám (thời gian "chết"), chặng
                                // hoạt động có màu. Cộng đúng = tl.total nên thanh lấp đủ e2e
                                // (28/07: thêm đoạn phát hiện — TỔNG nay gộp cả trễ phát hiện).
                                property real dTot: Math.max(0.001, tl.detection + tl.prep + tl.queueWait + tl.download + tl.render + tl.uploadWait + tl.upload)
                                Rectangle {
                                    anchors.fill: parent
                                    radius: height / 2
                                    color: "#0D0D0D"
                                    clip: true
                                    Row {
                                        anchors.fill: parent
                                        Rectangle { width: tlBar.width * tlBar.tl.detection  / tlBar.dTot; height: parent.height; color: root.cDetect }
                                        Rectangle { width: tlBar.width * (tlBar.tl.prep + tlBar.tl.queueWait) / tlBar.dTot; height: parent.height; color: root.cWait }
                                        Rectangle { width: tlBar.width * tlBar.tl.download   / tlBar.dTot; height: parent.height; color: root.cDownload }
                                        Rectangle { width: tlBar.width * tlBar.tl.render     / tlBar.dTot; height: parent.height; color: root.cRender }
                                        Rectangle { width: tlBar.width * tlBar.tl.uploadWait / tlBar.dTot; height: parent.height; color: root.cWait }
                                        Rectangle { width: tlBar.width * tlBar.tl.upload     / tlBar.dTot; height: parent.height; color: root.cUpload }
                                    }
                                }
                            }

                            // Chú thích màu — nối màu đoạn thanh với ý nghĩa cho dễ đọc.
                            Row {
                                id: tlLegend
                                anchors { top: tlBar.bottom; topMargin: 7; left: parent.left }
                                spacing: 12
                                Repeater {
                                    model: [
                                        { c: root.cDetect, t: "Phát hiện" },
                                        { c: root.cWait, t: "Chờ" },
                                        { c: root.cDownload, t: "Tải" },
                                        { c: root.cRender, t: "Render" },
                                        { c: root.cUpload, t: "Đăng" }
                                    ]
                                    Row {
                                        spacing: 4
                                        Rectangle {
                                            width: 9; height: 9; radius: 2
                                            color: modelData.c
                                            anchors.verticalCenter: parent.verticalCenter
                                        }
                                        Label {
                                            text: modelData.t
                                            color: Theme.textMuted
                                            font.pixelSize: Theme.textXs
                                        }
                                    }
                                }
                            }

                            RowLayout {
                                anchors { top: tlLegend.bottom; topMargin: 10; left: parent.left; right: parent.right }
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
                                            ? root.cDownload : Theme.textMuted
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
                                            ? root.cRender
                                            : (root.getAggregateStatus(root.currentVideoData) === "rendering"
                                                ? root.cRender
                                                : (root.getAggregateStatus(root.currentVideoData) === "error"
                                                    ? Theme.error
                                                    : Theme.textMuted))
                                        Layout.alignment: Qt.AlignHCenter
                                    }
                                    Rectangle {
                                        visible: !!root.currentVideoData.tiktokStatus
                                        Layout.preferredWidth: 2
                                        Layout.preferredHeight: 12
                                        Layout.alignment: Qt.AlignHCenter
                                        color: Theme.border
                                    }
                                    Rectangle {
                                        visible: !!root.currentVideoData.tiktokStatus
                                        Layout.preferredWidth: 12
                                        Layout.preferredHeight: 12
                                        radius: 6
                                        color: root.currentVideoData.tiktokStatus === "uploaded"
                                            ? root.cUpload
                                            : root.currentVideoData.tiktokStatus === "failed"
                                                ? Theme.error
                                                : root.currentVideoData.tiktokStatus === "uploading"
                                                    ? root.cUpload
                                                    : Theme.textMuted
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
                                            color: root.cDetect
                                            font.pixelSize: 12
                                            font.bold: true
                                        }
                                        Label {
                                            // Độ trễ phát hiện (công chiếu→bắt được) là metric RIÊNG,
                                            // KHÔNG nằm trong TỔNG (TỔNG tính TỪ mốc này). Phân loại
                                            // nguồn trễ theo docs/DETECTION_LATENCY.md §9 (khớp PollerPanel):
                                            //   catchup  → app đang tắt lúc đăng
                                            //   youtube  → latency > 8s khi app chạy = YouTube surface muộn
                                            //              (YouTube ghi giờ công chiếu theo PHÚT → "1 phút
                                            //               trước" = ~57s, KHÔNG phải app chậm)
                                            //   app      → độ trễ vòng lặp của app (mới đáng lo)
                                            //   ẩn       → YouTube không lộ giờ công chiếu → không rõ
                                            text: {
                                                let d = root.currentVideoData
                                                let t = root.fmtFullTime(d.createdAt)
                                                if (d.isStartupCatchup)
                                                    return t + "  ·  Khởi động ứng dụng (Catch-up) · không đo được trễ, không tính vào TỔNG"
                                                let lat = d.detectionDurationSec || 0
                                                if (lat > 8)
                                                    return t + "  ·  ~" + root.fmtDetectionDuration(lat)
                                                         + " YT — YouTube công bố muộn (ngoài tầm app, VẪN tính vào TỔNG)"
                                                if (lat > 0)
                                                    return t + "  ·  trễ phát hiện " + root.fmtDetectionDuration(lat) + " (tính vào TỔNG)"
                                                return t + "  ·  YouTube ẩn giờ công chiếu — độ trễ không rõ, không tính vào TỔNG"
                                            }
                                            color: (!root.currentVideoData.isStartupCatchup
                                                    && (root.currentVideoData.detectionDurationSec || 0) > 8)
                                                   ? "#4FC3F7" : Theme.text
                                            font.pixelSize: 11
                                            wrapMode: Text.WordWrap
                                            Layout.fillWidth: true
                                        }
                                    }

                                    // ② Download
                                    ColumnLayout {
                                        Layout.fillWidth: true
                                        spacing: 2
                                        Label {
                                            text: "② Tải về (Download)"
                                            color: root.currentVideoData.downloadedMtime
                                                ? root.cDownload : Theme.textMuted
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
                                            // Chờ KHỞI ĐỘNG tải (lên lịch pipeline/daemon/IP) — KHÔNG phải
                                            // do tải video khác. Nằm trong TỔNG.
                                            property real pr: root.getTimeline(root.currentVideoData).prep
                                            visible: pr >= 1
                                            text: "⏸ Chờ trước khi tải: " + root.fmtDuration(pr)
                                            color: Theme.textMuted
                                            font.pixelSize: 11
                                        }
                                        Label {
                                            // Chờ HÀNG ĐỢI tuần tự THẬT = video KHÁC đang tải giữ permit
                                            // (backend đo qua queueWaitSec). Nằm trong TỔNG.
                                            property real qw: root.getTimeline(root.currentVideoData).queueWait
                                            visible: qw >= 1
                                            text: "⏸ Chờ hàng đợi tải tuần tự (video khác đang tải trước): " + root.fmtDuration(qw)
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
                                                ? root.cRender
                                                : (root.getAggregateStatus(root.currentVideoData) === "rendering"
                                                    ? root.cRender
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

                                    // ④ TikTok Upload (only if channel has TikTok mapping)
                                    ColumnLayout {
                                        visible: !!root.currentVideoData.tiktokStatus
                                        Layout.fillWidth: true
                                        spacing: 2
                                        Label {
                                            text: "④ Đăng TikTok"
                                            color: root.currentVideoData.tiktokStatus === "uploaded"
                                                ? root.cUpload
                                                : root.currentVideoData.tiktokStatus === "failed"
                                                    ? Theme.error
                                                    : root.currentVideoData.tiktokStatus === "uploading"
                                                        ? root.cUpload
                                                        : Theme.textMuted
                                            font.pixelSize: 12
                                            font.bold: true
                                        }
                                        Label {
                                            text: {
                                                let s = root.currentVideoData.tiktokStatus
                                                let tt = root.currentVideoData.tiktokUploadedAt
                                                let ms = root.currentVideoData.tiktokUploadMs
                                                if (s === "uploaded") {
                                                    let t = root.fmtFullTime(tt)
                                                    let dur = ms ? "  ·  upload " + root.fmtDuration(ms / 1000.0) : ""
                                                    return t + dur
                                                }
                                                if (s === "failed") {
                                                    let e = root.currentVideoData.tiktokError
                                                    return "Lỗi: " + (e || "Không rõ nguyên nhân")
                                                }
                                                if (s === "uploading") return "Đang đăng lên TikTok..."
                                                if (s === "queued") return "Chờ đăng TikTok"
                                                return "Chưa đăng TikTok"
                                            }
                                            color: root.currentVideoData.tiktokStatus === "uploaded"
                                                ? Theme.success
                                                : root.currentVideoData.tiktokStatus === "failed"
                                                    ? Theme.error
                                                    : Theme.text
                                            font.pixelSize: 11
                                        }
                                        Label {
                                            // Chờ mở/khởi động phiên đăng (cold-start Chrome/CDP/daemon)
                                            // giữa mốc render xong và lúc đăng THẬT — NẰM TRONG TỔNG nhưng
                                            // "upload Xs" chỉ tính lúc đăng thật, nên hiện riêng để không
                                            // có giây nào "ẩn" khỏi timeline.
                                            property real uw: root.getTimeline(root.currentVideoData).uploadWait
                                            visible: uw >= 1
                                            text: "⏸ Chờ mở phiên đăng (Chrome/daemon khởi động): " + root.fmtDuration(uw)
                                            color: Theme.textMuted
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
                                            backend.send_command_async("system:openUrl", {"url": valueText})
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
                                        visible: root.getTimeline(root.currentVideoData).queueWait >= 1
                                        keyText: "Queue wait (tuần tự)"
                                        valueText: root.fmtDuration(root.getTimeline(root.currentVideoData).queueWait) + " — đã tính trong TỔNG (e2e)"
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
                                        valueText: root.fmtDuration(root.getTimeline(root.currentVideoData).render)
                                    }
                                    KVRow {
                                        keyText: "Rendered at"
                                        valueText: root.fmtFullTime(root.getRenderedMtime(root.currentVideoData))
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

