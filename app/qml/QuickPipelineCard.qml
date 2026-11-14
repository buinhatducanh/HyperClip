// src/ui/qml/QuickPipelineCard.qml
// Card thiết lập nhanh quy trình tự động hóa E2E (Tải -> Tách Part -> Render -> Đăng TikTok qua AdsPower)
// Tích hợp cơ chế AdsPower Local API (port 50325), FastDone và Hot Upload chuẩn nhánh adspow
// Hỗ trợ Tùy chỉnh Part 1 (N phút) + Phần còn lại tự động chia đôi cho Part 2 và Part 3
// Đã khắc phục toàn bộ 7 lỗi QA: Contract mismatch, Boundary overflow, Float drift, Auto-save, AdsPower Polling, TrimRotate conflict
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

SettingsCard {
    id: card
    title: "⚡ QUY TRÌNH TỰ ĐỘNG HÓA E2E (CHUẨN ADSPOWER)"

    property bool adsPowerOnline: false
    // Chế độ chia part: "custom_p1" | "parts_2" | "parts_3"
    property bool isLoaded: false
    property bool isSyncing: false

    // Chế độ chia part: "custom_p1" | "parts_2" | "parts_3"
    property string splitMode: {
        if (!settings || !settings.autoSplitEnabled || settings.autoSplitMode === "none") return "custom_p1";
        if (settings.autoSplitMode === "minutes") return "custom_p1";
        if (settings.autoSplitMode === "parts" && settings.autoSplitParts === 2) return "parts_2";
        if (settings.autoSplitMode === "parts" && settings.autoSplitParts === 3) return "parts_3";
        return "custom_p1";
    }

    // Thời lượng Part 1 tùy chỉnh (mặc định 3 phút)
    property real customP1Val: {
        if (settings && typeof settings.autoSplitCustomP1 === "number" && settings.autoSplitCustomP1 > 0) {
            return settings.autoSplitCustomP1;
        }
        if (settings && typeof settings.autoSplitMinutes === "number" && settings.autoSplitMinutes > 0 && settings.autoSplitMinutes < 15) {
            return settings.autoSplitMinutes;
        }
        return 3.0;
    }

    // Tổng thời lượng video cắt tải về (mặc định 10 phút)
    readonly property real totalTrimMinutes: (settings && typeof settings.defaultTrimLimit === "number") ? settings.defaultTrimLimit : 10
    readonly property int totalTrimSec: Math.max(60, Math.round(card.totalTrimMinutes * 60))

    // Khi người dùng đổi tổng thời gian tải, tự động điều chỉnh Part 1 nếu bị vượt ngưỡng
    onTotalTrimMinutesChanged: {
        if (!card.isLoaded || card.isSyncing) return;
        var maxP1 = Math.max(1, Math.min(30, Math.floor(card.totalTrimMinutes)));
        if (card.customP1Val > maxP1) card.customP1Val = maxP1;
        if (p1Spin && p1Spin.value !== Math.round(card.customP1Val)) p1Spin.value = Math.round(card.customP1Val);
        card.syncSplitSettings();
    }

    // Tính toán số học chuẩn xác từng giây lẻ (Khắc phục BUG-03 & BUG-05)
    readonly property real p1Duration: Math.min(card.customP1Val, card.totalTrimMinutes)
    readonly property int remainingSec: Math.max(0, card.totalTrimSec - Math.round(card.p1Duration * 60))
    readonly property real remainMinutes: Math.round((card.remainingSec / 60) * 10) / 10
    readonly property int customPartCount: card.remainingSec < 30 ? 1 : (card.remainingSec < 60 ? 2 : 3)
    readonly property real p2Duration: card.effP2Sec / 60
    readonly property real p3Duration: card.effP3Sec / 60

    // Thời lượng thực tế từng part tính theo giây nguyên bản
    readonly property int effP1Sec: {
        if (card.splitMode === "parts_2") return Math.round(card.totalTrimSec / 2);
        if (card.splitMode === "parts_3") return Math.round(card.totalTrimSec / 3);
        return Math.min(Math.round(card.p1Duration * 60), card.totalTrimSec);
    }
    readonly property int effP2Sec: {
        if (card.splitMode === "parts_2") return Math.max(0, card.totalTrimSec - card.effP1Sec);
        if (card.splitMode === "parts_3") return Math.round(card.totalTrimSec / 3);
        var rem = Math.max(0, card.totalTrimSec - card.effP1Sec);
        if (rem < 30) return 0;
        if (rem < 60) return rem;
        return Math.ceil(rem / 2);
    }
    readonly property int effP3Sec: {
        if (card.splitMode === "parts_2") return 0;
        if (card.splitMode === "parts_3") return Math.max(0, card.totalTrimSec - card.effP1Sec - card.effP2Sec);
        var rem = Math.max(0, card.totalTrimSec - card.effP1Sec);
        return rem < 60 ? 0 : Math.max(0, rem - card.effP2Sec);
    }

    function formatSecClock(sec) {
        var m = Math.floor(sec / 60);
        var s = sec % 60;
        return m + ":" + (s < 10 ? "0" : "") + s;
    }
    // Helper format thời gian từ phút sang mm:ss (ví dụ: 2.5 phút -> "2:30")
    function formatTime(minVal) {
        var totalSec = Math.round(minVal * 60);
        var m = Math.floor(totalSec / 60);
        var s = totalSec % 60;
        return m + ":" + (s < 10 ? "0" : "") + s;
    }

    // Đồng bộ và lưu dữ liệu tức thì xuống backend & settings.json (Khắc phục BUG-01, BUG-04, BUG-06)
    function syncSplitSettings() {
        if (!card.isLoaded || !settings || card.isSyncing) return;
        card.isSyncing = true;
        try {

        settings.trimRotateEnabled = false;
        var isSplit = splitSwitch ? splitSwitch.checked : (settings ? settings.autoSplitEnabled : true);
        settings.autoSplitEnabled = isSplit;

        if (!isSplit) {
            settings.autoSplitMode = "none";
            settings.autoSplitParts = 1;
            settings.autoSplitMinutes = card.totalTrimMinutes;
            try { settings.autoSplitCustomP1 = 0; } catch(e) {}
            try { settings.autoSplitPart1Minutes = 0; } catch(e) {}
            try { settings.autoSplitRemainMinutes = 0; } catch(e) {}
            settings.autoRenderTitleTemplate = "{title}";
        } else if (card.splitMode === "custom_p1") {
            settings.autoSplitEnabled = true;
            settings.autoSplitMode = "minutes";
            settings.autoSplitParts = card.customPartCount;
            settings.autoSplitMinutes = card.customP1Val;
            try { settings.autoSplitCustomP1 = card.customP1Val; } catch(e) {}
            try { settings.autoSplitPart1Minutes = card.customP1Val; } catch(e) {}
            try { settings.autoSplitRemainMinutes = card.p2Duration; } catch(e) {}
            settings.autoRenderTitleTemplate = "PART {part}";
        } else if (card.splitMode === "parts_2") {
            settings.autoSplitEnabled = true;
            settings.autoSplitMode = "parts";
            settings.autoSplitMinutes = Math.round((card.totalTrimMinutes / 2) * 10) / 10;
            settings.autoSplitParts = 2;
            try { settings.autoSplitCustomP1 = 0; } catch(e) {}
            try { settings.autoSplitPart1Minutes = 0; } catch(e) {}
            try { settings.autoSplitRemainMinutes = 0; } catch(e) {}
            settings.autoRenderTitleTemplate = "PART {part}";
        } else if (card.splitMode === "parts_3") {
            settings.autoSplitEnabled = true;
            settings.autoSplitMode = "parts";
            settings.autoSplitMinutes = Math.round((card.totalTrimMinutes / 3) * 10) / 10;
            settings.autoSplitParts = 3;
            try { settings.autoSplitCustomP1 = 0; } catch(e) {}
            try { settings.autoSplitPart1Minutes = 0; } catch(e) {}
            try { settings.autoSplitRemainMinutes = 0; } catch(e) {}
            settings.autoRenderTitleTemplate = "PART {part}";
        }

        // Đồng bộ chất lượng tải và render theo chuẩn tối ưu AdsPow:
        // - Chế độ 720p (Ưu tiên tốc độ AdsPow): Tải 360p siêu tốc (1-2s) -> Render & Đăng TikTok 720p (E2E < 15s)
        // - Chế độ 1080p (Ưu tiên chất lượng): Tải 1080p Full HD -> Render & Đăng TikTok 1080p
        var targetRes = settings.autoRenderResolution || "720p";
        var targetDlQuality = (targetRes === "1080p") ? "1080" : "360";
        settings.autoDownloadQuality = targetDlQuality;
        settings.defaultQuality = (targetRes === "1080p") ? 1080 : 360;

        if (typeof backend !== "undefined" && backend) {
            try {
                var updateResult = backend.send_command("settings:update", {
                    "defaultTrimLimit": settings.defaultTrimLimit,
                    "autoSplitEnabled": settings.autoSplitEnabled,
                    "autoSplitMode": settings.autoSplitMode,
                    "autoSplitMinutes": settings.autoSplitMinutes,
                    "autoSplitParts": settings.autoSplitParts,
                    "autoSplitSubMode": card.splitMode,
                    "autoSplitCustomP1": (isSplit && card.splitMode === "custom_p1" ? card.customP1Val : 0),
                    "autoSplitPart1Minutes": (isSplit && card.splitMode === "custom_p1" ? card.customP1Val : 0),
                    "autoSplitRemainMinutes": (isSplit && card.splitMode === "custom_p1" ? card.p2Duration : 0),
                    "autoRenderTitleTemplate": settings.autoRenderTitleTemplate,
                    "autoRenderResolution": settings.autoRenderResolution,
                    "autoDownloadQuality": targetDlQuality,
                    "defaultQuality": (targetRes === "1080p" ? 1080 : 360),
                    "tiktokUploadEnabled": settings.tiktokUploadEnabled,
                    "tiktokFastDone": settings.tiktokFastDone,
                    "trimRotateEnabled": false,
                    "splitChainDelaySec": 0
                });
                if (updateResult && (updateResult.ok === false || updateResult.error)) {
                    console.warn("Could not persist E2E settings:", updateResult.error || "settings:update failed");
                }
            } catch(e) { console.warn("Could not persist E2E settings:", e); }

            try {
                if (typeof settings.save_to_backend === "function") {
                    settings.save_to_backend(backend);
                }
            } catch(e) {}
        }
        } finally {
            card.isSyncing = false;
        }
    }

    function checkAdsPower() {
        try {
            var xhr = new XMLHttpRequest();
            xhr.open("GET", "http://127.0.0.1:50325/status");
            xhr.timeout = 1500;
            xhr.onreadystatechange = function() {
                if (xhr.readyState === XMLHttpRequest.DONE) {
                    if (xhr.status === 200) {
                        try {
                            var res = JSON.parse(xhr.responseText);
                            card.adsPowerOnline = (res && res.code === 0);
                        } catch(e) { card.adsPowerOnline = false; }
                    } else {
                        card.adsPowerOnline = false;
                    }
                }
            };
            xhr.send();
        } catch(e) {
            card.adsPowerOnline = false;
        }
    }

    Component.onCompleted: {
        card.checkAdsPower();
        var hasPersistedSplitMode = false;
        if (typeof backend !== "undefined" && backend) {
            try {
                var rawRes = backend.send_command("settings:get");
                var res = (rawRes && rawRes.settings) ? rawRes.settings : ((rawRes && rawRes.result) ? rawRes.result : rawRes);
                if (res) {
                    hasPersistedSplitMode = res.autoSplitEnabled === false
                        || res.autoSplitMode === "none"
                        || res.autoSplitMode === "minutes"
                        || (res.autoSplitMode === "parts" && (res.autoSplitParts === 2 || res.autoSplitParts === 3));
                    if (res.autoSplitMode === "minutes" || res.autoSplitSubMode === "custom_p1") {
                        card.splitMode = "custom_p1";
                    } else if (res.autoSplitMode === "parts" && res.autoSplitParts === 2) {
                        card.splitMode = "parts_2";
                    } else if (res.autoSplitMode === "parts" && res.autoSplitParts === 3) {
                        card.splitMode = "parts_3";
                    } else {
                        card.splitMode = "custom_p1";
                    }

                    if (typeof res.autoSplitCustomP1 === "number" && res.autoSplitCustomP1 > 0) {
                        card.customP1Val = res.autoSplitCustomP1;
                    } else if (typeof res.autoSplitMinutes === "number" && res.autoSplitMinutes > 0 && res.autoSplitMinutes < 15) {
                        card.customP1Val = res.autoSplitMinutes;
                    }
                    if (p1Spin) p1Spin.value = Math.round(card.customP1Val);
                    if (trimSpin && typeof res.defaultTrimLimit === "number") trimSpin.value = res.defaultTrimLimit;
                    if (splitSwitch && typeof res.autoSplitEnabled === "boolean") splitSwitch.checked = res.autoSplitEnabled;
                    if (ttSwitch && typeof res.tiktokUploadEnabled === "boolean") ttSwitch.checked = res.tiktokUploadEnabled;
                    if (resCombo && res.autoRenderResolution) {
                        var resIdx = ["720p", "1080p"].indexOf(res.autoRenderResolution);
                        if (resIdx >= 0) resCombo.currentIndex = resIdx;
                    }
                    if (tplQuickInput && res.autoRenderTitleTemplate) {
                        tplQuickInput.text = res.autoRenderTitleTemplate;
                    }
                }
            } catch(e) {}
        }
        card.isLoaded = true;
        if (!hasPersistedSplitMode) {
            if (splitSwitch) splitSwitch.checked = true;
            card.splitMode = "custom_p1";
            if (settings) {
                settings.autoSplitEnabled = true;
                card.syncSplitSettings();
            }
        }
    }

    // Timer kiểm tra trạng thái AdsPower định kỳ 4s (Khắc phục BUG-07)
    Timer {
        id: adsPowerWatcher
        interval: 4000
        repeat: true
        running: card.visible
        onTriggered: card.checkAdsPower()
    }

    ColumnLayout {
        Layout.fillWidth: true
        spacing: Theme.spacingMd

        // ─── BANNER TÓM TẮT TRẠNG THÁI TRỰC QUAN ────────────────────────
        Rectangle {
            Layout.fillWidth: true
            Layout.preferredHeight: bannerRow.implicitHeight + 14
            radius: Theme.radiusMd
            color: Theme.surface
            border.color: Theme.accent
            border.width: 1

            RowLayout {
                id: bannerRow
                anchors.fill: parent
                anchors.leftMargin: 12
                anchors.rightMargin: 12
                spacing: 8

                Label {
                    text: "LUỒNG THỰC THI:"
                    color: Theme.accent
                    font.pixelSize: Theme.textSm
                    font.bold: true
                }
                Label {
                    text: {
                        var trimStr = (settings && settings.defaultTrimLimit < 900) ? ("Tải " + settings.defaultTrimLimit + " phút đầu") : "Tải trọn vẹn video";
                        var partStr = "";
                        if (!splitSwitch || !splitSwitch.checked) {
                            partStr = "1 Video đơn";
                        } else if (card.splitMode === "custom_p1") {
                            if (card.customPartCount === 3) {
                                partStr = "Chia 3 Part (P1: " + card.p1Duration + "p | P2: " + card.p2Duration + "p | P3: " + card.p3Duration + "p)";
                            } else if (card.customPartCount === 2) {
                                partStr = "Chia 2 Part (P1: " + card.p1Duration + "p | P2: " + card.p2Duration + "p)";
                            } else {
                                partStr = "1 Video đơn (" + card.totalTrimMinutes + "p)";
                            }
                        } else {
                            if (card.splitMode === "parts_3") {
                                partStr = "Chia 3 Part đều (" + card.formatSecClock(card.effP1Sec) + " / part)";
                            } else if (card.splitMode === "parts_2") {
                                partStr = "Chia 2 Part đều (" + card.formatSecClock(card.effP1Sec) + " / part)";
                            } else {
                                partStr = "Chia " + (settings ? settings.autoSplitParts : 3) + " Part đều";
                            }
                        }
                        var renStr = (settings && settings.autoRenderResolution === "720p")
                            ? "Tải 360p ➔ Render 720p AdsPow (Siêu tốc)"
                            : "Tải 1080p ➔ Render 1080p AdsPow (Full HD)";
                        var ttStr = (settings && settings.tiktokUploadEnabled) ? "Đăng TikTok từng Part qua AdsPower" : "Lưu máy";
                        return trimStr + "  ➔  " + partStr + "  ➔  " + renStr + "  ➔  " + ttStr;
                    }
                    color: Theme.text
                    font.pixelSize: Theme.textSm
                    font.bold: true
                    Layout.fillWidth: true
                    elide: Text.ElideRight
                }
            }
        }

        // ─── 4 BƯỚC CỐT LÕI (BẢNG THIẾT LẬP GỌN GÀNG) ───────────────────
        GridLayout {
            columns: 2
            columnSpacing: Theme.spacingLg
            rowSpacing: Theme.spacingMd
            Layout.fillWidth: true

            // ═══ BƯỚC 1: GIỚI HẠN TẢI (TRIM LIMIT) ═══════════════════════
            RowLayout {
                spacing: 6
                Layout.fillWidth: true
                Rectangle {
                    width: 20; height: 20; radius: 10; color: Theme.accent
                    Label { anchors.centerIn: parent; text: "1"; color: "#000"; font.pixelSize: 11; font.bold: true }
                }
                Label {
                    text: "Chỉ tải số phút cần tải"
                    color: Theme.text; font.pixelSize: Theme.textMd; font.bold: true
                }
                HelpTip {
                    text: "Tải một lần trọn vẹn N phút đầu của video gốc (ví dụ video 20-60 phút chỉ tải 10 phút đầu) về máy để làm nguồn trích xuất các Part. Tiết kiệm hơn 60% thời gian tải và chống nghẽn mạng."
                }
            }
            ColumnLayout {
                Layout.preferredWidth: 320
                Layout.alignment: Qt.AlignRight
                spacing: 4

                RowLayout {
                    Layout.fillWidth: true
                    spacing: 8
                    SpinBox {
                        id: trimSpin
                        Layout.fillWidth: true
                        font.pixelSize: Theme.textMd
                        from: 2; to: 999
                        value: settings ? settings.defaultTrimLimit : 10
                        editable: true
                        onValueModified: {
                            if (settings) {
                                settings.defaultTrimLimit = value;
                                card.syncSplitSettings();
                            }
                        }
                        onActiveFocusChanged: {
                            if (!activeFocus) {
                                var v = Math.max(from, Math.min(to, valueFromText(contentItem.text, locale)));
                                value = v;
                                if (settings) {
                                    settings.defaultTrimLimit = v;
                                    card.syncSplitSettings();
                                }
                            }
                        }
                    }
                    Label { text: "phút"; color: Theme.textMuted; font.pixelSize: Theme.textMd }
                }

                RowLayout {
                    spacing: 4
                    Layout.alignment: Qt.AlignRight
                    Repeater {
                        model: [
                            { label: "5p", val: 5 },
                            { label: "9p", val: 9 },
                            { label: "10p (Chuẩn)", val: 10 },
                            { label: "15p", val: 15 }, { label: "20p", val: 20 },
                            { label: "Trọn vẹn", val: 999 }
                        ]
                        delegate: Rectangle {
                            id: trimBtn
                            required property var modelData
                            width: trimBtnLbl.implicitWidth + 10
                            height: 22
                            radius: 3
                            readonly property bool isSel: settings && settings.defaultTrimLimit === modelData.val
                            color: isSel ? Theme.accent : Theme.surface
                            border.color: Theme.border; border.width: 1
                            Label {
                                id: trimBtnLbl
                                anchors.centerIn: parent
                                text: trimBtn.modelData.label
                                font.pixelSize: 10
                                color: trimBtn.isSel ? "#000" : Theme.textMuted
                                font.bold: trimBtn.isSel
                            }
                            MouseArea {
                                anchors.fill: parent
                                cursorShape: Qt.PointingHandCursor
                                onClicked: {
                                    if (settings) {
                                        settings.defaultTrimLimit = trimBtn.modelData.val;
                                        trimSpin.value = trimBtn.modelData.val;
                                        card.syncSplitSettings();
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // ═══ BƯỚC 2: TỰ ĐỘNG CHIA PART (CUSTOM PART 1 + CHIA ĐÔI CÒN LẠI) ═══
            RowLayout {
                spacing: 6
                Layout.fillWidth: true
                Rectangle {
                    width: 20; height: 20; radius: 10; color: Theme.accent
                    Label { anchors.centerIn: parent; text: "2"; color: "#000"; font.pixelSize: 11; font.bold: true }
                }
                Label {
                    text: "Tự động chia Part"
                    color: Theme.text; font.pixelSize: Theme.textMd; font.bold: true
                }
                HelpTip {
                    text: "Tùy chỉnh thời lượng Part 1 bao nhiêu phút (Hook cuốn người xem). Toàn bộ thời gian còn lại sẽ tự động chia đôi đều cho Part 2 và Part 3. Part 1 tải & render xong là đăng TikTok ngay lập tức!"
                }
            }
            ColumnLayout {
                Layout.preferredWidth: 320
                Layout.alignment: Qt.AlignRight
                spacing: 6

                RowLayout {
                    Layout.fillWidth: true
                    spacing: 8
                    Switch {
                        id: splitSwitch
                        checked: settings && typeof settings.autoSplitEnabled === "boolean" ? settings.autoSplitEnabled : true
                        onToggled: {
                            if (settings) {
                                settings.autoSplitEnabled = checked;
                                card.syncSplitSettings();
                            }
                        }
                    }
                    Label {
                        text: splitSwitch.checked
                              ? (card.splitMode === "custom_p1"
                                 ? (card.customPartCount === 3
                                    ? ("Chia 3 Part (P1: " + card.p1Duration + "p | P2&3: " + card.p2Duration + "p)")
                                    : (card.customPartCount === 2
                                       ? ("Chia 2 Part (P1: " + card.p1Duration + "p | P2: " + card.p2Duration + "p)")
                                       : ("1 Video đơn (" + card.totalTrimMinutes + "p)")))
                                 : (card.splitMode === "parts_2" ? ("Chia đều 2 Part (" + card.formatSecClock(card.effP1Sec) + " / part)") : ("Chia đều 3 Part (" + card.formatSecClock(card.effP1Sec) + " / part)")))
                              : "Tắt (1 video đơn)"
                        color: splitSwitch.checked ? Theme.success : Theme.textMuted
                        font.pixelSize: Theme.textMd
                        font.bold: true
                        Layout.fillWidth: true
                        elide: Text.ElideRight
                    }
                }

                // Hàng chọn chế độ chia Part
                RowLayout {
                    visible: splitSwitch.checked
                    spacing: 4
                    Layout.alignment: Qt.AlignRight
                    Repeater {
                        model: [
                            { mode: "custom_p1", label: "Tùy chỉnh P1 (Khuyên dùng)" },
                            { mode: "parts_2", label: "2 Part đều" },
                            { mode: "parts_3", label: "3 Part đều" }
                        ]
                        delegate: Rectangle {
                            id: splitModeBtn
                            required property var modelData
                            width: splitModeLbl.implicitWidth + 10
                            height: 22
                            radius: 3
                            readonly property bool isSel: card.splitMode === modelData.mode
                            color: isSel ? Theme.accent : Theme.surface
                            border.color: Theme.border; border.width: 1
                            Label {
                                id: splitModeLbl
                                anchors.centerIn: parent
                                text: splitModeBtn.modelData.label
                                font.pixelSize: 10
                                color: splitModeBtn.isSel ? "#000" : Theme.textMuted
                                font.bold: splitModeBtn.isSel
                            }
                            MouseArea {
                                anchors.fill: parent
                                cursorShape: Qt.PointingHandCursor
                                onClicked: {
                                    card.splitMode = splitModeBtn.modelData.mode;
                                    card.syncSplitSettings();
                                }
                            }
                        }
                    }
                }

                // Cài đặt chi tiết cho chế độ Part 1 tùy chỉnh
                ColumnLayout {
                    visible: splitSwitch.checked && card.splitMode === "custom_p1"
                    Layout.fillWidth: true
                    spacing: 6

                    RowLayout {
                        Layout.fillWidth: true
                        spacing: 8
                        Label {
                            text: "Thời lượng Part 1:"
                            color: Theme.text
                            font.pixelSize: Theme.textSm
                            font.bold: true
                        }
                        SpinBox {
                            id: p1Spin
                            Layout.fillWidth: true
                            font.pixelSize: Theme.textSm
                            from: 1
                            // Ràng buộc giới hạn an toàn, tránh Part 1 lấn át toàn bộ video (BUG-03)
                            to: Math.max(1, Math.min(30, Math.floor(card.totalTrimMinutes)))
                            value: Math.round(card.customP1Val)
                            editable: true
                            onValueModified: {
                                card.customP1Val = value;
                                card.syncSplitSettings();
                            }
                            onActiveFocusChanged: {
                                if (!activeFocus) {
                                    var v = Math.max(from, Math.min(to, valueFromText(contentItem.text, locale)));
                                    value = v;
                                    card.customP1Val = v;
                                    card.syncSplitSettings();
                                }
                            }
                        }
                        Label { text: "phút"; color: Theme.textMuted; font.pixelSize: Theme.textSm }
                    }
                }

                // Thẻ đồ họa trực quan phân bổ Part (Visual Badges - Chuẩn xác từng giây)
                Rectangle {
                    visible: splitSwitch.checked
                    Layout.fillWidth: true
                    Layout.preferredHeight: visualPartCol.implicitHeight + 12
                    radius: 6
                    color: Theme.cardBg
                    border.color: Theme.border
                    border.width: 1

                    ColumnLayout {
                        id: visualPartCol
                        anchors.fill: parent
                        anchors.margins: 6
                        spacing: 4

                        Label {
                            text: "PHÂN BỔ TRỰC QUAN (TỔNG " + card.totalTrimMinutes + " PHÚT):"
                            color: Theme.accent
                            font.pixelSize: 9
                            font.bold: true
                        }

                        // ─── CHẾ ĐỘ 2 PART ĐỀU ───────────────────────────────
                        RowLayout {
                            visible: card.splitMode === "parts_2"
                            Layout.fillWidth: true
                            spacing: 4

                            Rectangle {
                                Layout.fillWidth: true
                                Layout.preferredHeight: 32
                                radius: 4
                                color: Qt.rgba(0, 0.7, 1, 0.15)
                                border.color: Theme.accent
                                border.width: 1

                                ColumnLayout {
                                    anchors.centerIn: parent
                                    spacing: 0
                                    Label {
                                        Layout.alignment: Qt.AlignHCenter
                                        text: "PART 1: " + card.formatSecClock(card.effP1Sec) + " (0:00 - " + card.formatSecClock(card.effP1Sec) + ")"
                                        color: Theme.accent
                                        font.pixelSize: 9
                                        font.bold: true
                                    }
                                    Label {
                                        Layout.alignment: Qt.AlignHCenter
                                        text: "⚡ Đăng TikTok ngay"
                                        color: Theme.textMuted
                                        font.pixelSize: 8
                                    }
                                }
                            }

                            Label { text: "➔"; color: Theme.textMuted; font.pixelSize: 10 }

                            Rectangle {
                                Layout.fillWidth: true
                                Layout.preferredHeight: 32
                                radius: 4
                                color: Theme.surface
                                border.color: Theme.border
                                border.width: 1

                                ColumnLayout {
                                    anchors.centerIn: parent
                                    spacing: 0
                                    Label {
                                        Layout.alignment: Qt.AlignHCenter
                                        text: "PART 2: " + card.formatSecClock(card.effP2Sec) + " (" + card.formatSecClock(card.effP1Sec) + " - " + card.formatSecClock(card.totalTrimSec) + ")"
                                        color: Theme.text
                                        font.pixelSize: 9
                                        font.bold: true
                                    }
                                    Label {
                                        Layout.alignment: Qt.AlignHCenter
                                        text: "Hoàn tất video"
                                        color: Theme.textMuted
                                        font.pixelSize: 8
                                    }
                                }
                            }
                        }

                        // ─── CHẾ ĐỘ 3 PART (CUSTOM P1 HOẶC 3 PART ĐỀU) ───────
                        RowLayout {
                            visible: card.splitMode !== "parts_2" && (card.splitMode === "parts_3" || card.customPartCount >= 2)
                            Layout.fillWidth: true
                            spacing: 4

                            // Badge Part 1
                            Rectangle {
                                Layout.fillWidth: true
                                Layout.preferredHeight: 32
                                radius: 4
                                color: Qt.rgba(0, 0.7, 1, 0.15)
                                border.color: Theme.accent
                                border.width: 1

                                ColumnLayout {
                                    anchors.centerIn: parent
                                    spacing: 0
                                    Label {
                                        Layout.alignment: Qt.AlignHCenter
                                        text: "PART 1: " + card.formatSecClock(card.effP1Sec) + " (0:00 - " + card.formatSecClock(card.effP1Sec) + ")"
                                        color: Theme.accent
                                        font.pixelSize: 9
                                        font.bold: true
                                    }
                                    Label {
                                        Layout.alignment: Qt.AlignHCenter
                                        text: "⚡ Đăng TikTok ngay"
                                        color: Theme.textMuted
                                        font.pixelSize: 8
                                    }
                                }
                            }

                            Label { text: "➔"; visible: card.splitMode !== "custom_p1" || card.customPartCount === 3; color: Theme.textMuted; font.pixelSize: 10 }

                            // Badge Part 2
                            Rectangle {
                                Layout.fillWidth: true
                                Layout.preferredHeight: 32
                                radius: 4
                                color: Theme.surface
                                border.color: Theme.border
                                border.width: 1

                                ColumnLayout {
                                    anchors.centerIn: parent
                                    spacing: 0
                                    Label {
                                        Layout.alignment: Qt.AlignHCenter
                                        text: (card.splitMode === "custom_p1")
                                            ? ("PART 2: " + card.formatSecClock(card.effP2Sec) + (card.customPartCount === 2
                                                ? (" (" + card.formatSecClock(card.effP1Sec) + " - " + card.formatSecClock(card.totalTrimSec) + ")")
                                                : (" (Nối tiếp " + card.formatSecClock(card.effP1Sec) + " - 50% còn lại)")))
                                            : ("PART 2: " + card.formatSecClock(card.effP2Sec) + " (" + card.formatSecClock(card.effP1Sec) + " - " + card.formatSecClock(card.effP1Sec + card.effP2Sec) + ")")
                                        color: Theme.text
                                        font.pixelSize: 9
                                        font.bold: true
                                    }
                                    Label {
                                        Layout.alignment: Qt.AlignHCenter
                                        text: (card.splitMode === "custom_p1")
                                            ? (card.customPartCount === 2 ? "Phần còn lại" : "Chia đôi phần còn lại")
                                            : "Render nối tiếp"
                                        color: Theme.textMuted
                                        font.pixelSize: 8
                                    }
                                }
                            }

                            Label { text: "➔"; visible: card.splitMode !== "custom_p1" || card.customPartCount === 3; color: Theme.textMuted; font.pixelSize: 10 }

                            // Badge Part 3
                            Rectangle {
                                visible: card.splitMode !== "custom_p1" || card.customPartCount === 3
                                Layout.fillWidth: true
                                Layout.preferredHeight: 32
                                radius: 4
                                color: Theme.surface
                                border.color: Theme.border
                                border.width: 1

                                ColumnLayout {
                                    anchors.centerIn: parent
                                    spacing: 0
                                    Label {
                                        Layout.alignment: Qt.AlignHCenter
                                        text: (card.splitMode === "custom_p1")
                                            ? ("PART 3: ~" + card.formatSecClock(card.effP3Sec) + " (Dồn tiếp đến hết video)")
                                            : ("PART 3: " + card.formatSecClock(card.effP3Sec) + " (" + card.formatSecClock(card.effP1Sec + card.effP2Sec) + " - " + card.formatSecClock(card.totalTrimSec) + ")")
                                        color: Theme.text
                                        font.pixelSize: 9
                                        font.bold: true
                                    }
                                    Label {
                                        Layout.alignment: Qt.AlignHCenter
                                        text: "Hoàn tất video"
                                        color: Theme.textMuted
                                        font.pixelSize: 8
                                    }
                                }
                            }
                        }

                        // Chú thích giải thích công thức chia theo thời lượng thực tế
                        Label {
                            Layout.fillWidth: true
                            Layout.alignment: Qt.AlignHCenter
                            horizontalAlignment: Text.AlignHCenter
                            visible: card.splitMode === "custom_p1" && card.customPartCount === 3
                            text: "💡 Quy tắc dồn timeline: Part 1 = " + card.p1Duration + "p (0:00 - " + card.formatSecClock(card.effP1Sec) + ") · Part 2 & 3 chia đều 100% video còn lại (VD video 11:15: P1 0:00 - 3:00 | P2 3:00 - 7:08 | P3 7:08 - 11:15)"
                            color: Theme.accent
                            font.pixelSize: 8
                        }

                        // Cảnh báo nếu P1 lấn át toàn bộ video
                        Rectangle {
                            visible: card.splitMode === "custom_p1" && card.customPartCount === 1
                            Layout.fillWidth: true
                            Layout.preferredHeight: 26
                            radius: 4
                            color: Theme.surface
                            border.color: Theme.warning
                            border.width: 1
                            Label {
                                anchors.centerIn: parent
                                text: "Nguồn không còn đủ thời lượng cho các part tiếp theo. Hệ thống xuất một video với toàn bộ " + card.totalTrimMinutes + " phút đã chọn."
                                color: Theme.warning
                                font.pixelSize: 9
                            }
                        }
                    }
                }
            }

            // ═══ BƯỚC 3: MẪU RENDER VIDEO (CHUẨN ADSPOW) ══════════════════
            RowLayout {
                spacing: 6
                Layout.fillWidth: true
                Rectangle {
                    width: 20; height: 20; radius: 10; color: Theme.accent
                    Label { anchors.centerIn: parent; text: "3"; color: "#000"; font.pixelSize: 11; font.bold: true }
                }
                Label {
                    text: "Mẫu render AdsPow"
                    color: Theme.text; font.pixelSize: Theme.textMd; font.bold: true
                }
                HelpTip {
                    text: "Khung dọc 9:16 chuẩn AdsPow: Video vuông 1:1 ở giữa, chân trang nền xanh cyan #00B4FF phẳng. Tiêu đề nướng tự động theo tên video gốc."
                }
            }
            ColumnLayout {
                Layout.preferredWidth: 320
                Layout.alignment: Qt.AlignRight
                spacing: 4

                RowLayout {
                    Layout.fillWidth: true
                    spacing: 6
                    ComboBox {
                        id: resCombo
                        Layout.preferredWidth: 100
                        font.pixelSize: Theme.textSm
                        model: ["720p", "1080p"]
                        currentIndex: settings ? Math.max(0, ["720p", "1080p"].indexOf(settings.autoRenderResolution)) : 0
                        onActivated: {
                            if (settings) {
                                var chosenRes = model[currentIndex];
                                settings.autoRenderResolution = chosenRes;
                                settings.autoDownloadQuality = (chosenRes === "1080p") ? "1080" : "360";
                                settings.defaultQuality = (chosenRes === "1080p") ? 1080 : 360;
                                card.syncSplitSettings();
                            }
                        }
                    }
                    TextField {
                        id: tplQuickInput
                        Layout.fillWidth: true
                        font.pixelSize: Theme.textSm
                        color: Theme.text
                        placeholderText: "{title}"
                        placeholderTextColor: Theme.textMuted
                        text: settings ? settings.autoRenderTitleTemplate : "{title}"
                        onEditingFinished: {
                            if (settings) {
                                settings.autoRenderTitleTemplate = text;
                                card.syncSplitSettings();
                            }
                        }
                        background: Rectangle {
                            color: Theme.inputBg
                            border.color: parent.activeFocus ? Theme.accent : Theme.border
                            border.width: 1
                            radius: Theme.radiusMd
                        }
                    }
                }

                RowLayout {
                    spacing: 4
                    Layout.alignment: Qt.AlignRight
                    Repeater {
                        model: [
                            { label: "Chuẩn ({title})", val: "{title}", overlay: true },
                            { label: "PART {part}", val: "PART {part} - {title}", overlay: true },
                            { label: "Nền trơn", val: "", overlay: false }
                        ]
                        delegate: Rectangle {
                            id: tplBtn
                            required property var modelData
                            width: tplBtnLbl.implicitWidth + 8
                            height: 22
                            radius: 3
                            readonly property bool isSel: settings && settings.renderTitleOverlay === modelData.overlay && (!modelData.overlay || settings.autoRenderTitleTemplate === modelData.val)
                            color: isSel ? Theme.accent : Theme.surface
                            border.color: Theme.border; border.width: 1
                            Label {
                                id: tplBtnLbl
                                anchors.centerIn: parent
                                text: tplBtn.modelData.label
                                font.pixelSize: 10
                                color: tplBtn.isSel ? "#000" : Theme.textMuted
                                font.bold: tplBtn.isSel
                            }
                            MouseArea {
                                anchors.fill: parent
                                cursorShape: Qt.PointingHandCursor
                                onClicked: {
                                    if (settings) {
                                        settings.renderTitleOverlay = tplBtn.modelData.overlay;
                                        if (tplBtn.modelData.val !== "") {
                                            settings.autoRenderTitleTemplate = tplBtn.modelData.val;
                                            tplQuickInput.text = tplBtn.modelData.val;
                                        }
                                        card.syncSplitSettings();
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // ═══ BƯỚC 4: TỰ ĐỘNG ĐĂNG TIKTOK QUA ADSPOWER (CHUẨN ADSPOW) ══
            RowLayout {
                spacing: 6
                Layout.fillWidth: true
                Rectangle {
                    width: 20; height: 20; radius: 10; color: Theme.accent
                    Label { anchors.centerIn: parent; text: "4"; color: "#000"; font.pixelSize: 11; font.bold: true }
                }
                Label {
                    text: "Đăng TikTok qua AdsPower"
                    color: Theme.text; font.pixelSize: Theme.textMd; font.bold: true
                }
                HelpTip {
                    text: "Cơ chế cuốn chiếu chuẩn AdsPow: Video hoặc từng Part render xong là AdsPower tự động nạp file vào TikTok Studio và bấm đăng ngay lập tức."
                }
            }
            ColumnLayout {
                Layout.preferredWidth: 320
                Layout.alignment: Qt.AlignRight
                spacing: 4

                RowLayout {
                    Layout.fillWidth: true
                    spacing: 8
                    Switch {
                        id: ttSwitch
                        checked: settings ? Boolean(settings.tiktokUploadEnabled) : false
                        onToggled: {
                            if (settings) {
                                settings.tiktokUploadEnabled = checked;
                                card.syncSplitSettings();
                            }
                        }
                    }
                    Label {
                        text: ttSwitch.checked ? "BẬT (Xong part nào đăng ngay)" : "TẮT (Chỉ render lưu máy)"
                        color: ttSwitch.checked ? Theme.success : Theme.warning
                        font.pixelSize: Theme.textMd
                        font.bold: true
                        Layout.fillWidth: true
                    }
                }

                RowLayout {
                    spacing: 6
                    Layout.alignment: Qt.AlignRight

                    // Trạng thái AdsPower Local API (Có timer polling tự động)
                    Rectangle {
                        width: 8; height: 8; radius: 4
                        color: card.adsPowerOnline ? Theme.success : Theme.error
                    }
                    Label {
                        text: card.adsPowerOnline ? "AdsPower: Online (Port 50325)" : "AdsPower: Chưa kết nối"
                        color: card.adsPowerOnline ? Theme.success : Theme.error
                        font.pixelSize: 10
                    }

                    Item { width: 4 }

                    Label {
                        text: "FastDone:"
                        color: Theme.textMuted
                        font.pixelSize: 11
                    }
                    HelpTip {
                        text: "FastDone: Bỏ qua thời gian chờ xác nhận cuối để đẩy tốc độ hoàn tất đăng siêu tốc (<0.5s)."
                    }
                    Switch {
                        checked: (settings && typeof settings.tiktokFastDone !== "undefined") ? Boolean(settings.tiktokFastDone) : true
                        onToggled: {
                            if (settings) {
                                settings.tiktokFastDone = checked;
                                card.syncSplitSettings();
                            }
                        }
                    }
                }
            }
        }
    }
}
