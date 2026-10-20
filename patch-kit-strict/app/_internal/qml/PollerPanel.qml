// src/ui/qml/PollerPanel.qml
// Poller control — status, latency metrics, activity log.
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

SettingsCard {
    title: "PHÁT HIỆN"
    Layout.preferredHeight: 380
    Layout.minimumHeight: 300
    Layout.fillHeight: true

    // ─── Top bar: status + controls ────────────────────────
    RowLayout {
        Layout.fillWidth: true
        StatusDot {
            state: (poller && poller.active) ? "running" : "paused"
            size: 8
            showRing: poller && poller.active
            Layout.alignment: Qt.AlignVCenter
        }
        Label {
            text: (poller && poller.active) ? "ĐANG CHẠY" : "TẠM DỪNG"
            color: (poller && poller.active) ? Theme.success : Theme.textMuted
            font.pixelSize: 15
            font.bold: true
        }
        Label {
            text: "| " + (poller ? poller.pollIntervalMs : 3000) + "ms"
            color: Theme.textMuted
            font.pixelSize: 14
            font.family: "monospace"
        }
        Item { Layout.fillWidth: true }
        IconButton {
            iconName: (poller && poller.active) ? "pause" : "play"
            label: (poller && poller.active) ? "Tạm dừng" : "Tiếp tục"
            iconSize: 12
            Layout.minimumWidth: 80
            onClicked: if (poller) { poller.active ? poller.pause(backend) : poller.resume(backend) }
        }
        IconButton {
            iconName: "refresh"
            iconSize: 14
            Layout.preferredWidth: 32
            Layout.preferredHeight: 28
            onClicked: if (poller) { poller.refresh_from_backend(backend) }
        }
    }

    // Pass 84: mặt cắt nhanh BẬT mà thiếu phiên đăng nhập → đường cắt giây
    // chạy câm (view ẩn danh). Backend chỉ WARN một dòng lúc boot; ở đây nói
    // thẳng cho vận hành, ngay dưới trạng thái quét.
    Rectangle {
        visible: poller && poller.fastSurfaceCookieMissing
        Layout.fillWidth: true
        implicitHeight: fastSurfaceWarnLabel.implicitHeight + 10
        // Nền vàng mờ 10%. (Bản cũ ghép chuỗi Theme.warning+"18" — Qt đọc 8 hex là
        // #AARRGGBB nên ra màu ĐỤC #D93D18 chứ không phải vàng mờ như ý.)
        color: Qt.rgba(Theme.warning.r, Theme.warning.g, Theme.warning.b, 0.10); radius: 4
        border.color: Theme.warning; border.width: 1
        Label {
            id: fastSurfaceWarnLabel
            anchors.fill: parent
            anchors.margins: 5
            text: poller ? poller.fastSurfaceWarning : ""
            color: Theme.warning
            font.pixelSize: 11
            wrapMode: Text.WordWrap
        }
    }

    // Pass 88: đồng hồ máy lệch ≥1,5s so với Google (đo từ header Date của
    // Data API). Số "raw"/verdict theo publishedAt lệch đúng ngần đó — nói
    // thẳng ở đây, kèm cách chỉnh, thay vì để khách đối chiếu bằng mắt.
    Rectangle {
        visible: poller && poller.clockSkewWarn
        Layout.fillWidth: true
        implicitHeight: clockWarnLabel.implicitHeight + 10
        color: Qt.rgba(Theme.warning.r, Theme.warning.g, Theme.warning.b, 0.10); radius: 4
        border.color: Theme.warning; border.width: 1
        Label {
            id: clockWarnLabel
            anchors.fill: parent
            anchors.margins: 5
            text: poller ? poller.clockSkewWarning : ""
            color: Theme.warning
            font.pixelSize: 11
            wrapMode: Text.WordWrap
        }
    }

    // ─── 3 metric chips ────────────────────────────────────
    RowLayout {
        spacing: 4

        Rectangle {
            Layout.fillWidth: true; Layout.preferredHeight: 22
            color: ((poller && poller.lastDetectionLatencyStr !== "—") ? poller.latencyColor : Theme.textMuted) + "18"; radius: 4
            border.color: (poller && poller.lastDetectionLatencyStr !== "—") ? poller.latencyColor : Theme.textMuted; border.width: 1
            Label {
                anchors.centerIn: parent
                // `lastDetectionLatencyStr` đã tự mang phần quy trách nhiệm
                // ("App khởi động" / "~3.4s YT"). Hàng bù không ghép " cuối":
                // "App khởi động cuối" là câu vô nghĩa.
                text: !poller ? "— cuối"
                     : poller.lastDetectionKind === "catchup"
                       ? poller.lastDetectionLatencyStr
                       : poller.lastDetectionLatencyStr + " cuối"
                color: (poller && poller.lastDetectionLatencyStr !== "—") ? poller.latencyColor : Theme.textMuted
                font.pixelSize: 14; font.bold: true
            }
        }

        Rectangle {
            Layout.fillWidth: true; Layout.preferredHeight: 22
            color: ((poller && poller.detectionsToday > 0) ? poller.slaColor : Theme.textMuted) + "18"; radius: 4
            border.color: (poller && poller.detectionsToday > 0) ? poller.slaColor : Theme.textMuted; border.width: 1
            Label {
                anchors.centerIn: parent
                // `slaStr` tự trả "— <5s" khi chưa có mẫu đo được (mọi lượt đều
                // là hàng bù) — đừng suy ra từ detectionsToday nữa.
                text: poller ? poller.slaStr : "— <5s"
                color: poller ? poller.slaColor : Theme.textMuted
                font.pixelSize: 14; font.bold: true
            }
        }

        Rectangle {
            Layout.fillWidth: true; Layout.preferredHeight: 22
            color: Theme.accent + "18"; radius: 4
            border.color: Theme.accent; border.width: 1
            Label {
                anchors.centerIn: parent
                text: (poller ? poller.detectionsToday : 0) + " hôm nay"
                color: Theme.accent
                font.pixelSize: 14; font.bold: true
            }
        }
    }

    // Pass 71: nói rõ chip trên đã LOẠI gì, thay vì âm thầm lọc. Không có dòng
    // này thì "0% <5s" và "3 hôm nay" trông như mâu thuẫn.
    Label {
        visible: poller && poller.detectionAttributionNote !== ""
        text: poller ? poller.detectionAttributionNote : ""
        color: Theme.textMuted
        font.pixelSize: 10
        wrapMode: Text.WordWrap
        Layout.fillWidth: true
    }

    // ─── Activity list ───────────────────────────────────────
    RowLayout {
        Layout.fillWidth: true
        Layout.topMargin: 2
        Label {
            text: "LỊCH SỬ PHÁT HIỆN"
            color: Theme.textMuted
            font.pixelSize: 15; font.bold: true
        }
        Item { Layout.fillWidth: true }
        IconButton {
            iconName: "trash"
            label: "Xóa"
            iconSize: 12
            Layout.preferredHeight: 24
            onClicked: {
                if (detectionHistory) {
                    detectionHistory.clear(backend)
                    if (poller) {
                        poller.refresh_from_backend(backend)
                    }
                }
            }
        }
    }

    ListView {
        id: detList
        Layout.fillWidth: true
        Layout.fillHeight: true
        Layout.minimumHeight: 100
        model: detectionHistory
        clip: true
        spacing: 1
        delegate: Rectangle {
            id: item
            width: detList.width
            height: layout.implicitHeight + 16
            color: expanded ? Theme.cardBg : (index % 2 === 0 ? Theme.rowEven : "transparent")
            radius: 3

            property bool expanded: false

            ColumnLayout {
                id: layout
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.top: parent.top
                anchors.margins: 8
                spacing: 6

                // Compact row
                RowLayout {
                    id: compactRow
                    Layout.fillWidth: true
                    spacing: 8

                    // Time column
                    Label {
                        text: model.detectedTimeStr || ""
                        color: Theme.textMuted; font.pixelSize: 14
                        font.family: "monospace"; Layout.preferredWidth: 60
                    }
                    // Avatar CHUẨN của kênh — lịch sử phát hiện chỉ lưu TÊN
                    // kênh, nên tra qua `channelDir` (bảng dựng sẵn từ
                    // channel:list) thay vì hỏi backend cho từng dòng.
                    ChannelAvatarFor {
                        fallbackName: model.channelName || ""
                        diameter: 18
                        Layout.alignment: Qt.AlignVCenter
                    }
                    // Age at detection — colored by WHO caused the latency:
                    // catchup (app was off when published) and YouTube-side
                    // surfacing delays are not app failures, so they must not
                    // show as red.
                    Label {
                        text: {
                            if (model.status === "scheduled") return "hẹn giờ"
                            const age = model.ageAtDetection || "—"
                            // Hàng bù: KHÔNG đặt bất kỳ con số KHOẢNG THỜI GIAN
                            // nào ở cột này. Tuổi video ("3.4p") bị đọc thành
                            // "app chậm 3,4 phút"; và "kể từ lúc khởi động" cũng
                            // không cứu được vì tiến trình backend sống qua các
                            // lần mở lại UI nên số đó có thể là vài phút.
                            // Đặt MỐC GIỜ ĐĂNG + chữ "App khởi động": không có
                            // khoảng thời gian nào để quy cho app.
                            // Pass 79 — MỘT THƯỚC CHO CẢ HAI PANEL (bài học
                            // tháng 7, lặp lại 15/08): timeline ① hiện cửa sổ
                            // app (2.1s) mà cột này (Pass 77) hiện tổng từ
                            // publishedAt (3.6p vì publishedAt = mốc UPLOAD)
                            // → khách thấy hai số cho cùng một video, không
                            // giải thích được. Operator chốt 15/08: "thay vì
                            // cũng 2.2s" — cột này về CÙNG thước với timeline.
                            //  1. Có ping WebSub → "X công khai" (mốc thật
                            //     trùng nhãn web — thước tốt nhất, khi có).
                            //  2. Chưa có ping → CỬA SỔ APP, y hệt dòng ① của
                            //     timeline; tag YT khi phần trễ là của YouTube.
                            // Số publishedAt-anchored vẫn ở hàng mở rộng
                            // (INVARIANT #24 — không giấu số đo được).
                            if (model.latencySource === "catchup") {
                                return (model.publishedTimeStr || "—")
                                     + " · App khởi động"
                            }
                            // 28/08 (operator, đảo Pass 88b): CHỈ GIỮ MỤC APP —
                            // cột này về đúng MỘT thước với dòng ① timeline
                            // (Pass 96): cửa sổ app. "X công khai · app Y" phô
                            // hai số cạnh nhau làm user đọc nhầm số to là app
                            // chậm. Số công khai→bắt KHÔNG mất: vẫn nguyên ở
                            // hàng mở rộng ("Giờ đăng"/E2E) + trang Lõi quét +
                            // log [WatchProbe] (INVARIANT #24 — không giấu số
                            // đo được, chỉ chọn thước cho cột compact).
                            if (model.appWindowStr)
                                return model.appWindowStr
                                     + (model.publicPending ? " · đang đo…"
                                        : model.latencySource === "youtube" ? " · YT" : "")
                            // Chưa đo được cửa sổ app (backend cũ / thiếu lịch
                            // sử hỏi) mà có mốc công khai → số công khai vẫn hơn
                            // số thô publishedAt.
                            if (model.publicLatencyStr)
                                return model.publicLatencyStr + " công khai"
                            // Backend cũ / chưa đủ lịch sử hỏi: còn mỗi số thô.
                            if (model.latencySource === "youtube") return age + " YT"
                            return age
                        }
                        // Màu vẫn theo CỬA SỔ APP (phần app chịu trách nhiệm):
                        // hàng "3.4p YT · app 2.4s" tô XANH vì app nhanh — đỏ
                        // để dành cho lúc app thật sự chậm. Số nói thật từ lúc
                        // đăng, màu phân xử ai gây trễ: hai việc, hai kênh.
                        color: model.status === "scheduled" ? "#FFB74D"
                             : model.latencySource === "catchup" ? Theme.textMuted
                             : (model.appWindowMs > 0)
                               ? (model.appWindowMs < 5000 ? Theme.success
                                  : model.appWindowMs < 10000 ? Theme.warning : Theme.error)
                             : model.latencySource === "youtube" ? "#4FC3F7"
                             : (model.latencyMs > 0 && model.latencyMs < 5000) ? Theme.success
                             : (model.latencyMs < 10000) ? Theme.warning : Theme.error
                        // Hàng bù và hàng "X công khai" (chỉ còn khi CHƯA đo
                        // được cửa sổ app) dài hơn một con số trần — cỡ nhỏ
                        // lại; cột giữ NGUYÊN bề rộng.
                        font.pixelSize: (model.latencySource === "catchup"
                                         || (model.publicLatencyStr && !model.appWindowStr)) ? 11 : 14
                        font.bold: model.latencySource !== "catchup"
                        Layout.preferredWidth: 120
                    }
                    // Status badge
                    Label {
                        text: {
                            switch(model.status) {
                                case "waiting": return "Chờ"
                                case "downloading": return "Đang tải"
                                case "ready": return "Sẵn sàng"
                                case "scheduled": return "Chờ chiếu"
                                case "error": return "Lỗi"
                                default: return model.status || "—"
                            }
                        }
                        color: model.status === "ready" ? Theme.success
                             : model.status === "error" ? Theme.error
                             : model.status === "downloading" ? Theme.warning
                             : Theme.textMuted
                        font.pixelSize: 14; font.bold: true
                        Layout.preferredWidth: 70
                    }
                    // TikTok upload chip (Pass 42) — chỉ hiện khi kênh có auto-upload
                    Label {
                        visible: !!model.tiktokStatus
                        text: {
                            switch(model.tiktokStatus) {
                                case "queued": return "TT chờ"
                                case "uploading": return "TT đăng…"
                                case "uploaded": {
                                    // 28/08 (operator): chip dùng CHUNG BIẾN với
                                    // "TIMELINE (TỔNG)" trang Quản lí — e2eStr
                                    // (Pass 121: billed detect + tải + render +
                                    // đăng, cùng công thức timeline) thay cho
                                    // tiktokE2eStr (đồng hồ thật bắt→đăng xong,
                                    // gồm chờ queue) → hai màn hình một số.
                                    // Số đồng-hồ-thật vẫn ở hàng mở rộng
                                    // "TikTok · e2e phát hiện→đăng" (#24).
                                    const t = model.e2eStr || model.tiktokE2eStr
                                    return t ? "TT ✓ " + t : "TT ✓"
                                }
                                case "failed": return "TT ✗"
                                default: return model.tiktokStatus
                            }
                        }
                        color: model.tiktokStatus === "uploaded" ? Theme.success
                             : model.tiktokStatus === "failed" ? Theme.error
                             : Theme.warning
                        font.pixelSize: 14; font.bold: true
                    }
                    // Title — scheduled premieres show YouTube's own schedule text
                    // ("Công chiếu 18:35") so the customer knows the app saw the
                    // premiere and is waiting for air time.
                    Label {
                        text: {
                            const t = model.title || ""
                            if (model.status === "scheduled" && model.scheduleText)
                                return t + "  —  " + model.scheduleText
                            return t
                        }
                        color: Theme.text; font.pixelSize: 14
                        elide: Text.ElideRight; Layout.fillWidth: true
                    }
                }

                // Expanded detail
                ColumnLayout {
                    id: detailRow
                    Layout.fillWidth: true
                    visible: item.expanded
                    spacing: 2

                    RowLayout { Layout.fillWidth: true; spacing: 8; Layout.preferredHeight: 16
                        Label { text: "Ngày xuất bản"; color: Theme.textMuted; font.pixelSize: 12; Layout.preferredWidth: 70 }
                        Label { text: model.publishedDateStr || "—"; color: Theme.text; font.pixelSize: 12 }
                        Item { Layout.fillWidth: true }
                        Label { text: "Ngày phát hiện"; color: Theme.textMuted; font.pixelSize: 12; Layout.preferredWidth: 70 }
                        Label { text: model.detectedDateStr || "—"; color: Theme.text; font.pixelSize: 12 }
                    }
                    RowLayout { Layout.fillWidth: true; spacing: 8; Layout.preferredHeight: 16
                        Label { text: "Kênh"; color: Theme.textMuted; font.pixelSize: 12; Layout.preferredWidth: 70 }
                        Label { text: model.channelName || "—"; color: Theme.text; font.pixelSize: 12; elide: Text.ElideRight; Layout.fillWidth: true }
                    }
                    // Pass 71: tuổi video của hàng bù chuyển xuống đây — vẫn hiện
                    // đủ (INVARIANT #24 không cho phép giấu số đo được), nhưng
                    // không còn nằm ở cột độ trễ nơi nó bị đọc thành "app chậm".
                    RowLayout { Layout.fillWidth: true; spacing: 8; Layout.preferredHeight: 16
                        visible: model.latencySource === "catchup"
                        Label { text: "Hàng bù"; color: Theme.textMuted; font.pixelSize: 12; Layout.preferredWidth: 70 }
                        Label {
                            // Chỉ nêu SỰ KIỆN, không quy kết. Phần "app bắt sau X
                            // kể từ khởi động" chỉ hiện khi X còn nhỏ — backend
                            // sống qua các lần mở lại UI nên X có thể là vài
                            // phút, và lúc đó nó gây hiểu sai y như tuổi video.
                            text: "Video đăng " + (model.publishedTimeStr || "—")
                                  + ", trước khi app mở · tuổi lúc bắt "
                                  + (model.ageAtDetection || "—")
                                  + ((model.sinceStartStr && model.sinceStartStr.indexOf("p") < 0)
                                     ? " · app bắt sau " + model.sinceStartStr + " kể từ lúc khởi động"
                                     : "")
                            color: Theme.text; font.pixelSize: 12
                            elide: Text.ElideRight; Layout.fillWidth: true
                        }
                    }
                    // Pass 72: số THÔ theo lời khai của YouTube vẫn hiện đủ
                    // (INVARIANT #24 cấm giấu số đo được) — nhưng ở đây, kèm
                    // mốc giờ để đọc ra ngay "khai sớm hơn thực tế bao nhiêu".
                    RowLayout { Layout.fillWidth: true; spacing: 8; Layout.preferredHeight: 16
                        visible: model.latencySource === "youtube" && model.appWindowMs > 0
                        Label { text: "Giờ đăng"; color: Theme.textMuted; font.pixelSize: 12; Layout.preferredWidth: 70 }
                        Label {
                            text: "YouTube khai " + (model.publishedTimeStr || "—")
                                  + " — sớm hơn lúc bắt " + (model.ageAtDetection || "—")
                                  + " (upload trước, công khai sau / YouTube giữ index) · app: "
                                  + (model.appWindowStr || "—")
                            color: Theme.textMuted; font.pixelSize: 12
                            elide: Text.ElideRight; Layout.fillWidth: true
                        }
                    }
                    RowLayout { Layout.fillWidth: true; spacing: 8; Layout.preferredHeight: 16
                        Label { text: "Download"; color: Theme.textMuted; font.pixelSize: 12; Layout.preferredWidth: 70 }
                        Label { text: model.downloadedSize > 0 ? (model.downloadedSize/1048576).toFixed(1)+"MB in "+(model.downloadTimeSec || 0).toFixed(1)+"s" : "—"; color: Theme.text; font.pixelSize: 12 }
                        Item { Layout.fillWidth: true }
                        Label { text: model.width > 0 ? model.width+"×"+model.height : ""; color: Theme.textMuted; font.pixelSize: 12 }
                    }
                    RowLayout { Layout.fillWidth: true; spacing: 8; Layout.preferredHeight: 16
                        visible: !!model.e2eStr
                        Label { text: "E2E"; color: Theme.textMuted; font.pixelSize: 12; Layout.preferredWidth: 70 }
                        // Pass 121: CÙNG NEO với "TIMELINE (TỔNG)" trang Quản
                        // lí (Pass 96) — chặng ① là CỬA SỔ APP; trước đây hàng
                        // này giữ mốc công khai nên cùng một video hai trang
                        // lệch nhau ~1,3s (ảnh khách 27/08: 11,1s vs 12,4s).
                        // Nhãn đi theo mốc THẬT được _billed_detection_ms chọn
                        // (nhãn lệch số là bug Pass 115). Số công khai→bắt vẫn
                        // hiện nguyên ở badge độ trễ + trang Lõi quét (#24).
                        Label {
                            // Đuôi nhãn theo phạm vi thật của con số: đã đăng
                            // xong thì tổng GỒM chặng đăng (như timeline).
                            text: (model.appWindowMs > 0 ? "Cửa sổ hỏi"
                                  : model.publicLatencyMs > 0 ? "Công khai" : "Cửa sổ hỏi")
                                  + (model.tiktokStatus === "uploaded" ? " → Đăng xong " : " → Xử lý xong ")
                                  + model.e2eStr
                            color: Theme.success; font.pixelSize: 12
                        }
                    }
                    // TikTok upload perf (Pass 42): trạng thái · thời gian upload · e2e phát hiện→đăng
                    RowLayout { Layout.fillWidth: true; spacing: 8; Layout.preferredHeight: 16
                        visible: !!model.tiktokStatus
                        Label { text: "TikTok"; color: Theme.textMuted; font.pixelSize: 12; Layout.preferredWidth: 70 }
                        Label {
                            text: {
                                switch(model.tiktokStatus) {
                                    case "queued": return "Trong hàng đợi đăng"
                                    case "uploading": return "Đang đăng…"
                                    case "uploaded": {
                                        var s = "Đã đăng"
                                        if (model.tiktokUploadStr) s += " · upload " + model.tiktokUploadStr
                                        if (model.tiktokE2eStr) s += " · e2e phát hiện→đăng " + model.tiktokE2eStr
                                        return s
                                    }
                                    case "failed": return "Lỗi: " + (model.tiktokError || "không rõ")
                                    default: return model.tiktokStatus
                                }
                            }
                            color: model.tiktokStatus === "uploaded" ? Theme.success
                                 : model.tiktokStatus === "failed" ? Theme.error
                                 : Theme.text
                            font.pixelSize: 12
                            elide: Text.ElideRight
                            Layout.fillWidth: true
                        }
                    }
                }
            }

            MouseArea {
                anchors.fill: parent
                onClicked: item.expanded = !item.expanded
                z: -1
            }
        }

        Label {
            visible: detList.count === 0
            anchors.centerIn: parent
            text: "Chưa có lượt phát hiện nào"
            color: Theme.textMuted; font.pixelSize: 16
        }
    }
}