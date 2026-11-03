// ManagementPipelineDetails.qml
// Card thông số kỹ thuật chi tiết dành cho Developer / Operator:
// 1. Tệp video đầu ra (Output Hero Card - Phát nhanh, Copy đường dẫn, Mở thư mục)
// 2. Phát hiện & Mốc thời gian (WatchProbe / Metadata)
// 3. Cấu hình & Tải về (Download specs)
// 4. Render & GPU NVENC (Render specs)
// 5. Xuất bản TikTok (Distribution telemetry)
// 6. Thao tác nhanh cho Dev
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
    width: parent ? parent.width : implicitWidth

    function openFileSafe(path) {
        if (!path) return
        backend.send_command_async("system:openFile", {"path": path})
    }

    function copyToClipboardSafe(text) {
        if (!text) return
        backend.send_command_async("system:copyToClipboard", {"text": text})
        if (typeof toastService !== "undefined" && toastService) {
            toastService.show("Sao chép", "Đã sao chép đường dẫn vào bộ nhớ tạm", "success")
        }
    }

    // ─── Detail Section Helper ───────────────────────────────────────
    component SectionCard: Rectangle {
        property string sectionTitle: ""
        default property alias bodyData: bodyHolder.data
        color: Theme.cardBg
        border.color: Theme.border
        border.width: 1
        radius: Theme.radiusLg
        Layout.fillWidth: true
        width: detailsRoot.width
        implicitHeight: cardCol.implicitHeight + 24
        ColumnLayout {
            id: cardCol
            anchors.fill: parent
            anchors.margins: 12
            spacing: 8
            Label {
                text: sectionTitle
                color: Theme.text
                font.pixelSize: 11
                font.bold: true
                font.letterSpacing: 0.6
            }
            Item {
                id: bodyHolder
                Layout.fillWidth: true
                width: cardCol.width
                implicitHeight: bodyHolder.childrenRect.height
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
            Layout.preferredWidth: 140
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
            color: kvRow.valueColor !== null && kvRow.valueColor !== undefined ? kvRow.valueColor : Theme.text
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

    // ════════════════════════════════════════════════════════════════
    // 1. OUTPUT HERO CARD (TỆP XUẤT BẢN ĐẦU RA CHÍNH)
    // ════════════════════════════════════════════════════════════════
    Rectangle {
        id: heroCard
        Layout.fillWidth: true
        color: "#181D29"
        border.color: (detailsRoot.videoData.renderedPath || detailsRoot.splitParts.length > 0) ? (Theme.success + "50") : (Theme.accent + "40")
        border.width: 1
        radius: 8
        implicitHeight: heroCol.implicitHeight + 24

        ColumnLayout {
            id: heroCol
            anchors.fill: parent
            anchors.margins: 14
            spacing: 12

            // Tiêu đề Hero + Trạng thái
            RowLayout {
                Layout.fillWidth: true
                spacing: 8

                Rectangle {
                    width: 26; height: 26; radius: 13
                    color: (detailsRoot.videoData.renderedPath || detailsRoot.splitParts.length > 0) ? (Theme.success + "20") : (Theme.accent + "20")
                    border.color: (detailsRoot.videoData.renderedPath || detailsRoot.splitParts.length > 0) ? Theme.success : Theme.accent
                    border.width: 1
                    Icon {
                        anchors.centerIn: parent
                        name: "film"
                        size: 13
                        color: (detailsRoot.videoData.renderedPath || detailsRoot.splitParts.length > 0) ? Theme.success : Theme.accent
                    }
                }

                Label {
                    text: "TỆP VIDEO ĐẦU RA (RENDERED OUTPUT)"
                    color: Theme.text
                    font.pixelSize: 12
                    font.bold: true
                    font.letterSpacing: 0.5
                }

                Item { Layout.fillWidth: true }

                Rectangle {
                    radius: 4
                    color: (detailsRoot.videoData.renderedPath || detailsRoot.splitParts.length > 0) ? (Theme.success + "25") : (Theme.accent + "25")
                    border.color: (detailsRoot.videoData.renderedPath || detailsRoot.splitParts.length > 0) ? Theme.success : Theme.accent
                    border.width: 1
                    Layout.preferredHeight: 22
                    Layout.preferredWidth: heroBadgeLbl.implicitWidth + 14

                    Label {
                        id: heroBadgeLbl
                        anchors.centerIn: parent
                        text: {
                            if (detailsRoot.videoData.renderedPath || detailsRoot.splitParts.length > 0) return "✓ SẴN SÀNG"
                            if (detailsRoot.aggregateStatus === "rendering") return "⚡ ĐANG RENDER"
                            if (detailsRoot.videoData.status === "downloading") return "⬇ ĐANG TẢI"
                            if (detailsRoot.videoData.status === "error" || detailsRoot.videoData.status === "failed") return "✕ THẤT BẠI"
                            return "⏳ CHỜ BIÊN TẬP"
                        }
                        color: (detailsRoot.videoData.renderedPath || detailsRoot.splitParts.length > 0) ? Theme.success : Theme.accent
                        font.pixelSize: 10
                        font.bold: true
                    }
                }
            }

            // Đường dẫn tệp chính (Single video hoặc Part 1)
            Rectangle {
                Layout.fillWidth: true
                Layout.preferredHeight: 36
                color: "#11141C"
                border.color: "#2C3446"
                border.width: 1
                radius: 4

                RowLayout {
                    anchors.fill: parent
                    anchors.leftMargin: 10
                    anchors.rightMargin: 6
                    spacing: 8

                    Label {
                        Layout.fillWidth: true
                        text: {
                            if (detailsRoot.videoData.renderedPath) return detailsRoot.videoData.renderedPath
                            if (detailsRoot.splitParts.length > 0 && detailsRoot.splitParts[0].renderedPath) return detailsRoot.splitParts[0].renderedPath
                            if (detailsRoot.videoData.downloadedPath) return "[Đệm tải] " + detailsRoot.videoData.downloadedPath
                            return "Chưa có tệp video đầu ra..."
                        }
                        color: (detailsRoot.videoData.renderedPath || detailsRoot.splitParts.length > 0) ? Theme.text : Theme.textMuted
                        font.pixelSize: 11
                        font.family: "Consolas"
                        elide: Text.ElideMiddle
                    }

                    // Nút Copy Path nhanh
                    Rectangle {
                        visible: !!(detailsRoot.videoData.renderedPath || detailsRoot.videoData.downloadedPath || (detailsRoot.splitParts.length > 0 && detailsRoot.splitParts[0].renderedPath))
                        radius: 3
                        color: "#222838"
                        border.color: "#3A455A"
                        border.width: 1
                        Layout.preferredHeight: 24
                        Layout.preferredWidth: heroCopyLbl.implicitWidth + 12
                        Label {
                            id: heroCopyLbl
                            anchors.centerIn: parent
                            text: "📋 Chép path"
                            color: Theme.text
                            font.pixelSize: 10
                        }
                        MouseArea {
                            anchors.fill: parent
                            cursorShape: Qt.PointingHandCursor
                            onClicked: {
                                let p = detailsRoot.videoData.renderedPath || (detailsRoot.splitParts.length > 0 ? detailsRoot.splitParts[0].renderedPath : detailsRoot.videoData.downloadedPath)
                                detailsRoot.copyToClipboardSafe(p)
                            }
                        }
                    }
                }
            }

            // Thanh hành động nhanh (Play Video, Open Folder, Copy Path)
            RowLayout {
                Layout.fillWidth: true
                spacing: 8

                // Nút Phát Video
                Rectangle {
                    visible: !!(detailsRoot.videoData.renderedPath || (detailsRoot.splitParts.length > 0 && detailsRoot.splitParts[0].renderedPath))
                    radius: 4
                    color: Theme.accent
                    Layout.preferredHeight: 28
                    Layout.preferredWidth: playLbl.implicitWidth + 24

                    RowLayout {
                        anchors.centerIn: parent
                        spacing: 4
                        Label {
                            text: "▶"
                            color: "#FFFFFF"
                            font.pixelSize: 11
                            font.bold: true
                        }
                        Label {
                            id: playLbl
                            text: "Phát video"
                            color: "#FFFFFF"
                            font.pixelSize: 11
                            font.bold: true
                        }
                    }
                    MouseArea {
                        anchors.fill: parent
                        cursorShape: Qt.PointingHandCursor
                        onClicked: {
                            let p = detailsRoot.videoData.renderedPath || (detailsRoot.splitParts.length > 0 ? detailsRoot.splitParts[0].renderedPath : "")
                            detailsRoot.openFileSafe(p)
                        }
                    }
                }

                // Nút Mở Thư Mục Chứa
                Rectangle {
                    visible: !!(detailsRoot.videoData.renderedPath || detailsRoot.videoData.downloadedPath || (detailsRoot.splitParts.length > 0 && detailsRoot.splitParts[0].renderedPath))
                    radius: 4
                    color: "#252B3A"
                    border.color: "#3D485C"
                    border.width: 1
                    Layout.preferredHeight: 28
                    Layout.preferredWidth: folderLbl.implicitWidth + 20

                    RowLayout {
                        anchors.centerIn: parent
                        spacing: 6
                        Label {
                            text: "📁"
                            font.pixelSize: 11
                        }
                        Label {
                            id: folderLbl
                            text: "Mở thư mục"
                            color: Theme.text
                            font.pixelSize: 11
                            font.bold: true
                        }
                    }
                    MouseArea {
                        anchors.fill: parent
                        cursorShape: Qt.PointingHandCursor
                        onClicked: {
                            let p = detailsRoot.videoData.renderedPath || (detailsRoot.splitParts.length > 0 ? detailsRoot.splitParts[0].renderedPath : detailsRoot.videoData.downloadedPath)
                            detailsRoot.openFolder(p)
                        }
                    }
                }

                // Nút Xem trên YouTube
                Rectangle {
                    visible: !!detailsRoot.videoData.video_id
                    radius: 4
                    color: "#252B3A"
                    border.color: "#3D485C"
                    border.width: 1
                    Layout.preferredHeight: 28
                    Layout.preferredWidth: ytLinkLbl.implicitWidth + 20

                    RowLayout {
                        anchors.centerIn: parent
                        spacing: 6
                        Label {
                            text: "🔗"
                            font.pixelSize: 11
                        }
                        Label {
                            id: ytLinkLbl
                            text: "YouTube"
                            color: Theme.text
                            font.pixelSize: 11
                        }
                    }
                    MouseArea {
                        anchors.fill: parent
                        cursorShape: Qt.PointingHandCursor
                        onClicked: {
                            if (detailsRoot.videoData.video_id) {
                                detailsRoot.openUrl("https://www.youtube.com/watch?v=" + detailsRoot.videoData.video_id)
                            }
                        }
                    }
                }

                Item { Layout.fillWidth: true }
            }

            // Danh sách các phần tách (Nếu có split parts P1, P2...)
            ColumnLayout {
                visible: detailsRoot.splitParts.length > 1
                Layout.fillWidth: true
                spacing: 6

                Label {
                    text: "CÁC PHẦN ĐÃ TÁCH (" + detailsRoot.splitParts.length + " PHẦN):"
                    color: Theme.textMuted
                    font.pixelSize: 10
                    font.bold: true
                }

                Repeater {
                    model: detailsRoot.splitParts

                    Rectangle {
                        required property var modelData
                        required property int index
                        Layout.fillWidth: true
                        Layout.preferredHeight: 32
                        color: "#1E2432"
                        border.color: "#2F394C"
                        border.width: 1
                        radius: 4

                        RowLayout {
                            anchors.fill: parent
                            anchors.leftMargin: 10
                            anchors.rightMargin: 8
                            spacing: 8

                            Label {
                                text: "Phần " + (index + 1)
                                color: Theme.accent
                                font.pixelSize: 11
                                font.bold: true
                            }

                            Label {
                                Layout.fillWidth: true
                                text: modelData.renderedPath || "— (đang render...)"
                                color: modelData.renderedPath ? Theme.text : Theme.textMuted
                                font.pixelSize: 10
                                font.family: "Consolas"
                                elide: Text.ElideMiddle
                            }

                            // Phát phần này
                            Rectangle {
                                visible: !!modelData.renderedPath
                                radius: 3
                                color: Theme.accent + "30"
                                border.color: Theme.accent
                                border.width: 1
                                Layout.preferredHeight: 22
                                Layout.preferredWidth: partPlayLbl.implicitWidth + 10
                                Label {
                                    id: partPlayLbl
                                    anchors.centerIn: parent
                                    text: "▶ Phát"
                                    color: Theme.accent
                                    font.pixelSize: 9
                                    font.bold: true
                                }
                                MouseArea {
                                    anchors.fill: parent
                                    cursorShape: Qt.PointingHandCursor
                                    onClicked: detailsRoot.openFileSafe(modelData.renderedPath)
                                }
                            }

                            // Mở thư mục phần này
                            Rectangle {
                                visible: !!modelData.renderedPath
                                radius: 3
                                color: "#2A3244"
                                border.color: "#3D485C"
                                border.width: 1
                                Layout.preferredHeight: 22
                                Layout.preferredWidth: partFolderLbl.implicitWidth + 10
                                Label {
                                    id: partFolderLbl
                                    anchors.centerIn: parent
                                    text: "📁"
                                    font.pixelSize: 9
                                }
                                MouseArea {
                                    anchors.fill: parent
                                    cursorShape: Qt.PointingHandCursor
                                    onClicked: detailsRoot.openFolder(modelData.renderedPath)
                                }
                            }
                        }
                    }
                }
            }

            // Dải micro-chips thông số kỹ thuật đầu ra
            RowLayout {
                Layout.fillWidth: true
                spacing: 6

                Rectangle {
                    radius: 3
                    color: "#222838"
                    border.color: "#353F54"
                    border.width: 1
                    Layout.preferredHeight: 20
                    Layout.preferredWidth: chipCodecLbl.implicitWidth + 12
                    Label {
                        id: chipCodecLbl
                        anchors.centerIn: parent
                        text: (detailsRoot.videoData.renderCodec || "h264_nvenc") + " · GPU NVENC P1"
                        color: Theme.textMuted
                        font.pixelSize: 9
                        font.bold: true
                    }
                }

                Rectangle {
                    visible: detailsRoot.videoData.renderFps > 0
                    radius: 3
                    color: "#222838"
                    border.color: "#353F54"
                    border.width: 1
                    Layout.preferredHeight: 20
                    Layout.preferredWidth: chipFpsLbl.implicitWidth + 12
                    Label {
                        id: chipFpsLbl
                        anchors.centerIn: parent
                        text: "Tốc độ: " + Math.round(detailsRoot.videoData.renderFps || 0) + " fps"
                        color: Theme.textMuted
                        font.pixelSize: 9
                    }
                }

                Rectangle {
                    visible: detailsRoot.videoData.renderDurationSec > 0
                    radius: 3
                    color: "#222838"
                    border.color: "#353F54"
                    border.width: 1
                    Layout.preferredHeight: 20
                    Layout.preferredWidth: chipDurLbl.implicitWidth + 12
                    Label {
                        id: chipDurLbl
                        anchors.centerIn: parent
                        text: "Thời gian render: " + Fmt.duration(detailsRoot.videoData.renderDurationSec)
                        color: Theme.textMuted
                        font.pixelSize: 9
                    }
                }

                Item { Layout.fillWidth: true }
            }
        }
    }

    // ─── Header Tiêu Đề Khu Vực Kỹ Thuật (Dev Inspector) ────────────
    RowLayout {
        Layout.fillWidth: true
        Layout.topMargin: 4
        spacing: 8
        Rectangle {
            width: 3; height: 14; radius: 2; color: Theme.accent
        }
        Label {
            text: "THÔNG SỐ KỸ THUẬT TOÀN TRÌNH (DEVELOPER INSPECTOR)"
            color: Theme.text
            font.pixelSize: 11
            font.bold: true
            font.letterSpacing: 0.8
        }
    }

    // ─── 2. PHÁT HIỆN & THỜI ĐIỂM (WATCHPROBE & METADATA) ─────────────
    SectionCard {
        sectionTitle: "2. PHÁT HIỆN & THỜI ĐIỂM (WATCHPROBE / METADATA)"
        ColumnLayout {
            id: metadataCol
            width: parent.width
            spacing: 5

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
                valueText: detailsRoot.videoData.video_id || detailsRoot.videoData.id || ""
                mono: true
                clickable: !!(detailsRoot.videoData.video_id || detailsRoot.videoData.id)
                onClicked: {
                    let vid = detailsRoot.videoData.video_id || detailsRoot.videoData.id
                    if (vid) detailsRoot.openUrl("https://www.youtube.com/watch?v=" + vid)
                }
            }

            readonly property double pubMs: (detailsRoot.videoData && detailsRoot.videoData.publicMarkMs && detailsRoot.videoData.publicMarkMs > 0)
                ? detailsRoot.videoData.publicMarkMs
                : ((detailsRoot.videoData && detailsRoot.videoData.publicAtMs && detailsRoot.videoData.publicAtMs > 0)
                    ? detailsRoot.videoData.publicAtMs
                    : ((detailsRoot.videoData && detailsRoot.videoData.publishedAt && detailsRoot.videoData.publishedAt > 86400000) ? detailsRoot.videoData.publishedAt : 0))

            DetailKVRow {
                keyText: "Mốc công khai YouTube"
                valueText: metadataCol.pubMs > 0 ? (Fmt.timeMs(metadataCol.pubMs) + " · " + Fmt.fullTime(metadataCol.pubMs)) : "Chưa có mốc"
            }

            DetailKVRow {
                visible: metadataCol.pubMs > 0 && detailsRoot.videoData && detailsRoot.videoData.publishedAt > 0 && Math.abs(detailsRoot.videoData.publishedAt - metadataCol.pubMs) >= 5000
                keyText: "Mốc tải lên (Studio)"
                valueText: Fmt.fullTime(detailsRoot.videoData.publishedAt) + " (lệch " + Fmt.duration(Math.abs(metadataCol.pubMs - detailsRoot.videoData.publishedAt) / 1000) + ")"
            }

            DetailKVRow {
                keyText: "App bắt được (Detected)"
                valueText: Fmt.timeMs(detailsRoot.videoData.createdAt) + " · " + Fmt.fullTime(detailsRoot.videoData.createdAt)
            }

            DetailKVRow {
                keyText: "Mặt phẳng phát hiện"
                valueText: {
                    const s = detailsRoot.videoData.surface || ""
                    if (s === "cdp") return "Chrome CDP Active Tab (Quét DOM tức thì)"
                    if (s === "playlistHtml") return "HTML Scrape (Dual-Race WebSub/Poller)"
                    return "YouTube Data API v3 (Poll vòng)"
                }
                valueColor: (detailsRoot.videoData.surface === "cdp" || detailsRoot.videoData.surface === "playlistHtml") ? "#B388FF" : Theme.text
            }

            DetailKVRow {
                keyText: "Thời lượng video"
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
        }
    }

    // ─── 3. THÔNG SỐ TẢI VỀ (DOWNLOAD ENGINE SPECS) ──────────────────
    SectionCard {
        sectionTitle: "3. TẢI VỀ & BỘ ĐỆM (DOWNLOAD ENGINE SPECS)"
        ColumnLayout {
            width: parent.width
            spacing: 5

            DetailKVRow {
                keyText: "Engine tải về"
                valueText: detailsRoot.videoData.downloadPath || "yt-dlp native"
            }
            DetailKVRow {
                keyText: "Chất lượng target"
                valueText: detailsRoot.videoData.quality ? (detailsRoot.videoData.quality + "p") : "Gốc (Best)"
            }
            DetailKVRow {
                keyText: "Trim range"
                valueText: {
                    const s = detailsRoot.videoData.trimStart || 0
                    const e = detailsRoot.videoData.trimEnd || 0
                    return (s > 0 || e > 0) ? (Fmt.clock(s) + " → " + Fmt.clock(e)) : "Không cắt"
                }
            }
            DetailKVRow {
                keyText: "Dung lượng tải về"
                valueText: Fmt.bytes(detailsRoot.videoData.fileSize || detailsRoot.videoData.downloadedSize)
            }
            DetailKVRow {
                keyText: "Tốc độ tải downlink"
                valueText: detailsRoot.videoData.downloadSpeed || "—"
            }
            DetailKVRow {
                keyText: "Thời gian tải"
                valueText: Fmt.duration(detailsRoot.videoData.downloadDurationSec)
            }
            DetailKVRow {
                visible: (detailsRoot.videoData.queueWaitSec || 0) >= 1
                keyText: "Chờ hàng đợi"
                valueText: Fmt.duration(detailsRoot.videoData.queueWaitSec || 0) + " (không tính vào E2E)"
            }
            DetailKVRow {
                keyText: "Mốc tải xong"
                valueText: Fmt.timeMs(detailsRoot.videoData.downloadedMtime || detailsRoot.videoData.downloadedAt)
            }
            DetailKVRow {
                keyText: "Đường dẫn đệm tải"
                valueText: detailsRoot.videoData.downloadedPath || ""
                mono: true
                multiline: true
                clickable: !!detailsRoot.videoData.downloadedPath
                onClicked: {
                    if (valueText) detailsRoot.openFolder(valueText)
                }
            }
        }
    }

    // ─── 4. THÔNG SỐ RENDER & GPU (RENDER SPECS) ─────────────────────
    SectionCard {
        sectionTitle: "4. RENDER & GPU NVENC (HARDWARE ACCELERATION)"
        ColumnLayout {
            width: parent.width
            spacing: 5

            DetailKVRow {
                keyText: "Bộ mã hóa Video"
                valueText: (detailsRoot.videoData.renderCodec || "h264_nvenc") + " · NVIDIA NVENC P1 ULL"
            }
            DetailKVRow {
                keyText: "Render workers"
                valueText: detailsRoot.videoData.renderWorkers ? ("" + detailsRoot.videoData.renderWorkers) : "1"
            }
            DetailKVRow {
                keyText: "Tốc độ GPU"
                valueText: detailsRoot.videoData.renderFps > 0 ? (Math.round(detailsRoot.videoData.renderFps) + " fps") : "—"
            }
            DetailKVRow {
                keyText: "Thời gian Render"
                valueText: Fmt.duration(detailsRoot.videoData.renderDurationSec)
            }
            DetailKVRow {
                keyText: "Mốc render xong"
                valueText: Fmt.timeMs(detailsRoot.videoData.renderedMtime || detailsRoot.videoData.renderedAt)
            }
            DetailKVRow {
                keyText: "Đường dẫn video xuất"
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
                    if (detailsRoot.videoData.renderedPath) detailsRoot.openFolder(detailsRoot.videoData.renderedPath)
                }
            }

            // Danh sách các phần tách (nếu có split parts)
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
                        if (modelData.renderedPath) detailsRoot.openFolder(modelData.renderedPath)
                    }
                }
            }
        }
    }

    // ─── 5. XUẤT BẢN TIKTOK (TIKTOK DISTRIBUTION) ────────────────────
    SectionCard {
        visible: !!detailsRoot.videoData.tiktokStatus
        sectionTitle: "5. XUẤT BẢN TIKTOK (TIKTOK DISTRIBUTION)"
        ColumnLayout {
            width: parent.width
            spacing: 5

            DetailKVRow {
                keyText: "Trạng thái TikTok"
                valueText: {
                    let s = detailsRoot.videoData.tiktokStatus
                    if (s === "uploaded") return "Đã đăng bài thành công"
                    if (s === "failed") return "Thất bại (Cần thử lại)"
                    if (s === "uploading") return "Đang truyền tệp video..."
                    if (s === "queued") return "Chờ xuất bản theo lịch"
                    return s || "Chưa xuất bản"
                }
                valueColor: detailsRoot.videoData.tiktokStatus === "uploaded" ? Theme.success
                          : (detailsRoot.videoData.tiktokStatus === "failed" ? Theme.error : Theme.accent)
            }

            // Nút Thử lại khi TikTok bị lỗi
            RowLayout {
                visible: detailsRoot.videoData.tiktokStatus === "failed"
                Layout.fillWidth: true
                spacing: 10
                Item { Layout.preferredWidth: 140 }
                Rectangle {
                    radius: 4
                    color: Theme.accent + "20"
                    border.color: Theme.accent + "60"
                    border.width: 1
                    implicitHeight: 28
                    implicitWidth: retryLbl.implicitWidth + 20
                    Label {
                        id: retryLbl
                        anchors.centerIn: parent
                        text: "🔁 Thử đăng lại ngay"
                        color: Theme.accent
                        font.pixelSize: 11
                        font.bold: true
                    }
                    MouseArea {
                        anchors.fill: parent
                        cursorShape: Qt.PointingHandCursor
                        onClicked: detailsRoot.retryTikTok(detailsRoot.videoData.id)
                    }
                }
            }

            DetailKVRow {
                keyText: "Thời gian upload"
                valueText: {
                    let ms = detailsRoot.videoData.tiktokUploadMs
                    return ms ? Fmt.duration(ms / 1000.0) : "—"
                }
                valueColor: detailsRoot.videoData.tiktokUploadMs ? Theme.accent : null
            }

            DetailKVRow {
                visible: !!detailsRoot.ttPhase("app")
                keyText: "Phân rã trễ mạng"
                valueText: "App CDP điều khiển: " + detailsRoot.ttPhase("app") + "s · Máy chủ TikTok: " + detailsRoot.ttPhase("tiktok") + "s"
                valueColor: parseFloat(detailsRoot.ttPhase("app")) > 1.5 ? Theme.warning : Theme.textMuted
            }

            DetailKVRow {
                visible: !!detailsRoot.ttPhase("tiktok")
                keyText: "Chi tiết chặng"
                valueText: "Nạp file: " + detailsRoot.ttPhase("file") + "s · Editor: " + detailsRoot.ttPhase("editor")
                    + "s · Caption: " + detailsRoot.ttPhase("caption") + "s · Xử lý: " + detailsRoot.ttPhase("process")
                    + "s · Đăng: " + detailsRoot.ttPhase("confirm") + "s"
            }

            DetailKVRow {
                visible: !!detailsRoot.videoData.tiktokUploadedAt
                keyText: "Mốc đăng xong"
                valueText: Fmt.timeMs(detailsRoot.videoData.tiktokUploadedAt) + " · " + Fmt.fullTime(detailsRoot.videoData.tiktokUploadedAt)
            }

            // Khối hiển thị lỗi TikTok
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
                    anchors.margins: 8
                    spacing: 2
                    Label {
                        text: "LỖI XUẤT BẢN TIKTOK"
                        color: Theme.error
                        font.pixelSize: 10
                        font.bold: true
                    }
                    Label {
                        text: detailsRoot.videoData.tiktokError || ""
                        color: Theme.text
                        font.pixelSize: 11
                        wrapMode: Text.WordWrap
                        Layout.fillWidth: true
                    }
                }
            }
        }
    }

    // ─── 6. CÔNG CỤ DEV & THAO TÁC NHANH (DEVELOPER ACTIONS) ────────
    SectionCard {
        sectionTitle: "6. CÔNG CỤ THAO TÁC DEV (DEVELOPER ACTIONS)"
        RowLayout {
            width: parent.width
            spacing: 10

            Rectangle {
                visible: !!detailsRoot.videoData.downloadedPath
                radius: 4
                color: "#232836"
                border.color: "#3A4456"
                border.width: 1
                implicitHeight: 30
                implicitWidth: btnDlLbl.implicitWidth + 20
                Label {
                    id: btnDlLbl
                    anchors.centerIn: parent
                    text: "📂 Thư mục tải"
                    color: Theme.text
                    font.pixelSize: 11
                }
                MouseArea {
                    anchors.fill: parent
                    cursorShape: Qt.PointingHandCursor
                    onClicked: {
                        if (detailsRoot.videoData.downloadedPath) {
                            detailsRoot.openFolder(detailsRoot.videoData.downloadedPath)
                        }
                    }
                }
            }

            Rectangle {
                visible: !!detailsRoot.videoData.renderedPath
                radius: 4
                color: "#232836"
                border.color: "#3A4456"
                border.width: 1
                implicitHeight: 30
                implicitWidth: btnRenLbl.implicitWidth + 20
                Label {
                    id: btnRenLbl
                    anchors.centerIn: parent
                    text: "📂 Thư mục render"
                    color: Theme.text
                    font.pixelSize: 11
                }
                MouseArea {
                    anchors.fill: parent
                    cursorShape: Qt.PointingHandCursor
                    onClicked: {
                        if (detailsRoot.videoData.renderedPath) {
                            detailsRoot.openFolder(detailsRoot.videoData.renderedPath)
                        }
                    }
                }
            }

            Rectangle {
                visible: !!detailsRoot.videoData.video_id
                radius: 4
                color: "#232836"
                border.color: "#3A4456"
                border.width: 1
                implicitHeight: 30
                implicitWidth: btnYtLbl.implicitWidth + 20
                Label {
                    id: btnYtLbl
                    anchors.centerIn: parent
                    text: "🌐 Xem YouTube"
                    color: Theme.text
                    font.pixelSize: 11
                }
                MouseArea {
                    anchors.fill: parent
                    cursorShape: Qt.PointingHandCursor
                    onClicked: {
                        if (detailsRoot.videoData.video_id) {
                            detailsRoot.openUrl("https://www.youtube.com/watch?v=" + detailsRoot.videoData.video_id)
                        }
                    }
                }
            }
        }
    }
}
