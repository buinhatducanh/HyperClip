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
    property string splitMode: (settings && settings.autoSplitMode === "parts" && settings.autoSplitParts === 2)
                               ? "parts_2"
                               : ((settings && settings.autoSplitMode === "parts" && settings.autoSplitParts === 3 && !settings.autoSplitCustomP1)
                                  ? "parts_3"
                                  : "custom_p1")

    // Thời lượng Part 1 tùy chỉnh (mặc định 4 phút)
    property real customP1Val: {
        if (settings && typeof settings.autoSplitCustomP1 === "number" && settings.autoSplitCustomP1 > 0) {
            return settings.autoSplitCustomP1;
        }
        if (settings && typeof settings.autoSplitMinutes === "number" && settings.autoSplitMinutes > 0 && settings.autoSplitMinutes < 30) {
            return settings.autoSplitMinutes;
        }
        return 4.0;
    }

    // Tổng thời lượng video cắt tải về (mặc định 10 phút)
    readonly property real totalTrimMinutes: (settings && typeof settings.defaultTrimLimit === "number") ? settings.defaultTrimLimit : 10

    // Khi người dùng đổi tổng thời gian tải, tự động điều chỉnh Part 1 nếu bị vượt ngưỡng
    onTotalTrimMinutesChanged: {
        var maxP1 = Math.max(1, Math.floor(card.totalTrimMinutes * 0.7));
        if (card.customP1Val > maxP1) {
            card.customP1Val = maxP1;
            if (p1Spin) p1Spin.value = Math.round(maxP1);
        }
        card.syncSplitSettings();
    }

    // Tính toán số học chuẩn xác từng giây lẻ (Khắc phục BUG-03 & BUG-05)
    readonly property real p1Duration: Math.min(card.customP1Val, Math.max(1, card.totalTrimMinutes - 1))
    readonly property real remainMinutes: Math.max(0, Math.round((card.totalTrimMinutes - card.p1Duration) * 10) / 10)
    readonly property real p2Duration: (card.remainMinutes < 1.0) ? 0 : Math.round((card.remainMinutes / 2) * 10) / 10
    // Part 3 bù chính xác số dư còn lại để tổng 3 Part luôn bằng 100% totalTrimMinutes (Không bị trôi float)
    readonly property real p3Duration: (card.remainMinutes < 1.0) ? 0 : Math.max(0, Math.round((card.remainMinutes - card.p2Duration) * 10) / 10)

    // Helper format thời gian từ phút sang mm:ss (ví dụ: 2.5 phút -> "2:30")
    function formatTime(minVal) {
        var totalSec = Math.round(minVal * 60);
        var m = Math.floor(totalSec / 60);
        var s = totalSec % 60;
        return m + ":" + (s < 10 ? "0" : "") + s;
    }

    // Đồng bộ và lưu dữ liệu tức thì xuống backend & settings.json (Khắc phục BUG-01, BUG-04, BUG-06)
    function syncSplitSettings() {
        if (!settings) return;

        // Vô hiệu hóa TrimRotate để tránh xung đột ngầm ghi đè thời lượng tải (BUG-04)
        settings.trimRotateEnabled = false;

        if (splitMode === "custom_p1") {
            settings.autoSplitEnabled = true;
            // Ánh xạ sang "parts" để tương thích với enum lõi Rust backend (BUG-01)
            settings.autoSplitMode = "parts";
            settings.autoSplitParts = (card.remainMinutes >= 1.0) ? 3 : 1;
            settings.autoSplitMinutes = card.p1Duration;
            try { settings.autoSplitCustomP1 = card.p1Duration; } catch(e) {}
        } else if (splitMode === "parts_2") {
            settings.autoSplitEnabled = true;
            settings.autoSplitMode = "parts";
            settings.autoSplitParts = 2;
        } else if (splitMode === "parts_3") {
            settings.autoSplitEnabled = true;
            settings.autoSplitMode = "parts";
            settings.autoSplitParts = 3;
        }

        // Bắn command cập nhật runtime cho backend Rust
        if (typeof backend !== "undefined" && backend) {
            try {
                backend.send_command_async("settings:update", {
                    "defaultTrimLimit": settings.defaultTrimLimit,
                    "autoSplitEnabled": settings.autoSplitEnabled,
                    "autoSplitMode": settings.autoSplitMode,
                    "autoSplitMinutes": settings.autoSplitMinutes,
                    "autoSplitParts": settings.autoSplitParts,
                    "autoSplitCustomP1": card.p1Duration,
                    "autoSplitPart1Minutes": card.p1Duration,
                    "autoSplitRemainMinutes": card.p2Duration,
                    "trimRotateEnabled": false
                });
            } catch(e) {}

            // Tự động lưu vĩnh viễn vào settings.json trên đĩa cứng (BUG-06)
            try {
                if (typeof settings.save_to_backend === "function") {
                    settings.save_to_backend(backend);
                }
            } catch(e) {}
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
                        if (!settings || !settings.autoSplitEnabled) {
                            partStr = "1 Video đơn";
                        } else if (card.splitMode === "custom_p1") {
                            if (card.remainMinutes >= 1.0) {
                                partStr = "Chia 3 Part (P1: " + card.p1Duration + "p | P2: " + card.p2Duration + "p | P3: " + card.p3Duration + "p)";
                            } else {
                                partStr = "1 Video đơn (" + card.totalTrimMinutes + "p)";
                            }
                        } else {
                            partStr = "Chia " + (settings ? settings.autoSplitParts : 3) + " Part đều";
                        }
                        var renStr = "Render " + (settings ? settings.autoRenderResolution : "1080p") + " AdsPow";
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
                            { label: "12p", val: 12 },
                            { label: "15p", val: 15 },
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
                        checked: settings ? settings.autoSplitEnabled : true
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
                                 ? (card.remainMinutes >= 1.0
                                    ? ("Chia 3 Part (P1: " + card.p1Duration + "p | P2&3: " + card.p2Duration + "p)")
                                    : ("1 Video đơn (" + card.totalTrimMinutes + "p)"))
                                 : ("Chia đều " + (card.splitMode === "parts_2" ? "2" : "3") + " Part"))
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
                            to: Math.max(1, Math.min(30, Math.floor(card.totalTrimMinutes - 1)))
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

                    // Nút chọn nhanh cho Part 1
                    RowLayout {
                        spacing: 4
                        Layout.alignment: Qt.AlignRight
                        Repeater {
                            model: [
                                { label: "3p", val: 3 },
                                { label: "4p (Chuẩn TikTok)", val: 4 },
                                { label: "5p", val: 5 }
                            ]
                            delegate: Rectangle {
                                id: p1QuickBtn
                                required property var modelData
                                width: p1QuickLbl.implicitWidth + 8
                                height: 20
                                radius: 3
                                readonly property bool isSel: Math.round(card.customP1Val) === modelData.val
                                color: isSel ? Theme.accent : Theme.surface
                                border.color: Theme.border; border.width: 1
                                Label {
                                    id: p1QuickLbl
                                    anchors.centerIn: parent
                                    text: p1QuickBtn.modelData.label
                                    font.pixelSize: 9
                                    color: p1QuickBtn.isSel ? "#000" : Theme.textMuted
                                    font.bold: p1QuickBtn.isSel
                                }
                                MouseArea {
                                    anchors.fill: parent
                                    cursorShape: Qt.PointingHandCursor
                                    onClicked: {
                                        card.customP1Val = p1QuickBtn.modelData.val;
                                        p1Spin.value = p1QuickBtn.modelData.val;
                                        card.syncSplitSettings();
                                    }
                                }
                            }
                        }
                    }

                    // Thẻ đồ họa trực quan 3 Part (Visual Badges Row - Chuẩn mm:ss)
                    Rectangle {
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

                            // Trường hợp thời gian còn lại >= 1p: Chia 3 Part hoàn hảo
                            RowLayout {
                                visible: card.remainMinutes >= 1.0
                                Layout.fillWidth: true
                                spacing: 4

                                // Badge Part 1 (Ưu tiên đăng)
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
                                            text: "PART 1: " + card.p1Duration + "p (0:00 - " + card.formatTime(card.p1Duration) + ")"
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

                                // Badge Part 2 (Chia đôi)
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
                                            text: "PART 2: " + card.p2Duration + "p (" + card.formatTime(card.p1Duration) + " - " + card.formatTime(card.p1Duration + card.p2Duration) + ")"
                                            color: Theme.text
                                            font.pixelSize: 9
                                            font.bold: true
                                        }
                                        Label {
                                            Layout.alignment: Qt.AlignHCenter
                                            text: "Render nối tiếp"
                                            color: Theme.textMuted
                                            font.pixelSize: 8
                                        }
                                    }
                                }

                                Label { text: "➔"; color: Theme.textMuted; font.pixelSize: 10 }

                                // Badge Part 3 (Chia đôi)
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
                                            text: "PART 3: " + card.p3Duration + "p (" + card.formatTime(card.p1Duration + card.p2Duration) + " - " + card.formatTime(card.totalTrimMinutes) + ")"
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

                            // Trường hợp thời gian còn lại < 1p: Tự động bảo vệ thành 1 Video đơn
                            Rectangle {
                                visible: card.remainMinutes < 1.0
                                Layout.fillWidth: true
                                Layout.preferredHeight: 26
                                radius: 4
                                color: Theme.surface
                                border.color: Theme.warning
                                border.width: 1
                                Label {
                                    anchors.centerIn: parent
                                    text: "Phần còn lại quá ngắn (< 1p). Hệ thống xuất 1 Video đơn " + card.totalTrimMinutes + " phút để bảo đảm chất lượng."
                                    color: Theme.warning
                                    font.pixelSize: 9
                                }
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
                        Layout.preferredWidth: 100
                        font.pixelSize: Theme.textSm
                        model: ["1080p", "720p"]
                        currentIndex: settings ? Math.max(0, ["1080p", "720p"].indexOf(settings.autoRenderResolution)) : 0
                        onActivated: {
                            if (settings) {
                                settings.autoRenderResolution = model[currentIndex];
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
