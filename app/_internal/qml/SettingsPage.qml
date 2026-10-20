// src/ui/qml/SettingsPage.qml
// Streamlined Tab-based Settings with persistent action bar, clean categorisation and diagnostics.
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Rectangle {
    id: page
    color: Theme.bg

    property int currentTab: 0 // 0: Storage, 1: Download & Render, 2: Detection, 3: Accounts, 4: Diagnostics

    onVisibleChanged: {
        if (visible) {
            Qt.callLater(settings.load_from_backend, backend)
        }
    }

    ColumnLayout {
        anchors.fill: parent
        spacing: 0

        // ─── Header & Global Action Bar (Sticky Top) ──────────────────────
        Rectangle {
            Layout.fillWidth: true
            Layout.preferredHeight: 64
            color: Theme.cardBg
            border.color: Theme.border
            border.width: 0

            Rectangle {
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.bottom: parent.bottom
                height: 1
                color: Theme.border
            }

            RowLayout {
                anchors.fill: parent
                anchors.leftMargin: 20
                anchors.rightMargin: 20
                spacing: 16

                Rectangle {
                    width: 36
                    height: 36
                    radius: 18
                    color: Theme.accent + "25"
                    border.color: Theme.accent + "66"
                    border.width: 1

                    Icon {
                        anchors.centerIn: parent
                        name: "settings"
                        size: 18
                        color: Theme.accent
                    }
                }

                ColumnLayout {
                    spacing: 2
                    Label {
                        text: "CÀI ĐẶT HỆ THỐNG"
                        color: Theme.text
                        font.pixelSize: 15
                        font.bold: true
                    }
                    Label {
                        text: "Tùy chỉnh lưu trữ, chất lượng tải, kênh tự động và chẩn đoán phần cứng"
                        color: Theme.textMuted
                        font.pixelSize: 11
                    }
                }

                Item { Layout.fillWidth: true }

                // Dirty state badge
                Rectangle {
                    Layout.preferredHeight: 26
                    Layout.preferredWidth: (typeof dirtyLabel !== "undefined" && dirtyLabel) ? (dirtyLabel.implicitWidth + 16) : 80
                    radius: Theme.radiusMd
                    color: (settings && settings.dirty) ? Theme.warning + "20" : Theme.success + "20"
                    border.color: (settings && settings.dirty) ? Theme.warning : Theme.success
                    border.width: 1

                    RowLayout {
                        anchors.centerIn: parent
                        spacing: 6
                        Icon {
                            name: (settings && settings.dirty) ? "warning" : "check"
                            size: 10
                            color: (settings && settings.dirty) ? Theme.warning : Theme.success
                        }
                        Label {
                            id: dirtyLabel
                            text: (settings && settings.dirty) ? "Có thay đổi chưa lưu" : "Đã lưu đồng bộ"
                            color: (settings && settings.dirty) ? Theme.warning : Theme.success
                            font.pixelSize: 11
                            font.bold: true
                        }
                    }
                }

                // Reload button
                IconButton {
                    iconName: "refresh"
                    label: "Tải lại"
                    iconSize: 12
                    tooltipText: "Khôi phục cài đặt gần nhất"
                    onClicked: {
                        settings.load_from_backend(backend)
                        if (typeof toastService !== 'undefined' && toastService) {
                            toastService.show("Đã tải lại", "Đã khôi phục cài đặt gần nhất", "info")
                        }
                    }
                }

                // Save button (High visibility accent)
                Rectangle {
                    Layout.preferredWidth: 120
                    Layout.preferredHeight: 34
                    radius: Theme.radiusMd
                    color: saveMa.containsMouse ? Theme.accentHover : Theme.accent

                    RowLayout {
                        anchors.centerIn: parent
                        spacing: 6
                        Icon {
                            name: "check"
                            size: 13
                            color: "#FFFFFF"
                        }
                        Label {
                            text: "Lưu Cài Đặt"
                            color: "#FFFFFF"
                            font.pixelSize: 12
                            font.bold: true
                        }
                    }

                    MouseArea {
                        id: saveMa
                        anchors.fill: parent
                        hoverEnabled: true
                        cursorShape: Qt.PointingHandCursor
                        onClicked: {
                            if (settings.save_to_backend(backend)) {
                                if (typeof toastService !== 'undefined' && toastService) {
                                    toastService.show("Đã lưu", "Cài đặt đã được lưu thành công", "success")
                                }
                            } else {
                                if (typeof toastService !== 'undefined' && toastService) {
                                    toastService.show("Lỗi", "Không thể lưu cài đặt", "error")
                                }
                            }
                        }
                    }
                }
            }
        }

        // ─── Modern Tab Navigation Bar ────────────────────────────────────
        Rectangle {
            Layout.fillWidth: true
            Layout.preferredHeight: 44
            color: Theme.inputBg

            Rectangle {
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.bottom: parent.bottom
                height: 1
                color: Theme.border
            }

            RowLayout {
                anchors.fill: parent
                anchors.leftMargin: 20
                anchors.rightMargin: 20
                spacing: 8

                Repeater {
                    model: [
                        {tab: 0, label: "Lưu trữ & Hệ thống", icon: "folder"},
                        {tab: 1, label: "Tải & Render Video", icon: "render"},
                        {tab: 2, label: "Kênh & Dò Quét", icon: "bolt"},
                        {tab: 3, label: "Tài khoản & Nền tảng", icon: "info"},
                        {tab: 4, label: "Chẩn đoán & Cập nhật", icon: "settings"}
                    ]
                    delegate: Rectangle {
                        readonly property bool active: page.currentTab === modelData.tab
                        Layout.preferredHeight: 32
                        Layout.preferredWidth: tabText.implicitWidth + 28
                        radius: Theme.radiusMd
                        color: active ? Theme.cardBg : (tabMa.containsMouse ? Theme.hoverBg : "transparent")
                        border.color: active ? Theme.border : "transparent"
                        border.width: 1

                        RowLayout {
                            anchors.centerIn: parent
                            spacing: 6
                            Icon {
                                name: modelData.icon
                                size: 12
                                color: active ? Theme.accent : Theme.textMuted
                            }
                            Label {
                                id: tabText
                                text: modelData.label
                                color: active ? Theme.text : Theme.textMuted
                                font.pixelSize: 12
                                font.bold: active
                            }
                        }

                        // Bottom active indicator
                        Rectangle {
                            anchors.left: parent.left
                            anchors.right: parent.right
                            anchors.bottom: parent.bottom
                            height: 2
                            color: Theme.accent
                            visible: active
                        }

                        MouseArea {
                            id: tabMa
                            anchors.fill: parent
                            hoverEnabled: true
                            cursorShape: Qt.PointingHandCursor
                            onClicked: page.currentTab = modelData.tab
                        }
                    }
                }

                Item { Layout.fillWidth: true }
            }
        }

        // ─── Tab Content Area (StackLayout) ───────────────────────────────
        StackLayout {
            Layout.fillWidth: true
            Layout.fillHeight: true
            currentIndex: page.currentTab

            // Tab 0: Storage & Hardware Profile
            ScrollView {
                clip: true
                ColumnLayout {
                    width: page.width - 40
                    x: 20; y: 16
                    spacing: Theme.spacingLg

                    StorageCard { Layout.fillWidth: true }
                    ProxySettingsCard { Layout.fillWidth: true }
                    HardwareProfileCard { Layout.fillWidth: true }
                    Item { Layout.preferredHeight: 24 }
                }
            }

            // Tab 1: Download & Render Video
            ScrollView {
                clip: true
                ColumnLayout {
                    width: page.width - 40
                    x: 20; y: 16
                    spacing: Theme.spacingLg

                    DownloadCard { Layout.fillWidth: true }
                    AutoRenderCard { Layout.fillWidth: true }
                    Item { Layout.preferredHeight: 24 }
                }
            }

            // Tab 2: Channels & Detection
            ScrollView {
                clip: true
                ColumnLayout {
                    width: page.width - 40
                    x: 20; y: 16
                    spacing: Theme.spacingLg

                    DetectionPanel { Layout.fillWidth: true }
                    Item { Layout.preferredHeight: 24 }
                }
            }

            // Tab 3: Accounts & TikTok
            ScrollView {
                clip: true
                ColumnLayout {
                    width: page.width - 40
                    x: 20; y: 16
                    spacing: Theme.spacingLg

                    AuthPanel { Layout.fillWidth: true; Layout.preferredHeight: 280 }
                    Item { Layout.preferredHeight: 24 }
                }
            }

            // Tab 4: Diagnostics & Remote Updates (Vercel)
            ScrollView {
                clip: true
                ColumnLayout {
                    width: page.width - 40
                    x: 20; y: 16
                    spacing: Theme.spacingLg

                    // Diagnostics & Troubleshoot
                    Rectangle {
                        id: diagCard
                        Layout.fillWidth: true
                        Layout.preferredHeight: diagCol.implicitHeight + 32
                        color: Theme.cardBg
                        border.color: diagResult ? (diagResult.status === "error" ? Theme.error : diagResult.status === "warning" ? "#FFB800" : Theme.success) : Theme.border
                        border.width: 1
                        radius: Theme.radiusLg

                        property var diagResult: null
                        property bool isRunning: false
                        property string statusText: "Sẵn sàng chẩn đoán toàn diện hệ thống"

                        ColumnLayout {
                            id: diagCol
                            anchors.fill: parent
                            anchors.margins: 16
                            spacing: Theme.spacingMd

                            // Header row
                            RowLayout {
                                spacing: 8
                                Icon { 
                                    name: "settings"
                                    size: 14
                                    color: diagCard.diagResult ? (diagCard.diagResult.status === "error" ? Theme.error : diagCard.diagResult.status === "warning" ? "#FFB800" : Theme.success) : Theme.accent 
                                }
                                Label {
                                    text: "KHẮC PHỤC SỰ CỐ & CHẨN ĐOÁN TOÀN DIỆN"
                                    color: Theme.accent
                                    font.pixelSize: Theme.textSm
                                    font.bold: true
                                    font.letterSpacing: 0.5
                                }
                                Item { Layout.fillWidth: true }
                                Label {
                                    text: diagCard.statusText
                                    color: Theme.textMuted
                                    font.pixelSize: 11
                                }
                                Button {
                                    text: diagCard.isRunning ? "Đang quét..." : "Chạy chẩn đoán ngay"
                                    highlighted: true
                                    enabled: !diagCard.isRunning
                                    onClicked: {
                                        diagCard.isRunning = true;
                                        diagCard.statusText = "Đang kiểm tra phần cứng, GPU, Quota, Cookies, Công cụ & Đám mây...";
                                        if (typeof toastService !== 'undefined' && toastService) {
                                            toastService.show("Chẩn đoán", "Bắt đầu quét toàn diện hệ thống...", "info");
                                        }
                                        var resp = backend.send_command("system:runDiagnostics");
                                        diagCard.isRunning = false;
                                        if (resp) {
                                            diagCard.diagResult = resp;
                                            diagCard.statusText = "Hoàn tất lúc " + Qt.formatTime(new Date(), "hh:mm:ss");
                                            if (typeof toastService !== 'undefined' && toastService) {
                                                var isOk = resp.status === "healthy";
                                                var isWarn = resp.status === "warning";
                                                toastService.show(
                                                    "Chẩn đoán hệ thống",
                                                    resp.summary || (isOk ? "Hệ thống hoạt động hoàn hảo!" : "Phát hiện vấn đề cần lưu ý"),
                                                    isOk ? "success" : (isWarn ? "warn" : "error")
                                                );
                                            }
                                        } else {
                                            diagCard.statusText = "Lỗi: Không nhận được phản hồi từ backend";
                                        }
                                    }
                                }
                            }

                            // Introductory label
                            Label {
                                visible: !diagCard.diagResult
                                text: "Bấm 'Chạy chẩn đoán ngay' để kiểm tra tự động 6 thành phần: Card đồ họa (NVENC), Google Cloud API Quota, Cookie Chrome YouTube, công cụ yt-dlp & FFmpeg, và kết nối máy chủ giám sát Vercel."
                                color: Theme.textMuted
                                font.pixelSize: 12
                                wrapMode: Text.Wrap
                                Layout.fillWidth: true
                            }

                            // Overall Status Banner
                            Rectangle {
                                Layout.fillWidth: true
                                Layout.preferredHeight: bannerCol.implicitHeight + 20
                                visible: !!diagCard.diagResult
                                radius: 6
                                color: {
                                    if (!diagCard.diagResult) return "transparent";
                                    if (diagCard.diagResult.status === "healthy") return Qt.rgba(0, 1, 0.5, 0.1);
                                    if (diagCard.diagResult.status === "warning") return Qt.rgba(1, 0.72, 0, 0.1);
                                    return Qt.rgba(1, 0.27, 0.27, 0.1);
                                }
                                border.color: {
                                    if (!diagCard.diagResult) return Theme.border;
                                    if (diagCard.diagResult.status === "healthy") return Theme.success;
                                    if (diagCard.diagResult.status === "warning") return "#FFB800";
                                    return Theme.error;
                                }
                                border.width: 1

                                RowLayout {
                                    anchors.fill: parent
                                    anchors.margins: 12
                                    spacing: 12

                                    Rectangle {
                                        width: 36
                                        height: 36
                                        radius: 18
                                        color: {
                                            if (!diagCard.diagResult) return "transparent";
                                            if (diagCard.diagResult.status === "healthy") return Qt.rgba(0, 1, 0.5, 0.2);
                                            if (diagCard.diagResult.status === "warning") return Qt.rgba(1, 0.72, 0, 0.2);
                                            return Qt.rgba(1, 0.27, 0.27, 0.2);
                                        }
                                        Icon {
                                            anchors.centerIn: parent
                                            name: {
                                                if (!diagCard.diagResult) return "info";
                                                if (diagCard.diagResult.status === "healthy") return "check";
                                                if (diagCard.diagResult.status === "warning") return "warning";
                                                return "error";
                                            }
                                            size: 16
                                            color: {
                                                if (!diagCard.diagResult) return Theme.text;
                                                if (diagCard.diagResult.status === "healthy") return Theme.success;
                                                if (diagCard.diagResult.status === "warning") return "#FFB800";
                                                return Theme.error;
                                            }
                                        }
                                    }

                                    ColumnLayout {
                                        id: bannerCol
                                        Layout.fillWidth: true
                                        spacing: 2

                                        Label {
                                            text: {
                                                if (!diagCard.diagResult) return "";
                                                if (diagCard.diagResult.status === "healthy") return "TRẠNG THÁI: TẤT CẢ HỆ THỐNG HOẠT ĐỘNG HOÀN HẢO";
                                                if (diagCard.diagResult.status === "warning") return "TRẠNG THÁI: HỆ THỐNG CƠ BẢN ỔN ĐỊNH (CÓ CẢNH BÁO)";
                                                return "TRẠNG THÁI: PHÁT HIỆN LỖI CẦN KHẮC PHỤC NGAY";
                                            }
                                            color: {
                                                if (!diagCard.diagResult) return Theme.text;
                                                if (diagCard.diagResult.status === "healthy") return Theme.success;
                                                if (diagCard.diagResult.status === "warning") return "#FFB800";
                                                return Theme.error;
                                            }
                                            font.pixelSize: 13
                                            font.bold: true
                                        }

                                        Label {
                                            text: diagCard.diagResult ? (diagCard.diagResult.summary || "") : ""
                                            color: Theme.text
                                            font.pixelSize: 12
                                            wrapMode: Text.Wrap
                                            Layout.fillWidth: true
                                        }
                                    }
                                }
                            }

                            // 6 Check Cards Grid
                            GridLayout {
                                Layout.fillWidth: true
                                columns: 2
                                columnSpacing: 12
                                rowSpacing: 10
                                visible: !!diagCard.diagResult && !!diagCard.diagResult.checks && diagCard.diagResult.checks.length > 0

                                Repeater {
                                    model: (diagCard.diagResult && diagCard.diagResult.checks) ? diagCard.diagResult.checks : []
                                    delegate: Rectangle {
                                        Layout.fillWidth: true
                                        Layout.preferredHeight: 74
                                        color: Theme.inputBg
                                        border.color: modelData.type === "error" ? Theme.error : modelData.type === "warning" ? "#FFB800" : Theme.border
                                        border.width: 1
                                        radius: 6

                                        RowLayout {
                                            anchors.fill: parent
                                            anchors.margins: 10
                                            spacing: 10

                                            Rectangle {
                                                width: 32
                                                height: 32
                                                radius: 16
                                                color: modelData.type === "error" ? Qt.rgba(1, 0.2, 0.2, 0.15) : modelData.type === "warning" ? Qt.rgba(1, 0.72, 0, 0.15) : Qt.rgba(0, 1, 0.5, 0.15)
                                                Icon {
                                                    anchors.centerIn: parent
                                                    name: modelData.type === "error" ? "error" : modelData.type === "warning" ? "warning" : "check"
                                                    size: 14
                                                    color: modelData.type === "error" ? Theme.error : modelData.type === "warning" ? "#FFB800" : Theme.success
                                                }
                                            }

                                            ColumnLayout {
                                                Layout.fillWidth: true
                                                spacing: 2

                                                Label {
                                                    text: modelData.title || ""
                                                    color: Theme.text
                                                    font.pixelSize: 12
                                                    font.bold: true
                                                }

                                                Label {
                                                    text: modelData.detail || ""
                                                    color: Theme.textMuted
                                                    font.pixelSize: 11
                                                    wrapMode: Text.Wrap
                                                    Layout.fillWidth: true
                                                    maximumLineCount: 2
                                                    elide: Text.ElideRight
                                                }
                                            }
                                        }
                                    }
                                }
                            }

                            // Diagnostic Bundle Box
                            Rectangle {
                                Layout.fillWidth: true
                                Layout.preferredHeight: 44
                                visible: !!diagCard.diagResult && !!diagCard.diagResult.bundlePath
                                color: Qt.rgba(0, 0, 0, 0.25)
                                border.color: Theme.border
                                border.width: 1
                                radius: 6

                                RowLayout {
                                    anchors.fill: parent
                                    anchors.leftMargin: 12
                                    anchors.rightMargin: 8
                                    spacing: 8

                                    Icon { name: "folder"; size: 14; color: Theme.accent }

                                    Label {
                                        text: "Tệp chẩn đoán chi tiết (JSON): " + (diagCard.diagResult ? diagCard.diagResult.bundlePath : "")
                                        color: Theme.textMuted
                                        font.pixelSize: 11
                                        Layout.fillWidth: true
                                        elide: Text.ElideMiddle
                                    }

                                    Button {
                                        text: "Mở thư mục"
                                        onClicked: {
                                            if (diagCard.diagResult && diagCard.diagResult.bundlePath) {
                                                backend.send_command_async("system:openFolder", {"path": diagCard.diagResult.bundlePath});
                                            }
                                        }
                                    }

                                    Button {
                                        text: "Gửi log lên Vercel"
                                        onClicked: {
                                            var resp = backend.send_command("logs:uploadNow");
                                            if (resp && resp.success) {
                                                if (typeof toastService !== 'undefined' && toastService) {
                                                    toastService.show("Giám sát từ xa", "Đã gửi " + resp.lines + " dòng log lên Vercel thành công!", "success");
                                                }
                                            } else {
                                                if (typeof toastService !== 'undefined' && toastService) {
                                                    toastService.show("Giám sát từ xa", (resp && resp.error) ? resp.error : "Lỗi gửi log", "error");
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }

                    // Software Update & Remote Telemetry (Vercel)
                    Rectangle {
                        id: updateCard
                        Layout.fillWidth: true
                        Layout.preferredHeight: updateCol.implicitHeight + 32
                        color: Theme.cardBg
                        border.color: updateAvailable ? Theme.accent : Theme.border
                        border.width: 1
                        radius: Theme.radiusLg

                        property string currentVersion: "3.0.0"
                        property string latestVersion: ""
                        property bool updateAvailable: false
                        property string releaseNotes: ""
                        property string downloadUrl: ""
                        property int downloadSize: 0
                        property int downloadProgress: 0
                        property bool isDownloading: false
                        property bool isReadyToInstall: false
                        property string statusMessage: "Sẵn sàng kiểm tra"
                        property string serverUrl: (settings && settings.updateServerUrl) ? settings.updateServerUrl : "https://vercel-updater-neon.vercel.app"
                        property string customerId: (settings && settings.customerId) ? settings.customerId : "rtx5070-jp"

                        Component.onCompleted: {
                            if (typeof backend !== "undefined" && backend && backend.send_command) {
                                var resp = backend.send_command("update:status");
                                if (resp) {
                                    if (resp.currentVersion) updateCard.currentVersion = resp.currentVersion;
                                    if (resp.available) updateCard.updateAvailable = resp.available;
                                    if (resp.version) updateCard.latestVersion = resp.version;
                                    if (resp.downloaded) updateCard.isReadyToInstall = true;
                                    if (resp.releaseNotes) updateCard.releaseNotes = resp.releaseNotes;
                                }
                            }
                        }

                        Connections {
                            target: typeof eventBus !== 'undefined' ? eventBus : null
                            function onUpdate_progress(params) {
                                if (params) {
                                    updateCard.downloadProgress = params.percent || 0;
                                    updateCard.isDownloading = true;
                                    updateCard.statusMessage = "Đang tải bản vá: " + updateCard.downloadProgress + "%...";
                                }
                            }
                            function onUpdate_ready(params) {
                                updateCard.isDownloading = false;
                                updateCard.isReadyToInstall = true;
                                updateCard.statusMessage = "Bản vá đã tải xong! Bấm Khởi động lại để hoàn tất.";
                                if (typeof toastService !== 'undefined' && toastService) {
                                    toastService.show("Bản vá sẵn sàng", "Đã tải xong bản cập nhật! Bấm Cài đặt để khởi động lại.", "success");
                                }
                            }
                        }

                        ColumnLayout {
                            id: updateCol
                            anchors.fill: parent
                            anchors.margins: 16
                            spacing: Theme.spacingMd

                            // Header row
                            RowLayout {
                                spacing: 8
                                Icon { name: "upload"; size: 14; color: updateCard.updateAvailable ? Theme.accent : Theme.textMuted }
                                Label {
                                    text: "CẬP NHẬT TỰ ĐỘNG & GIÁM SÁT TỪ XA (VERCEL)"
                                    color: updateCard.updateAvailable ? Theme.accent : Theme.text
                                    font.pixelSize: Theme.textSm
                                    font.bold: true
                                    font.letterSpacing: 0.5
                                }
                                Item { Layout.fillWidth: true }
                                Rectangle {
                                    Layout.preferredHeight: 20
                                    Layout.preferredWidth: verBadge.implicitWidth + 12
                                    radius: 4
                                    color: updateCard.updateAvailable ? Qt.rgba(0, 0.898, 1, 0.15) : Qt.rgba(1, 1, 1, 0.05)
                                    border.color: updateCard.updateAvailable ? Theme.accent : Theme.border
                                    border.width: 1
                                    Label {
                                        id: verBadge
                                        anchors.centerIn: parent
                                        text: "v" + updateCard.currentVersion + (updateCard.updateAvailable ? " ➔ v" + updateCard.latestVersion : " (Mới nhất)")
                                        color: updateCard.updateAvailable ? Theme.accent : Theme.textMuted
                                        font.pixelSize: 10
                                        font.bold: true
                                    }
                                }
                            }

                            // Configuration row: Server URL & Customer ID
                            RowLayout {
                                Layout.fillWidth: true
                                spacing: 12

                                ColumnLayout {
                                    Layout.fillWidth: true
                                    Layout.preferredWidth: 2
                                    spacing: 4
                                    Label {
                                        text: "Địa chỉ máy chủ phân phối & Telemetry (Vercel):"
                                        color: Theme.textMuted
                                        font.pixelSize: 11
                                    }
                                    TextField {
                                        id: serverInput
                                        Layout.fillWidth: true
                                        text: updateCard.serverUrl
                                        font.pixelSize: 11
                                        selectByMouse: true
                                        onEditingFinished: {
                                            updateCard.serverUrl = text.trim();
                                            if (settings) settings.updateServerUrl = updateCard.serverUrl;
                                        }
                                    }
                                }

                                ColumnLayout {
                                    Layout.fillWidth: true
                                    Layout.preferredWidth: 1
                                    spacing: 4
                                    Label {
                                        text: "Mã định danh máy (Customer ID):"
                                        color: Theme.textMuted
                                        font.pixelSize: 11
                                    }
                                    TextField {
                                        id: custInput
                                        Layout.fillWidth: true
                                        text: updateCard.customerId
                                        font.pixelSize: 11
                                        selectByMouse: true
                                        onEditingFinished: {
                                            updateCard.customerId = text.trim();
                                            if (settings) settings.customerId = updateCard.customerId;
                                        }
                                    }
                                }
                            }

                            // Progress bar
                            ColumnLayout {
                                Layout.fillWidth: true
                                visible: updateCard.isDownloading
                                spacing: 4

                                RowLayout {
                                    Layout.fillWidth: true
                                    Label {
                                        text: updateCard.statusMessage
                                        color: Theme.accent
                                        font.pixelSize: 11
                                        font.bold: true
                                    }
                                    Item { Layout.fillWidth: true }
                                    Label {
                                        text: updateCard.downloadProgress + "%"
                                        color: Theme.accent
                                        font.pixelSize: 11
                                        font.bold: true
                                    }
                                }

                                ProgressBar {
                                    Layout.fillWidth: true
                                    from: 0
                                    to: 100
                                    value: updateCard.downloadProgress
                                }
                            }

                            // Action buttons
                            RowLayout {
                                Layout.fillWidth: true
                                spacing: 8

                                Label {
                                    text: updateCard.statusMessage
                                    color: updateCard.updateAvailable ? Theme.accent : Theme.textMuted
                                    font.pixelSize: 11
                                    Layout.fillWidth: true
                                    elide: Text.ElideRight
                                }

                                Button {
                                    text: "Gửi log phiên ngay"
                                    onClicked: {
                                        updateCard.statusMessage = "Đang gửi log phiên lên Vercel...";
                                        var resp = backend.send_command("logs:uploadNow");
                                        if (resp && resp.success) {
                                            updateCard.statusMessage = "Đã đồng bộ " + (resp.lines || 0) + " dòng (" + (resp.filename || "") + ") lên Vercel [HTTP " + (resp.statusCode || 200) + "] lúc " + Qt.formatTime(new Date(), "hh:mm:ss");
                                            if (typeof toastService !== 'undefined' && toastService) {
                                                toastService.show("Giám sát từ xa", "Đã gửi " + resp.lines + " dòng log lên Vercel thành công!", "success");
                                            }
                                        } else {
                                            var err = (resp && resp.error) ? resp.error : "Không thể kết nối máy chủ";
                                            updateCard.statusMessage = "Lỗi gửi log: " + err;
                                            if (typeof toastService !== 'undefined' && toastService) {
                                                toastService.show("Giám sát từ xa", err, "error");
                                            }
                                        }
                                    }
                                }

                                Button {
                                    text: "Xem Web Giám sát"
                                    onClicked: {
                                        backend.send_command_async("system:openUrl", {"url": updateCard.serverUrl});
                                    }
                                }

                                Button {
                                    text: "Kiểm tra cập nhật"
                                    visible: !updateCard.isReadyToInstall && !updateCard.isDownloading
                                    onClicked: {
                                        updateCard.statusMessage = "Đang kết nối tới " + updateCard.serverUrl + "...";
                                        var resp = backend.send_command("update:check", {"server": updateCard.serverUrl});
                                        if (resp) {
                                            if (resp.offline) {
                                                updateCard.statusMessage = resp.error || "Không thể kết nối máy chủ cập nhật.";
                                                if (typeof toastService !== 'undefined' && toastService) {
                                                    toastService.show("Cập nhật", "Không thể kết nối máy chủ.", "warn");
                                                }
                                            } else if (resp.available) {
                                                updateCard.updateAvailable = true;
                                                updateCard.latestVersion = resp.version || "3.0.0";
                                                updateCard.releaseNotes = resp.releaseNotes || "";
                                                updateCard.statusMessage = "Phát hiện bản mới v" + updateCard.latestVersion + "!";
                                                if (typeof toastService !== 'undefined' && toastService) {
                                                    toastService.show("Cập nhật mới", "Có bản vá mới v" + updateCard.latestVersion + "!", "success");
                                                }
                                            } else {
                                                updateCard.updateAvailable = false;
                                                updateCard.statusMessage = "Bạn đang dùng phiên bản mới nhất (v" + updateCard.currentVersion + ").";
                                                if (typeof toastService !== 'undefined' && toastService) {
                                                    toastService.show("Cập nhật", "Ứng dụng đang ở bản mới nhất.", "info");
                                                }
                                            }
                                        }
                                    }
                                }

                                Button {
                                    text: "Tải bản vá ngay"
                                    highlighted: true
                                    visible: updateCard.updateAvailable && !updateCard.isReadyToInstall && !updateCard.isDownloading
                                    onClicked: {
                                        updateCard.isDownloading = true;
                                        updateCard.statusMessage = "Đang tải bản vá ZIP...";
                                        backend.send_command("update:download");
                                    }
                                }

                                Button {
                                    text: "Cài đặt & Khởi động lại"
                                    highlighted: true
                                    visible: updateCard.isReadyToInstall
                                    onClicked: {
                                        if (typeof toastService !== 'undefined' && toastService) {
                                            toastService.show("Khởi động lại", "Đang áp dụng bản vá và khởi động lại HyperClip...", "info");
                                        }
                                        backend.send_command("update:install");
                                    }
                                }
                            }
                        }
                    }

                    Item { Layout.preferredHeight: 24 }
                }
            }
        }
    }
}
