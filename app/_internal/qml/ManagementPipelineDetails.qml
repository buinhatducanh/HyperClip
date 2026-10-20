// src/ui/qml/ManagementPipelineDetails.qml
// Card chi tiết pipeline video: Header, YouTube Gốc, Tải về, Render, TikTok Telemetry
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls
import "Fmt.js" as Fmt

ColumnLayout {
    id: detailsRoot
    property var videoData: ({})
    property string aggregateStatus: "ready"
    property real aggregateProgress: 0
    property var splitParts: []

    signal retryTikTok(string videoId)
    signal openFolder(string path)
    signal openUrl(string url)

    spacing: Theme.spacingMd
    Layout.fillWidth: true

    // ─── Detail Section Helper ───────────────────────────────────────
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
            border.color: Theme.border
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

    component DetailKVRow: RowLayout {
        id: kvRow
        property string keyText: ""
        property string valueText: ""
        property bool mono: false
        property bool multiline: false
        property bool clickable: false
        property var valueColor: null
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

    function ttPhase(key) {
        let raw = detailsRoot.videoData.tiktokPhases
        if (!raw) return ""
        let parts = String(raw).split(";")
        for (let i = 0; i < parts.length; i++) {
            let kv = parts[i].split("=")
            if (kv[0] === key) return kv[1] || ""
        }
        return ""
    }

    // ─── 1. Header card ──────────────────────────────────────────────
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
                    source: Fmt.thumbnailSource(detailsRoot.videoData.thumbnailLocal, detailsRoot.videoData.video_id)
                    fillMode: Image.PreserveAspectCrop
                    asynchronous: true
                    cache: true
                }
            }
            ColumnLayout {
                Layout.fillWidth: true
                spacing: 4
                Label {
                    text: detailsRoot.videoData.title || "(không có tiêu đề)"
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
                        state: Fmt.statusToDotState(detailsRoot.videoData.status)
                        size: 8
                        showRing: true
                    }
                    Label {
                        text: Fmt.statusLabel(detailsRoot.videoData.status)
                        color: Theme.accent
                        font.pixelSize: 12
                        font.bold: true
                    }
                }
                Label {
                    text: detailsRoot.videoData.video_id || ""
                    color: Theme.textMuted
                    font.pixelSize: 10
                    font.family: "monospace"
                }
                Label {
                    text: detailsRoot.videoData.video_id
                        ? "https://youtu.be/" + detailsRoot.videoData.video_id
                        : "—"
                    color: Theme.accent
                    font.pixelSize: 11
                    font.family: "monospace"
                }
            }
        }
    }

    // ─── 2. YouTube gốc ──────────────────────────────────────────────
    SectionCard {
        sectionTitle: "YOUTUBE GỐC"
        ColumnLayout {
            width: parent.width
            spacing: 4
            DetailKVRow {
                keyText: "Channel"
                valueText: detailsRoot.videoData.channelName
                    || detailsRoot.videoData.channelId || detailsRoot.videoData.channel_id || ""
                avatarKey: detailsRoot.videoData.channelId
                    || detailsRoot.videoData.channel_id
                    || detailsRoot.videoData.channelName || ""
            }
            DetailKVRow {
                keyText: "Channel ID"
                valueText: detailsRoot.videoData.channelId || detailsRoot.videoData.channel_id || ""
                mono: true
            }
            DetailKVRow {
                keyText: "Video ID"
                valueText: detailsRoot.videoData.video_id || ""
                mono: true
            }
            DetailKVRow {
                keyText: "URL"
                valueText: detailsRoot.videoData.video_id
                    ? "https://www.youtube.com/watch?v=" + detailsRoot.videoData.video_id
                    : ""
                mono: true
                clickable: true
                onClicked: {
                    if (valueText) {
                        detailsRoot.openUrl(valueText)
                    }
                }
            }
            DetailKVRow {
                keyText: "Published"
                valueText: Fmt.fullTime(detailsRoot.videoData.publishedAt)
            }
            DetailKVRow {
                keyText: "Detected"
                valueText: Fmt.fullTime(detailsRoot.videoData.createdAt)
            }
            DetailKVRow {
                keyText: "Duration (gốc)"
                valueText: {
                    const original = Fmt.duration(detailsRoot.videoData.originalDurationSec || detailsRoot.videoData.durationSec)
                    const speed = detailsRoot.videoData.videoSpeed || 1.0
                    const s = detailsRoot.videoData.trimStart || 0
                    const e = detailsRoot.videoData.trimEnd || (detailsRoot.videoData.durationSec || 0)
                    const hasTrim = s > 0 || (detailsRoot.videoData.trimEnd && e < (detailsRoot.videoData.durationSec || 0))
                    if (speed !== 1.0 || hasTrim) {
                        const target = (e - s) / speed
                        return original + " (Đầu ra: " + Fmt.clockMS(target) + " do x" + speed + ")"
                    }
                    return original
                }
            }
            DetailKVRow {
                keyText: "Chất lượng (gốc)"
                valueText: detailsRoot.videoData.originalQuality
                    ? detailsRoot.videoData.originalQuality + "p"
                    : "—"
            }
        }
    }

    // ─── 3. Download config ──────────────────────────────────────────
    SectionCard {
        sectionTitle: "CẤU HÌNH TẢI VỀ"
        Item {
            width: parent.width
            height: loadingDownload.visible ? loadingDownload.height : contentDownload.height

            PanelLoadingPlaceholder {
                id: loadingDownload
                visible: {
                    const s = detailsRoot.videoData.status
                    return s === "downloading" || s === "waiting" || s === "pending" || s === "new"
                }
                message: detailsRoot.videoData.status === "downloading"
                    ? "Đang tải video... " + (detailsRoot.videoData.progress ? Math.round(detailsRoot.videoData.progress) + "%" : "")
                    : "Đang chờ tải video..."
            }

            ColumnLayout {
                id: contentDownload
                width: parent.width
                spacing: 4
                visible: !loadingDownload.visible
                height: visible ? implicitHeight : 0
                clip: true
                DetailKVRow {
                    keyText: "Quality target"
                    valueText: detailsRoot.videoData.quality
                        ? detailsRoot.videoData.quality + "p" : "—"
                }
                DetailKVRow {
                    keyText: "Client priority"
                    valueText: {
                        const pri = (typeof settings !== "undefined" && settings !== null && settings.ytDlpClientPriority)
                            ? settings.ytDlpClientPriority.join(" → ")
                            : "tv_embedded → web → ios"
                        return pri
                    }
                }
                DetailKVRow {
                    keyText: "Trim range"
                    valueText: {
                        const s = detailsRoot.videoData.trimStart || 0
                        const e = detailsRoot.videoData.trimEnd || 0
                        return (s > 0 || e > 0)
                            ? Fmt.clock(s) + " → " + Fmt.clock(e)
                            : "Không cắt"
                    }
                }
                DetailKVRow {
                    keyText: "Concurrent frag."
                    valueText: "16"
                }
                DetailKVRow {
                    keyText: "File size"
                    valueText: Fmt.bytes(detailsRoot.videoData.fileSize
                        || detailsRoot.videoData.downloadedSize)
                }
                DetailKVRow {
                    keyText: "Download speed"
                    valueText: detailsRoot.videoData.downloadSpeed || "—"
                }
                DetailKVRow {
                    keyText: "Download time"
                    valueText: Fmt.duration(detailsRoot.videoData.downloadDurationSec)
                }
                DetailKVRow {
                    visible: (detailsRoot.videoData.queueWaitSec || 0) >= 1
                    keyText: "Queue wait (tuần tự)"
                    valueText: Fmt.duration(detailsRoot.videoData.queueWaitSec || 0) + " — không tính vào tổng"
                }
                // Pass 142 (khách 04/09: "bắt :52 → bắt đầu tải :54"): hàng
                // "Downloaded at" cũ là lúc tải XONG, bị đọc thành lúc bắt đầu.
                // In mốc BẮT ĐẦU TẢI (3 ms sau Detected ở mọi log) rồi mới tới
                // mốc xong, đặt tên rõ để không phải suy.
                DetailKVRow {
                    visible: (detailsRoot.videoData.downloadStartedAt || 0) > 0
                    keyText: "Bắt đầu tải"
                    valueText: {
                        const d = detailsRoot.videoData
                        const st = d.downloadStartedAt || 0
                        let s = Fmt.timeMs(st)
                        if (d.createdAt > 0)
                            s += "  (+" + Fmt.duration(Math.max(0, st - d.createdAt) / 1000) + " sau Detected)"
                        return s
                    }
                }
                DetailKVRow {
                    keyText: "Tải xong lúc"
                    valueText: Fmt.timeMs(
                        detailsRoot.videoData.downloadedMtime
                        || detailsRoot.videoData.downloadedAt)
                }
                DetailKVRow {
                    keyText: "Path"
                    valueText: detailsRoot.videoData.downloadedPath || ""
                    mono: true
                    multiline: true
                    clickable: true
                    onClicked: {
                        if (valueText) {
                            detailsRoot.openFolder(valueText)
                        }
                    }
                }
            }
        }
    }

    // ─── 4. Render config ────────────────────────────────────────────
    SectionCard {
        sectionTitle: "CẤU HÌNH RENDER"
        visible: {
            const s = detailsRoot.aggregateStatus
            return s !== "new" && s !== "waiting" && s !== "pending" && s !== "downloading"
        }
        Item {
            width: parent.width
            height: loadingRender.visible ? loadingRender.height : contentRender.height

            PanelLoadingPlaceholder {
                id: loadingRender
                visible: detailsRoot.aggregateStatus === "rendering"
                message: "Đang render video... " + Math.round(detailsRoot.aggregateProgress) + "%"
            }

            ColumnLayout {
                id: contentRender
                width: parent.width
                spacing: 4
                visible: !loadingRender.visible
                height: visible ? implicitHeight : 0
                clip: true
                DetailKVRow {
                    keyText: "Auto render"
                    valueText: detailsRoot.videoData.autoRender ? "BẬT" : "TẮT"
                }
                DetailKVRow {
                    keyText: "Speed (tăng tốc)"
                    valueText: (detailsRoot.videoData.videoSpeed || 1.0) + "×"
                }
                DetailKVRow {
                    keyText: "Thời lượng đầu ra"
                    valueText: {
                        const speed = detailsRoot.videoData.videoSpeed || 1.0
                        const dur = detailsRoot.videoData.durationSec || 0
                        const s = detailsRoot.videoData.trimStart || 0
                        const e = detailsRoot.videoData.trimEnd || dur
                        const target = (e - s) / speed
                        return Fmt.clockMS(target)
                    }
                }
                DetailKVRow {
                    keyText: "Trim start"
                    valueText: Fmt.clock(detailsRoot.videoData.trimStart || 0)
                }
                DetailKVRow {
                    keyText: "Trim end"
                    valueText: detailsRoot.videoData.trimEnd ? Fmt.clock(detailsRoot.videoData.trimEnd) : "Hết video"
                }
                DetailKVRow {
                    keyText: "FPS target"
                    valueText: {
                        const fps = detailsRoot.videoData.fpsTarget || ((typeof settings !== "undefined" && settings !== null) ? settings.autoRenderFPS : 30) || 30
                        return fps + " fps"
                    }
                }
                DetailKVRow {
                    keyText: "Export resolution"
                    valueText: detailsRoot.videoData.exportResolution || ((typeof settings !== "undefined" && settings !== null) ? settings.autoRenderResolution : "1080p") || "1080p"
                }
                DetailKVRow {
                    keyText: "Render FPS (thực tế)"
                    valueText: detailsRoot.videoData.renderFps
                        ? detailsRoot.videoData.renderFps + " fps" : "—"
                }
                DetailKVRow {
                    keyText: "Render preset"
                    valueText: detailsRoot.videoData.renderPreset || "—"
                }
                DetailKVRow {
                    keyText: "Render codec"
                    valueText: detailsRoot.videoData.renderCodec || "—"
                }
                DetailKVRow {
                    keyText: "Render workers"
                    valueText: detailsRoot.videoData.renderWorkers
                        ? "" + detailsRoot.videoData.renderWorkers : "—"
                }
                DetailKVRow {
                    keyText: "Render time"
                    valueText: Fmt.duration(detailsRoot.videoData.renderDurationSec)
                }
                DetailKVRow {
                    keyText: "Rendered at"
                    valueText: Fmt.fullTime(detailsRoot.videoData.renderedMtime)
                }
                DetailKVRow {
                    keyText: "Output path"
                    valueText: {
                        if (detailsRoot.videoData.status === "error" || detailsRoot.videoData.status === "failed") {
                            return "— (Lỗi: " + (detailsRoot.videoData.error || "Không rõ nguyên nhân") + ")"
                        }
                        return detailsRoot.videoData.renderedPath || "—"
                    }
                    valueColor: (detailsRoot.videoData.status === "error" || detailsRoot.videoData.status === "failed") ? Theme.error : Theme.text
                    mono: true
                    multiline: true
                    clickable: !!detailsRoot.videoData.renderedPath && detailsRoot.videoData.status !== "error" && detailsRoot.videoData.status !== "failed"
                    visible: detailsRoot.splitParts.length === 0
                    onClicked: {
                        if (detailsRoot.videoData.renderedPath && detailsRoot.videoData.status !== "error" && detailsRoot.videoData.status !== "failed") {
                            detailsRoot.openFolder(detailsRoot.videoData.renderedPath)
                        }
                    }
                }
                Repeater {
                    model: detailsRoot.splitParts
                    delegate: DetailKVRow {
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
                                detailsRoot.openFolder(modelData.renderedPath)
                            }
                        }
                    }
                }
            }
        }
    }

    // ─── 5. TikTok Upload detail ──────────────────────────────────────
    SectionCard {
        sectionTitle: "TIKTOK UPLOAD"
        visible: !!detailsRoot.videoData.tiktokStatus
        Item {
            width: parent.width
            height: contentTikTok.height

            ColumnLayout {
                id: contentTikTok
                width: parent.width
                spacing: 4

                RowLayout {
                    Layout.fillWidth: true
                    spacing: 8
                    Rectangle {
                        Layout.preferredHeight: 18
                        Layout.preferredWidth: ttStatusLabel.implicitWidth + 16
                        radius: 4
                        property color ttColor: detailsRoot.videoData.tiktokStatus === "uploaded" ? Theme.success
                            : detailsRoot.videoData.tiktokStatus === "failed" ? Theme.error
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
                                "queued": "⏳ CHỜ ĐĂNG"
                            })[detailsRoot.videoData.tiktokStatus] || (detailsRoot.videoData.tiktokStatus || "")
                            color: parent.ttColor
                            font.pixelSize: 10
                            font.bold: true
                        }
                    }
                    Item { Layout.fillWidth: true }
                    // Retry button when failed
                    Rectangle {
                        visible: detailsRoot.videoData.tiktokStatus === "failed"
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
                            onClicked: detailsRoot.retryTikTok(detailsRoot.videoData.id)
                        }
                    }
                    // Retry button when uploaded (upload again)
                    Rectangle {
                        visible: detailsRoot.videoData.tiktokStatus === "uploaded"
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
                            onClicked: detailsRoot.retryTikTok(detailsRoot.videoData.id)
                        }
                    }
                }

                DetailKVRow {
                    keyText: "Thời gian upload"
                    valueText: {
                        let ms = detailsRoot.videoData.tiktokUploadMs
                        if (!ms) return "—"
                        return Fmt.duration(ms / 1000.0)
                    }
                    valueColor: detailsRoot.videoData.tiktokUploadMs ? Theme.accent : null
                }

                DetailKVRow {
                    visible: !!detailsRoot.ttPhase("app")
                    keyText: "Trong đó"
                    valueText: "app " + detailsRoot.ttPhase("app") + "s · TikTok " + detailsRoot.ttPhase("tiktok") + "s"
                    valueColor: parseFloat(detailsRoot.ttPhase("app")) > 1.5 ? Theme.warning : Theme.textMuted
                }
                DetailKVRow {
                    visible: !!detailsRoot.ttPhase("tiktok")
                    keyText: "Chi tiết chặng"
                    valueText: "nạp file " + detailsRoot.ttPhase("file") + "s · TikTok nhận " + detailsRoot.ttPhase("editor")
                        + "s · caption " + detailsRoot.ttPhase("caption") + "s · TikTok xử lý " + detailsRoot.ttPhase("process")
                        + "s · đăng " + detailsRoot.ttPhase("confirm") + "s"
                }

                DetailKVRow {
                    visible: !!detailsRoot.videoData.tiktokUploadedAt
                    keyText: "Đăng xong lúc"
                    valueText: Fmt.fullTime(detailsRoot.videoData.tiktokUploadedAt)
                }

                Rectangle {
                    visible: !!detailsRoot.videoData.tiktokError
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
                            text: detailsRoot.videoData.tiktokError || ""
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

    // ─── 6. General Error message ────────────────────────────────────
    Rectangle {
        visible: !!detailsRoot.videoData.error
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
                text: detailsRoot.videoData.error || ""
                color: Theme.text
                font.pixelSize: 12
                wrapMode: Text.WordWrap
                Layout.fillWidth: true
            }
        }
    }
}
