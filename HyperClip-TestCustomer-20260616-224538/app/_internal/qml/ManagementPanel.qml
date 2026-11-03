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
import "Fmt.js" as Fmt

Rectangle {
    id: root
    color: Theme.bg

    /// main.qml nối signal này vào changeView("scancore").
    signal openScanCore()

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

    // ─── Đồng hồ đếm giây cho nhãn "X giây trước" (Pass 71) ──────────
    //
    // `Date.now()` không phải thuộc tính nên QML KHÔNG theo dõi được nó: nhãn
    // "28 giây trước" cũ chỉ nhảy số lúc danh sách được nạp lại, nên trông như
    // đứng vài giây rồi giật một nhịp. `nowMs` là thuộc tính thật, đổi mỗi giây
    // → nhãn nào đọc nó sẽ tự vẽ lại mỗi giây.
    //
    // CHỈ video mới nhất đọc nó. Danh sách 24h có thể tới hàng trăm dòng; cho
    // tất cả đếm từng giây là hàng trăm lượt tính lại binding + vẽ lại text mỗi
    // giây, trong khi các dòng cũ đang hiện "3 giờ trước" — số không đổi.
    property double nowMs: 0

    // Video mới nhất = createdAt lớn nhất. So bằng SỐ chứ không bằng index: thứ
    // tự danh sách do backend quyết, còn sự kiện realtime thì chèn đầu — hai
    // nguồn không đảm bảo cùng một quy ước sắp xếp.
    readonly property double newestCreatedAt: {
        let m = 0
        for (let i = 0; i < workspaces.length; i++) {
            const c = workspaces[i].createdAt || 0
            if (c > m) m = c
        }
        return m
    }

    Timer {
        // Tự tắt khi video mới nhất đã qua 60s: từ đó nhãn là "N phút trước",
        // đếm từng giây không làm số đổi. Cũng tắt khi trang không hiện. Nên ở
        // trạng thái bình thường (không có video mới) timer đứng im hoàn toàn.
        interval: 1000
        repeat: true
        triggeredOnStart: true
        running: root.visible && root.newestCreatedAt > 0
                 && ((root.nowMs > 0 ? root.nowMs : Date.now()) - root.newestCreatedAt) < 60000
        onTriggered: root.nowMs = Date.now()
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
    // timeline chi tiết). Trước đây card tự cộng det+dl+ren nên thiếu hẳn
    // chặng TikTok — hai màn hình cùng một video báo hai tổng khác nhau.
    // Video CATCH-UP (đăng trước khi mở app) không có chặng "phát hiện" thuộc
    // về app: lúc nó lên sóng app còn chưa chạy. Cộng tuổi video vào TỔNG e2e
    // là gán cho app một khoảng nó không thể can thiệp — log khách 13/08
    // 02:58 báo "phát hiện 3,4 phút" cho một video mà app mới sống 2,5 phút,
    // tức con số tự mâu thuẫn. Đây KHÔNG phải trừ giây cho đẹp (INVARIANT
    // #24): mọi mốc giữ nguyên, `detectionDurationSec` vẫn là giờ thật và vẫn
    // hiện ra ở dòng ①; chỗ này chỉ thôi cộng nhầm nó vào tổng của app.
    // Pass 71b: đọc `detectionBilledSec` do BACKEND tính (commands.rs, cùng chỗ
    // phân loại `detectionSource`) thay vì tự suy ở đây. Trước đó QML chỉ loại
    // hàng bù, nên video bị YouTube trễ index vẫn bị cộng 204,9s vào TỔNG e2e —
    // ảnh khách 13/08 18:44 hiện "TỔNG: 3m 30.7s" cho một lượt mà app chỉ mất
    // 5,8s (chuông kêu 09:44:41,496 → workspace 09:44:41,914 = 0,42s của app).
    function detectionSecForTotal(d) {
        if (!d) return 0.0
        // Pass 96 (operator 21/08 — "chốt đúng 1 số"): TIMELINE + TỔNG neo tại
        // "lúc video KHẢ DỤNG cho app" = cửa sổ hỏi (`detectionAppSec`, ví dụ
        // 1,7s trong ảnh 18:42). Khoảng "YouTube giữ index" (~1,8s) là của
        // YouTube — app không can thiệp được, cộng vào tổng của app là gán
        // trách nhiệm sai chỗ. Số công khai→bắt VẪN đo và VẪN hiện đầy đủ ở
        // trang Lõi quét + log [WatchProbe] (INVARIANT #24: không mốc nào bị
        // sửa/giấu — chỉ chọn thước cho timeline vận hành).
        if (d.detectionAppSec !== undefined && d.detectionAppSec !== null
            && d.detectionAppSec > 0) return d.detectionAppSec
        if (d.detectionBilledSec !== undefined) return d.detectionBilledSec || 0
        // Bản backend cũ chưa có field — giữ nguyên hành vi trước đó.
        if (d.isStartupCatchup) return 0.0
        return d.detectionDurationSec || 0
    }
    // Pass 72c (operator 14/08): dòng chú thích "YouTube khai giờ đăng ..." ở
    // cuối timeline ĐÃ GỠ — số đó dựa trên `publishedAt` YouTube tự khai, thứ
    // lùi về lúc upload chứ không phải lúc bấm Đăng, nên nó không mô tả đúng
    // việc gì cả. Chặng ① giờ là số ĐO ĐƯỢC của app (`detectionAppSec`) và nằm
    // ngay trên dòng ①. `detectionDurationSec` vẫn ra IPC cho ai cần soi.
    function e2eTotalSec(d, renSec) {
        if (!d) return 0.0
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

    // ─── Formatters: logic nằm ở Fmt.js (dùng chung toàn app) ────────
    // Giữ tên hàm cũ làm alias để các binding bên dưới không phải sửa hàng loạt;
    // thêm formatter mới → thêm vào Fmt.js rồi gọi Fmt.xxx() thẳng.
    function fmtClockMS(sec) { return Fmt.clockMS(sec) }
    function fmtAbsTime(ms) { return Fmt.absTime(ms) }
    function fmtFullTime(ms) { return Fmt.fullTime(ms) }
    /// `live` = true thì đọc `root.nowMs` (thuộc tính đổi mỗi giây) nên nhãn đếm
    /// từng giây; false thì đọc `Date.now()` — vẽ lại khi danh sách nạp lại.
    /// Chỉ video mới nhất truyền live=true (xem `nowMs` ở trên).
    function fmtTimeAgo(ms, live) { return Fmt.timeAgo(ms, live ? root.nowMs : 0) }
    function fmtDuration(sec) { return Fmt.duration(sec) }
    function fmtDetectionDuration(sec) { return Fmt.durationOr(sec, "—") }
    function fmtBytes(b) { return Fmt.bytes(b) }
    function fmtClock(sec) { return Fmt.clock(sec) }
    function statusToDotState(s) { return Fmt.statusToDotState(s) }
    function statusLabel(s) { return Fmt.statusLabel(s) }
    function getThumbnailSource(thumbnailLocal, videoId) { return Fmt.thumbnailSource(thumbnailLocal, videoId) }

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
        /// Đặt khoá kênh (id store / UC id / tên) để hàng này hiện kèm avatar.
        property string avatarKey: ""
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
        ChannelAvatarFor {
            // Chỉ hàng nào KHAI BÁO avatarKey mới có avatar — KVRow còn dùng
            // cho tiêu đề, video id, đường dẫn… ở khắp khung chi tiết.
            visible: !!kvRow.avatarKey
            channelKey: kvRow.avatarKey
            fallbackName: kvRow.valueText
            diameter: 18
            Layout.alignment: Qt.AlignVCenter
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
            // Chỉ báo nhịp quét luôn hiện ở header: sau khi bỏ Innertube, nhịp
            // thực tế phụ thuộc quota nên khách phải thấy nó ở mọi lúc.
            // Bấm vào = mở trang Lõi quét (chi tiết pool + chính sách kênh).
            Rectangle {
                visible: quota && quota.projectCount > 0
                Layout.preferredHeight: 22
                Layout.preferredWidth: hdrPace.implicitWidth + 16
                radius: 11
                color: (quota && quota.throttled ? Theme.warning : Theme.success)
                       + (hdrPaceMa.containsMouse ? "30" : "18")
                border.color: quota && quota.throttled ? Theme.warning : Theme.success
                border.width: 1
                Label {
                    id: hdrPace
                    anchors.centerIn: parent
                    text: quota ? ("nhịp " + quota.intervalStr + " · " + quota.unitsRemaining + " units") : ""
                    color: quota && quota.throttled ? Theme.warning : Theme.success
                    font.pixelSize: 10
                    font.bold: true
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
            // Chưa có project = app không quét được — phải đập vào mắt ngay tại
            // trang khách hay mở nhất, và dẫn thẳng tới chỗ cấu hình.
            Rectangle {
                visible: quota && quota.projectCount === 0
                Layout.preferredHeight: 22
                Layout.preferredWidth: hdrWarn.implicitWidth + 16
                radius: 11
                color: Theme.error + (hdrWarnMa.containsMouse ? "35" : "20")
                border.color: Theme.error
                border.width: 1
                Label {
                    id: hdrWarn
                    anchors.centerIn: parent
                    text: "CHƯA CÓ PROJECT — CẤU HÌNH LÕI QUÉT"
                    color: Theme.error
                    font.pixelSize: 10
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
                                    // Vá 18/08: CHỤP id/title trước khi mở dialog —
                                    // callback chạy SAU khi list có thể đã reassign
                                    // (event workspace:update), delegate gốc đã bị
                                    // huỷ, đọc modelData lúc đó là đọc object chết
                                    // (cùng lớp lỗi WorkspaceQueue.qml:307 trong
                                    // ui-qt.log khách 18/08 14:19:52).
                                    const wsId = modelData.id
                                    const wsTitle = modelData.title || wsId
                                    confirmDlg.openFor(wsId, wsTitle, function() {
                                        backend.send_command("workspace:delete", {"id": wsId})
                                        if (root.currentVideoId === wsId) {
                                            root.currentVideoId = ""
                                            root.currentVideoData = {}
                                        }
                                        let idx = root.selectedIds.indexOf(wsId)
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
                                    RowLayout {
                                        Layout.fillWidth: true
                                        spacing: 4
                                        // Avatar CHUẨN của kênh (cùng nguồn với Sidebar / bảng
                                        // chính sách) — hàng đợi trước đây chỉ có tên chữ, nhìn
                                        // 30 dòng không ra ngay video của kênh nào.
                                        ChannelAvatarFor {
                                            channelKey: modelData.channelId || modelData.channel_id || ""
                                            fallbackName: modelData.channelName || ""
                                            diameter: 14
                                            Layout.alignment: Qt.AlignVCenter
                                        }
                                        Label {
                                            // Pass 74 — mốc cho nhãn "X trước": createdAt (lúc bắt).
                                            //
                                            // KHÔNG dùng publishedAt: nó là mốc bắt đầu UPLOAD, sớm hơn
                                            // lúc video công khai ~3-4 phút với video dài (đo 14/08: khai
                                            // 11:16:06, bấm Đăng 11:19:29). Pass 73 từng đổi sang nó để
                                            // "khớp nhãn YouTube" và kết quả là lệch THÊM 3-4 phút.
                                            // Khi app bắt trong vài giây sau công khai, createdAt là mốc
                                            // GẦN nhãn web nhất mà app đo được không cần ping WebSub.
                                            text: (modelData.channelName || modelData.channelId || modelData.channel_id || "—")
                                                + " · " + root.fmtTimeAgo(modelData.createdAt,
                                                                          modelData.createdAt === root.newestCreatedAt)
                                                + root.getPartsSummary(modelData.id)
                                            color: Theme.textMuted
                                            font.pixelSize: 10
                                            elide: Text.ElideRight
                                            Layout.fillWidth: true
                                            maximumLineCount: 1
                                        }
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

                        // ─── Timeline (Moved to top) ─────────────────
                        SectionCard {
                            sectionTitle: {
                                // Cùng công thức với card danh sách (root.e2eTotalSec)
                                // — khác biệt duy nhất: render ở đây là TỔNG các part.
                                let ren = root.getRenderDurationSec(root.currentVideoData)
                                let total = root.e2eTotalSec(root.currentVideoData, ren)
                                let ttSec = root.tiktokBonusSec(root.currentVideoData)
                                let label = "TIMELINE (TỔNG: " + root.fmtDuration(total) + ")"
                                // Tiêu đề chỉ mang SỐ (yêu cầu operator 14/08 —
                                // chữ giải thích chen ngang gây rối mắt). Phần
                                // "khoảng không thuộc app" xuống dòng chú thích
                                // mờ cuối timeline: số thật vẫn hiện đủ, đúng
                                // INVARIANT #24 (cấm giấu, không cấm xếp lại chỗ).
                                if (ttSec > 0) label += "  ·  upload " + root.fmtDuration(ttSec)
                                return label
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
                                            ? Theme.success
                                            : root.currentVideoData.tiktokStatus === "failed"
                                                ? Theme.error
                                                : root.currentVideoData.tiktokStatus === "uploading"
                                                    ? Theme.accent
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
                                            color: Theme.accent
                                            font.pixelSize: 12
                                            font.bold: true
                                        }
                                        Label {
                                            // Dòng SỐ thuần: giờ bắt + phần app thật sự tốn.
                                            // Mọi diễn giải (con dấu publishedAt lùi, hàng bù)
                                            // nằm ở dòng chú thích mờ cuối timeline.
                                            //
                                            // Pass 72b: `billed` giờ LUÔN có khi đo được cửa sổ
                                            // hỏi (kể cả lượt bị YouTube giữ index) — trước đó
                                            // nó về 0 nên dòng ① trống và TỔNG thiếu hẳn chặng ①.
                                            text: {
                                                const d = root.currentVideoData
                                                const t = root.fmtFullTime(d.createdAt)
                                                // Pass 96 (operator 21/08): MỘT SỐ DUY NHẤT =
                                                // cửa sổ hỏi của app (lúc video khả dụng → bắt).
                                                // Bản cũ phô 3 số ("3.5s từ công khai (app ≤1.7
                                                // · YouTube giữ index ~1.8)") — rối. Số công
                                                // khai→bắt vẫn nằm ở trang Lõi quét + log.
                                                const appSec = d.detectionAppSec
                                                if (appSec !== undefined && appSec !== null && appSec > 0)
                                                    return t + "  ·  mất " + root.fmtDetectionDuration(appSec)
                                                const billed = root.detectionSecForTotal(d)
                                                // Chưa đo được cửa sổ hỏi và video vừa bắt
                                                // (nhân chứng đang đo ≤ ~25s) → ghi rõ số TẠM.
                                                const pending = (root.nowMs > 0 && d.createdAt > 0
                                                                 && root.nowMs - d.createdAt < 26000
                                                                 && !d.isStartupCatchup && d.detectionSource !== "catchup")
                                                if (billed > 0)
                                                    return t + "  ·  mất " + root.fmtDetectionDuration(billed)
                                                         + (pending ? " (đang đo…)" : "")
                                                // Pass 72c: KHÔNG để dòng này trống. Trống thì
                                                // TỔNG thiếu một chặng mà không ai biết vì sao —
                                                // nói thẳng là chưa đo được và vì sao.
                                                if (d.isStartupCatchup || d.detectionSource === "catchup")
                                                    return t + "  ·  hàng bù, không có chặng phát hiện"
                                                if (d.detectionDurationSec > 0 || d.publishedAt)
                                                    return t + "  ·  chưa đo được (video bắt trước bản vá)"
                                                return t + "  ·  Thời gian công chiếu ẩn"
                                            }
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

                                    // ④ TikTok Upload (only if channel has TikTok mapping)
                                    ColumnLayout {
                                        visible: !!root.currentVideoData.tiktokStatus
                                        Layout.fillWidth: true
                                        spacing: 2
                                        Label {
                                            text: "④ Đăng TikTok"
                                            color: root.currentVideoData.tiktokStatus === "uploaded"
                                                ? Theme.success
                                                : root.currentVideoData.tiktokStatus === "failed"
                                                    ? Theme.error
                                                    : root.currentVideoData.tiktokStatus === "uploading"
                                                        ? Theme.accent
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
                                    avatarKey: root.currentVideoData.channelId
                                        || root.currentVideoData.channel_id
                                        || root.currentVideoData.channelName || ""
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

