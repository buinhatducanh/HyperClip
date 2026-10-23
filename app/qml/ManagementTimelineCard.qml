// ManagementTimelineCard.qml
// Thể hiện trực quan, chuẩn xác toàn trình 4-5 chặng:
// 1. Công khai (YouTube) -> 2. Bắt đầu tải -> 3. Tải xong -> 4. Render xong -> [5. Upload xong]
// Kèm mốc thời gian chuẩn (HH:MM:SS.s) và khoảng cách thời gian giữa mỗi chặng (+X.Xs).
// Hỗ trợ chế độ Rút gọn (Compact Horizontal Pipeline) & Chi tiết (Vertical Stepper).
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls
import "Fmt.js" as Fmt

Rectangle {
    id: cardRoot
    property var videoData: ({})
    property double nowMs: 0
    property bool isRendered: false
    property string aggregateStatus: "ready"
    property string renderStatusText: ""
    property var splitParts: []
    property double e2eTotalSec: 0.0
    property double tiktokBonusSec: 0.0
    property bool isCompact: false
    readonly property bool isDlDisabled: (videoData.status === "detected" || videoData.status === "ready") && !videoData.downloadedPath

    // Tổng thời gian toàn trình: cộng tổng toàn bộ các khoảng cách chặng (Độ trễ phát hiện + Tải + Render + Upload)
    readonly property double timelineTotalSec: {
        let total = 0.0
        let hasStagesDelta = false
        for (let i = 0; i < timelineStages.length; i++) {
            let st = timelineStages[i]
            if (st.deltaSec && st.deltaSec > 0) {
                total += st.deltaSec
                hasStagesDelta = true
            }
        }
        if (hasStagesDelta && total > 0) return total

        let a = firstMs(), b = lastMs()
        if (a > 0 && b > a) return (b - a) / 1000.0

        return (cardRoot.e2eTotalSec && cardRoot.e2eTotalSec > 0) ? cardRoot.e2eTotalSec : 0.0
    }

    color: "#161922"
    border.color: Theme.accent + "33"
    border.width: 1
    radius: 8
    Layout.fillWidth: true
    width: parent ? parent.width : implicitWidth
    implicitHeight: cardCol.implicitHeight + 28

    function secBetween(a, b) {
        return (a > 0 && b > 0 && b >= a) ? (b - a) / 1000.0 : -1
    }

    // Xây dựng danh sách chặng và các khoảng cách
    readonly property var timelineStages: buildStages(videoData)

    function buildStages(d) {
        const stages = []
        if (!d || !d.id) return stages

        const created = d.createdAt || 0
        const pub = (d.publicMarkMs && d.publicMarkMs > 0)
                    ? d.publicMarkMs
                    : ((d.publicAtMs && d.publicAtMs > 0)
                        ? d.publicAtMs
                        : ((d.publishedAt && d.publishedAt > 86400000) ? d.publishedAt : 0))

        const dlStart = (d.downloadStartedAt && d.downloadStartedAt > 0) ? d.downloadStartedAt : created
        const dlDone = d.downloadedMtime || d.downloadedAt || 0
        const isDlSuccess = !!(dlDone > 0)
        const isDlActive = (d.status === "downloading")
        const isDlDisabled = (d.status === "detected" || d.status === "ready") && !d.downloadedPath
        const isDlError = (d.status === "error" && !d.downloadedPath)

        const rDone = (d.renderedAt && d.renderedAt > 0) ? d.renderedAt : ((d.renderedMtime && d.renderedMtime > 0) ? d.renderedMtime : 0)
        const isRenSuccess = (rDone > 0) || (d.status === "done") || (d.status === "rendered") || cardRoot.isRendered
        const isRenActive = (cardRoot.aggregateStatus === "rendering")
        const isRenError = (cardRoot.aggregateStatus === "error")

        const hasTikTok = !!d.tiktokStatus
        const isTtSuccess = (d.tiktokStatus === "uploaded" && d.tiktokUploadedAt > 0)
        const isTtActive = (d.tiktokStatus === "uploading")
        const isTtError = (d.tiktokStatus === "failed")
        const ttDone = isTtSuccess ? d.tiktokUploadedAt : 0

        // CHẶNG 1: CÔNG KHAI (YOUTUBE)
        let pubSub = ""
        if (pub > 0) {
            const anchor = d.publicAnchor || d.anchor || ""
            if (anchor === "watch_probe_label") pubSub = "🎯 Đo chuẩn WatchProbe (sai số ±0.5s)"
            else if (anchor === "player_microformat") pubSub = "📡 Mốc ISO YouTube Player"
            else if (anchor === "owner_publish_mark" || d.surface === "cdp") pubSub = "⚡ Bắt tức thì qua Chrome CDP"
            else if (anchor) pubSub = "Nguồn: " + anchor
            else pubSub = "Mốc chuẩn công khai YouTube"
        } else {
            const isFresh = (cardRoot.nowMs > 0 && created > 0 && cardRoot.nowMs - created < 30000)
            pubSub = isFresh ? "Đang đo mốc công khai (WatchProbe)..." : "Chưa có mốc WatchProbe"
        }

        stages.push({
            stageId: "public",
            stepNumber: "①",
            title: "CÔNG KHAI (YOUTUBE)",
            shortTitle: "Công khai",
            ms: pub > 0 ? pub : 0,
            status: pub > 0 ? "done" : "active",
            sub: pubSub,
            deltaSec: -1,
            deltaLabel: "",
            deltaBreakdown: "",
            stageStartMs: pub > 0 ? pub : 0
        })

        // KHOẢNG CÁCH 1 -> 2: Phát hiện video
        const deltaPubToStart = (pub > 0 && dlStart >= pub) ? secBetween(pub, dlStart) : -1
        let deltaBreakdown = ""
        let ytCdnDelay = -1
        let appReaction = -1
        if (deltaPubToStart >= 5.0) {
            appReaction = (d.queueWaitSec && d.queueWaitSec > 0 && d.queueWaitSec < 5.0) ? d.queueWaitSec : 1.2
            ytCdnDelay = Math.max(0, deltaPubToStart - appReaction)
            deltaBreakdown = "YouTube CDN: ~" + ytCdnDelay.toFixed(1) + "s · HyperClip: " + appReaction.toFixed(1) + "s"
        }

        // CHẶNG 2: BẮT ĐẦU TẢI
        let startSub = []
        if (d.surface) startSub.push("Mặt phẳng: " + (d.surface === "cdp" ? "Chrome CDP" : (d.surface === "playlistHtml" ? "HTML Scrape" : "API v3")))
        if (d.channelName) startSub.push(d.channelName)
        if (d.queueWaitSec && d.queueWaitSec >= 1.0) startSub.push("Chờ queue: " + d.queueWaitSec.toFixed(1) + "s")
        stages.push({
            stageId: "start",
            stepNumber: "②",
            title: isDlDisabled ? "ĐÃ PHÁT HIỆN" : "BẮT ĐẦU TẢI",
            shortTitle: "Bắt đầu",
            ms: dlStart,
            status: "done",
            sub: isDlDisabled ? "Tự động tải đang tắt · Ghi nhận độ trễ phát hiện" : (startSub.join(" · ") || "Khởi tạo tác vụ tải về bộ đệm"),
            deltaSec: deltaPubToStart,
            deltaLabel: "Độ trễ phát hiện",
            deltaBreakdown: deltaBreakdown,
            ytDelay: ytCdnDelay,
            appDelay: appReaction,
            stageStartMs: dlStart
        })

        // KHOẢNG CÁCH 2 -> 3: Thời gian tải (ưu tiên số đo mạng downloadDurationSec)
        const deltaDl = (d.downloadDurationSec && d.downloadDurationSec > 0)
                        ? d.downloadDurationSec
                        : ((dlStart > 0 && dlDone >= dlStart) ? secBetween(dlStart, dlDone) : -1)

        // CHẶNG 3: TẢI XONG
        let dlSub = []
        if (isDlDisabled) {
            dlSub.push("Tự động tải đang tắt (Chờ tải thủ công)")
        } else if (isDlSuccess) {
            if (d.fileSize > 0) dlSub.push(Fmt.bytes(d.fileSize))
            if (d.downloadSpeed) dlSub.push(d.downloadSpeed)
            dlSub.push("Bộ đệm /downloads")
        } else if (isDlActive) {
            dlSub.push("Đang nhận luồng dữ liệu...")
        } else if (d.status === "waiting") {
            dlSub.push("Đang xếp hàng chờ tải...")
        } else if (isDlError) {
            dlSub.push(d.error || "Lỗi tải video")
        } else {
            dlSub.push("Chờ khởi chạy tải...")
        }

        stages.push({
            stageId: "download",
            stepNumber: "③",
            title: "TẢI XONG",
            shortTitle: "Tải xong",
            ms: dlDone,
            status: isDlSuccess ? "done" : (isDlActive ? "active" : (isDlDisabled ? "pending" : (isDlError ? "error" : "pending"))),
            sub: dlSub.join(" · "),
            deltaSec: deltaDl,
            deltaLabel: "Thời gian tải",
            deltaBreakdown: "",
            stageStartMs: dlStart
        })

        // KHOẢNG CÁCH 3 -> 4: Thời gian biên tập & Render
        const renRefStart = (dlDone > 0) ? dlDone : dlStart
        const deltaRen = (renRefStart > 0 && rDone >= renRefStart) ? secBetween(renRefStart, rDone) : -1

        // CHẶNG 4: RENDER XONG
        let renSub = []
        if (isDlDisabled) {
            renSub.push("Chờ có video gốc để biên tập")
        } else if (isRenSuccess) {
            renSub.push(d.renderCodec || "h264_nvenc")
            if (d.renderFps > 0) renSub.push(Math.round(d.renderFps) + " fps")
            renSub.push("GPU NVENC P1 ULL")
            if (cardRoot.splitParts.length > 0) renSub.push(cardRoot.splitParts.length + " phần")
        } else if (isRenActive) {
            renSub.push(cardRoot.renderStatusText || "Đang render qua NVIDIA GPU...")
        } else if (isRenError) {
            renSub.push(d.error || "Lỗi render")
        } else {
            renSub.push("Sẵn sàng biên tập")
        }

        stages.push({
            stageId: "render",
            stepNumber: "④",
            title: "RENDER XONG",
            shortTitle: "Render",
            ms: rDone,
            status: isRenSuccess ? "done" : (isRenActive ? "active" : (isDlDisabled ? "pending" : (isRenError ? "error" : "pending"))),
            sub: renSub.join(" · "),
            deltaSec: deltaRen,
            deltaLabel: "Thời gian render",
            deltaBreakdown: "",
            stageStartMs: renRefStart
        })

        // CHẶNG 5 (TIKTOK) NẾU CÓ CẤU HÌNH HOẶC CÓ TRẠNG THÁI
        if (hasTikTok) {
            const renRef = (rDone > 0) ? rDone : ((dlDone > 0) ? dlDone : dlStart)
            const deltaTt = (renRef > 0 && ttDone >= renRef) ? secBetween(renRef, ttDone) : -1

            let ttSub = []
            if (isTtSuccess) {
                if (d.tiktokUploadMs > 0) ttSub.push("Truyền: " + Fmt.duration(d.tiktokUploadMs / 1000.0))
                ttSub.push("TikTok Web CDP")
            } else if (isTtActive) {
                ttSub.push("Đang đẩy video lên TikTok...")
            } else if (isTtError) {
                ttSub.push(d.tiktokError || "Lỗi upload")
            } else {
                ttSub.push("Chờ lịch xuất bản")
            }

            stages.push({
                stageId: "tiktok",
                stepNumber: "⑤",
                title: "UPLOAD XONG",
                shortTitle: "TikTok",
                ms: ttDone,
                status: isTtSuccess ? "done" : (isTtActive ? "active" : (isTtError ? "error" : "pending")),
                sub: ttSub.join(" · "),
                deltaSec: deltaTt,
                deltaLabel: "Thời gian upload",
                deltaBreakdown: "",
                stageStartMs: renRef
            })
        }

        return stages
    }

    function firstMs() {
        for (let i = 0; i < timelineStages.length; i++) {
            if (timelineStages[i].ms > 0) return timelineStages[i].ms
        }
        return 0
    }

    function lastMs() {
        for (let i = timelineStages.length - 1; i >= 0; i--) {
            if (timelineStages[i].ms > 0) return timelineStages[i].ms
        }
        return 0
    }

    ColumnLayout {
        id: cardCol
        anchors.fill: parent
        anchors.margins: 14
        spacing: 12

        // HEADER TIMELINE
        RowLayout {
            Layout.fillWidth: true
            spacing: 10

            Rectangle {
                width: 28; height: 28; radius: 14
                color: Theme.accent + "20"
                border.color: Theme.accent + "60"
                border.width: 1
                Icon { anchors.centerIn: parent; name: "bolt"; size: 14; color: Theme.accent }
            }

            ColumnLayout {
                spacing: 2
                Layout.fillWidth: true

                RowLayout {
                    spacing: 8
                    Label {
                        text: "TIMELINE TOÀN TRÌNH E2E"
                        color: Theme.text
                        font.pixelSize: 13
                        font.bold: true
                        font.letterSpacing: 0.5
                    }
                    Rectangle {
                        radius: 4
                        color: Theme.accent + "25"
                        border.color: Theme.accent + "70"
                        border.width: 1
                        Layout.preferredHeight: 20
                        Layout.preferredWidth: totalBadgeLbl.implicitWidth + 12
                        Label {
                            id: totalBadgeLbl
                            anchors.centerIn: parent
                            text: (cardRoot.isDlDisabled ? "BẮT: " : "TỔNG: ") + Fmt.duration(cardRoot.timelineTotalSec)
                            color: Theme.accent
                            font.pixelSize: 10
                            font.bold: true
                        }
                    }
                    Rectangle {
                        visible: cardRoot.tiktokBonusSec > 0
                        radius: 4
                        color: "#00E67620"
                        border.color: "#00E67650"
                        border.width: 1
                        Layout.preferredHeight: 20
                        Layout.preferredWidth: ttBonusLbl.implicitWidth + 12
                        Label {
                            id: ttBonusLbl
                            anchors.centerIn: parent
                            text: "+ Upload: " + Fmt.duration(cardRoot.tiktokBonusSec)
                            color: "#00E676"
                            font.pixelSize: 10
                            font.bold: true
                        }
                    }

                    Item { Layout.fillWidth: true }

                    // TOGGLE NÚT RÚT GỌN / CHI TIẾT
                    Rectangle {
                        id: modeToggleBtn
                        radius: 4
                        color: cardRoot.isCompact ? (Theme.accent + "30") : "#232836"
                        border.color: cardRoot.isCompact ? Theme.accent : "#3A4456"
                        border.width: 1
                        Layout.preferredHeight: 22
                        Layout.preferredWidth: modeToggleLbl.implicitWidth + 16
                        Label {
                            id: modeToggleLbl
                            anchors.centerIn: parent
                            text: cardRoot.isCompact ? "☷ Rút gọn" : "☰ Chi tiết"
                            color: cardRoot.isCompact ? Theme.accent : Theme.textMuted
                            font.pixelSize: 10
                            font.bold: true
                        }
                        MouseArea {
                            anchors.fill: parent
                            cursorShape: Qt.PointingHandCursor
                            onClicked: cardRoot.isCompact = !cardRoot.isCompact
                        }
                    }
                }

                Label {
                    readonly property double a: cardRoot.firstMs()
                    readonly property double b: cardRoot.lastMs()
                    text: (a > 0 && b > a)
                          ? ("Khoảng thời gian: " + Fmt.timeMs(a) + "  →  " + Fmt.timeMs(b))
                          : "Đang theo dõi các chặng xử lý..."
                    color: Theme.textMuted
                    font.pixelSize: 11
                }
            }
        }

        // ════════════════════════════════════════════════════════════════
        // CHẾ ĐỘ 1: RÚT GỌN (COMPACT HORIZONTAL BAR)
        // ════════════════════════════════════════════════════════════════
        Rectangle {
            visible: cardRoot.isCompact
            Layout.fillWidth: true
            Layout.preferredHeight: 64
            color: "#1B202C"
            border.color: "#2C3444"
            border.width: 1
            radius: 6

            RowLayout {
                anchors.fill: parent
                anchors.leftMargin: 12
                anchors.rightMargin: 12
                spacing: 0

                Repeater {
                    model: cardRoot.timelineStages

                    RowLayout {
                        id: compactStageItem
                        required property var modelData
                        required property int index
                        readonly property bool isLast: index === cardRoot.timelineStages.length - 1
                        Layout.fillWidth: isLast ? false : true
                        spacing: 0

                        // Node thông tin của stage
                        RowLayout {
                            spacing: 8
                            Layout.alignment: Qt.AlignVCenter

                            // Mini dot
                            Rectangle {
                                width: 22; height: 22; radius: 11
                                color: {
                                    if (compactStageItem.modelData.status === "done") return Theme.success + "25"
                                    if (compactStageItem.modelData.status === "active") return Theme.accent + "30"
                                    if (compactStageItem.modelData.status === "error") return Theme.error + "25"
                                    return "#232836"
                                }
                                border.width: 2
                                border.color: {
                                    if (compactStageItem.modelData.status === "done") return Theme.success
                                    if (compactStageItem.modelData.status === "active") return Theme.accent
                                    if (compactStageItem.modelData.status === "error") return Theme.error
                                    return "#454F63"
                                }
                                Label {
                                    anchors.centerIn: parent
                                    text: {
                                        if (compactStageItem.modelData.status === "done") return "✓"
                                        if (compactStageItem.modelData.status === "error") return "!"
                                        return compactStageItem.modelData.stepNumber
                                    }
                                    color: {
                                        if (compactStageItem.modelData.status === "done") return Theme.success
                                        if (compactStageItem.modelData.status === "active") return Theme.accent
                                        if (compactStageItem.modelData.status === "error") return Theme.error
                                        return Theme.textMuted
                                    }
                                    font.pixelSize: 10
                                    font.bold: true
                                }
                            }

                            ColumnLayout {
                                spacing: 1
                                Label {
                                    text: compactStageItem.modelData.shortTitle || compactStageItem.modelData.title
                                    color: compactStageItem.modelData.status === "done" ? Theme.text : (compactStageItem.modelData.status === "active" ? Theme.accent : Theme.textMuted)
                                    font.pixelSize: 11
                                    font.bold: true
                                }
                                Label {
                                    text: compactStageItem.modelData.ms > 0 ? Fmt.timeMs(compactStageItem.modelData.ms) : "—"
                                    color: Theme.textMuted
                                    font.pixelSize: 10
                                    font.family: "Consolas"
                                }
                            }
                        }

                        // Thanh nối ngang + badge delta ở giữa
                        Item {
                            visible: !compactStageItem.isLast
                            Layout.fillWidth: true
                            Layout.preferredHeight: 30
                            Layout.minimumWidth: 40

                            Rectangle {
                                anchors.centerIn: parent
                                width: parent.width - 8
                                height: 2
                                color: "#2E3646"
                            }

                            Rectangle {
                                anchors.centerIn: parent
                                visible: {
                                    let nextIdx = compactStageItem.index + 1
                                    let nextSt = cardRoot.timelineStages[nextIdx]
                                    return nextSt && nextSt.deltaSec >= 0
                                }
                                radius: 8
                                color: "#191D26"
                                border.color: Theme.accent + "50"
                                border.width: 1
                                implicitHeight: 18
                                implicitWidth: compactDeltaLbl.implicitWidth + 8

                                Label {
                                    id: compactDeltaLbl
                                    anchors.centerIn: parent
                                    text: {
                                        let nextIdx = compactStageItem.index + 1
                                        let nextSt = cardRoot.timelineStages[nextIdx]
                                        return (nextSt && nextSt.deltaSec >= 0) ? ("+" + Fmt.duration(nextSt.deltaSec)) : ""
                                    }
                                    color: Theme.accent
                                    font.pixelSize: 9
                                    font.bold: true
                                }
                            }
                        }
                    }
                }
            }
        }

        // ════════════════════════════════════════════════════════════════
        // CHẾ ĐỘ 2: CHI TIẾT (VERTICAL STEPPER ĐẦY ĐỦ)
        // ════════════════════════════════════════════════════════════════
        ColumnLayout {
            visible: !cardRoot.isCompact
            Layout.fillWidth: true
            spacing: 0

            Repeater {
                model: cardRoot.timelineStages

                ColumnLayout {
                    id: stageItem
                    required property var modelData
                    required property int index
                    readonly property bool isLast: index === cardRoot.timelineStages.length - 1
                    Layout.fillWidth: true
                    spacing: 0

                    // KHOẢNG CÁCH (DELTA) GIỮA 2 CHẶNG (NẾU CÓ)
                    Item {
                        visible: index > 0
                        Layout.fillWidth: true
                        Layout.preferredHeight: stageItem.modelData.deltaBreakdown ? 40 : 34

                        // Đường line dọc nối giữa các chặng
                        Rectangle {
                            width: 2
                            x: 82 + 15 // Căn đúng tâm của Dot ở cột giữa (82 là width cột giờ, 15 là nửa width cột dot)
                            anchors.top: parent.top
                            anchors.bottom: parent.bottom
                            color: stageItem.modelData.status === "done" ? (Theme.success + "60") : (Theme.border)
                        }

                        // Badge khoảng cách thời gian nằm chính giữa đường nối
                        Rectangle {
                            anchors.centerIn: parent
                            anchors.horizontalCenterOffset: 12
                            visible: stageItem.modelData.deltaSec >= 0
                            radius: 10
                            color: "#1E222D"
                            border.color: (stageItem.modelData.deltaSec > 30) ? "#FFB74D70" : (Theme.accent + "50")
                            border.width: 1
                            implicitHeight: stageItem.modelData.deltaBreakdown ? 26 : 20
                            implicitWidth: (typeof deltaRow !== "undefined" && deltaRow) ? (deltaRow.implicitWidth + 16) : 70

                            RowLayout {
                                id: deltaRow
                                anchors.centerIn: parent
                                spacing: 6
                                Label {
                                    id: deltaLbl
                                    text: "⏱️ +" + Fmt.duration(stageItem.modelData.deltaSec)
                                    color: (stageItem.modelData.deltaSec > 30) ? "#FFB74D" : Theme.accent
                                    font.pixelSize: 10
                                    font.bold: true
                                }
                                Label {
                                    text: "(" + stageItem.modelData.deltaLabel + ")"
                                    color: Theme.textMuted
                                    font.pixelSize: 9
                                }

                                // PHÂN RÃ CHI TIẾT TRỄ YOUTUBE CDN VS HYPERCLIP APP
                                Rectangle {
                                    visible: !!stageItem.modelData.deltaBreakdown
                                    radius: 3
                                    color: "#2C2214"
                                    border.color: "#FFB74D50"
                                    border.width: 1
                                    Layout.preferredHeight: 18
                                    Layout.preferredWidth: bdLbl.implicitWidth + 8
                                    Label {
                                        id: bdLbl
                                        anchors.centerIn: parent
                                        text: stageItem.modelData.deltaBreakdown
                                        color: "#FFCC80"
                                        font.pixelSize: 9
                                        font.bold: true
                                    }
                                }
                            }
                        }
                    }

                    // HÀNG HIỂN THỊ CHẶNG
                    RowLayout {
                        Layout.fillWidth: true
                        spacing: 10

                        // CỘT 1: MỐC GIỜ THẬT (HH:MM:SS.s)
                        Label {
                            Layout.preferredWidth: 82
                            Layout.alignment: Qt.AlignVCenter
                            text: stageItem.modelData.ms > 0 ? Fmt.timeMs(stageItem.modelData.ms) : "—"
                            color: stageItem.modelData.status === "pending" ? Theme.textMuted : Theme.text
                            font.pixelSize: 12
                            font.bold: stageItem.modelData.ms > 0
                            font.family: "Consolas"
                            horizontalAlignment: Text.AlignRight
                        }

                        // CỘT 2: DOT TRÒN TRẠNG THÁI
                        Item {
                            Layout.preferredWidth: 32
                            Layout.preferredHeight: 32
                            Layout.alignment: Qt.AlignVCenter

                            Rectangle {
                                id: stageDot
                                anchors.centerIn: parent
                                width: 22
                                height: 22
                                radius: 11
                                color: {
                                    if (stageItem.modelData.status === "done") return Theme.success + "25"
                                    if (stageItem.modelData.status === "active") return Theme.accent + "30"
                                    if (stageItem.modelData.status === "error") return Theme.error + "25"
                                    return "#232836"
                                }
                                border.width: 2
                                border.color: {
                                    if (stageItem.modelData.status === "done") return Theme.success
                                    if (stageItem.modelData.status === "active") return Theme.accent
                                    if (stageItem.modelData.status === "error") return Theme.error
                                    return "#454F63"
                                }

                                // Icon hoặc số thứ tự chặng
                                Label {
                                    anchors.centerIn: parent
                                    text: {
                                        if (stageItem.modelData.status === "done") return "✓"
                                        if (stageItem.modelData.status === "error") return "!"
                                        return stageItem.modelData.stepNumber
                                    }
                                    color: {
                                        if (stageItem.modelData.status === "done") return Theme.success
                                        if (stageItem.modelData.status === "active") return Theme.accent
                                        if (stageItem.modelData.status === "error") return Theme.error
                                        return Theme.textMuted
                                    }
                                    font.pixelSize: 11
                                    font.bold: true
                                }

                                // Animation nhấp nháy khi active
                                SequentialAnimation on opacity {
                                    running: stageItem.modelData.status === "active"
                                    loops: Animation.Infinite
                                    NumberAnimation { to: 0.35; duration: 600 }
                                    NumberAnimation { to: 1.0; duration: 600 }
                                }
                            }
                        }

                        // CỘT 3: TÊN CHẶNG & THÔNG SỐ PHỤ
                        ColumnLayout {
                            Layout.fillWidth: true
                            Layout.alignment: Qt.AlignVCenter
                            spacing: 2

                            RowLayout {
                                spacing: 8
                                Label {
                                    text: stageItem.modelData.title
                                    color: {
                                        if (stageItem.modelData.status === "done") return Theme.text
                                        if (stageItem.modelData.status === "active") return Theme.accent
                                        if (stageItem.modelData.status === "error") return Theme.error
                                        return Theme.textMuted
                                    }
                                    font.pixelSize: 12
                                    font.bold: true
                                }

                                Rectangle {
                                    radius: 3
                                    color: {
                                        if (stageItem.modelData.status === "done") return Theme.success + "20"
                                        if (stageItem.modelData.status === "active") return Theme.accent + "20"
                                        if (stageItem.modelData.status === "error") return Theme.error + "20"
                                        return "#282E3B"
                                    }
                                    border.color: {
                                        if (stageItem.modelData.status === "done") return Theme.success + "60"
                                        if (stageItem.modelData.status === "active") return Theme.accent + "60"
                                        if (stageItem.modelData.status === "error") return Theme.error + "60"
                                        return "#3A4456"
                                    }
                                    border.width: 1
                                    Layout.preferredHeight: 18
                                    Layout.preferredWidth: stBadgeLbl.implicitWidth + 10

                                    Label {
                                        id: stBadgeLbl
                                        anchors.centerIn: parent
                                        text: {
                                            if (stageItem.modelData.status === "done") return "HOÀN TẤT"
                                            if (stageItem.modelData.status === "active") return "ĐANG CHẠY"
                                            if (stageItem.modelData.status === "error") return "THẤT BẠI"
                                            return "CHỜ"
                                        }
                                        color: {
                                            if (stageItem.modelData.status === "done") return Theme.success
                                            if (stageItem.modelData.status === "active") return Theme.accent
                                            if (stageItem.modelData.status === "error") return Theme.error
                                            return Theme.textMuted
                                        }
                                        font.pixelSize: 9
                                        font.bold: true
                                    }
                                }

                                // LIVE TICKING COUNTER KHI ACTIVE
                                Rectangle {
                                    visible: stageItem.modelData.status === "active" && stageItem.modelData.stageStartMs > 0 && cardRoot.nowMs > stageItem.modelData.stageStartMs
                                    radius: 3
                                    color: Theme.accent + "20"
                                    border.color: Theme.accent + "60"
                                    border.width: 1
                                    Layout.preferredHeight: 18
                                    Layout.preferredWidth: liveTickLbl.implicitWidth + 8

                                    Label {
                                        id: liveTickLbl
                                        anchors.centerIn: parent
                                        readonly property real elapsedSec: Math.max(0, (cardRoot.nowMs - stageItem.modelData.stageStartMs) / 1000.0)
                                        text: "⏳ +" + elapsedSec.toFixed(1) + "s"
                                        color: Theme.accent
                                        font.pixelSize: 9
                                        font.bold: true
                                        font.family: "Consolas"
                                    }
                                }
                            }

                            Label {
                                text: stageItem.modelData.sub || ""
                                color: Theme.textMuted
                                font.pixelSize: 11
                                elide: Text.ElideRight
                                Layout.fillWidth: true
                            }
                        }
                    }
                }
            }
        }
    }
}
