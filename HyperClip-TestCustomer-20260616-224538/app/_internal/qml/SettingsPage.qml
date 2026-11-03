// src/ui/qml/SettingsPage.qml
// Consolidated settings page showing all panels in a single scrollable view.
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Rectangle {
    id: page
    color: Theme.bg

    // 20/08 (chốt sau 3 vòng thử): UI CŨ + đúng MỘT bổ sung — nút chuyển xem
    // cấu hình tải/render của làn "Video dài" hay làn "Shorts" (backend hai
    // làn Pass 91 giữ nguyên; Short vẫn tải 360p/render 720p x1.1 theo bộ
    // riêng). "long" → hai card cũ y nguyên; "short" → ShortsSettingsCard.
    //
    // Pass 104: cfgLane TỰ THEO cấu hình làn — bản Shorts-only mở trang là
    // thấy ngay bộ Shorts, không phải bấm chuyển; chỉ MỘT làn bật thì ẩn luôn
    // hàng nút chuyển cho gọn. Bấm tay (khi cả hai làn bật) vẫn thắng auto.
    property string cfgLaneManual: ""
    readonly property bool onlyShorts: Boolean(settings && settings.shortsEnabled && !settings.longEnabled)
    readonly property bool onlyLong: Boolean(settings && settings.longEnabled && !settings.shortsEnabled)
    readonly property string cfgLane: onlyShorts ? "short"
                                    : onlyLong ? "long"
                                    : (cfgLaneManual !== "" ? cfgLaneManual : "long")

    onVisibleChanged: {
        if (visible) {
            // Pass 104: ĐỪNG nạp lại khi còn thay đổi chưa lưu — bản cũ cứ rời
            // tab quay lại là sửa đổi bị lặng lẽ xoá sạch (nguồn "khó lưu" #1).
            if (!settings || !settings.dirty) {
                Qt.callLater(settings.load_from_backend, backend)
            }
        }
    }

    ScrollView {
        id: root
        anchors.fill: parent
        // Pass 104: chừa chỗ cho thanh lưu nổi — không che nội dung cuối trang.
        anchors.bottomMargin: saveBar.visible ? saveBar.height : 0
        clip: true

        ColumnLayout {
            width: root.width - Theme.spacingLg * 2
            spacing: Theme.spacingMd
            x: Theme.spacingLg
            y: Theme.spacingLg

            Label {
                text: "Cài đặt"
                color: Theme.text
                font.pixelSize: Theme.textXl
                font.bold: true
                Layout.fillWidth: true
                Layout.bottomMargin: Theme.spacingXs
            }

            RowLayout {
                Layout.fillWidth: true
                spacing: Theme.spacingMd
                DetectionPanel { Layout.fillWidth: true; Layout.preferredWidth: 1; Layout.fillHeight: true }
                AuthPanel { Layout.fillWidth: true; Layout.preferredWidth: 1; Layout.preferredHeight: 220; Layout.fillHeight: true }
            }

            // ─── Nút chuyển: đang chỉnh cấu hình tải/render cho làn nào ───
            // Pass 104: chỉ hiện khi CẢ HAI làn bật — một làn thì khỏi hỏi.
            RowLayout {
                visible: !page.onlyShorts && !page.onlyLong
                Layout.fillWidth: true
                spacing: 8
                Label {
                    text: "CẤU HÌNH TẢI & RENDER CHO:"
                    color: Theme.textMuted
                    font.pixelSize: Theme.textSm
                    font.bold: true
                    font.letterSpacing: 0.5
                }
                Repeater {
                    model: [
                        { key: "long",  label: "Video dài", color: "#5AA6FF" },
                        { key: "short", label: "Shorts",    color: "#FF66B3" }
                    ]
                    delegate: Rectangle {
                        id: lanePick
                        required property var modelData
                        readonly property bool on: page.cfgLane === modelData.key
                        Layout.preferredHeight: 26
                        Layout.preferredWidth: lanePickLbl.implicitWidth + 24
                        radius: 13
                        color: on ? Qt.rgba(Qt.color(modelData.color).r, Qt.color(modelData.color).g, Qt.color(modelData.color).b, 0.18) : "transparent"
                        border.color: on ? modelData.color : Theme.border
                        border.width: 1
                        Label {
                            id: lanePickLbl
                            anchors.centerIn: parent
                            text: lanePick.modelData.label
                            color: lanePick.on ? lanePick.modelData.color : Theme.textMuted
                            font.pixelSize: Theme.textMd
                            font.bold: lanePick.on
                        }
                        MouseArea {
                            anchors.fill: parent
                            cursorShape: Qt.PointingHandCursor
                            onClicked: page.cfgLaneManual = lanePick.modelData.key
                        }
                    }
                }
                Item { Layout.fillWidth: true }
                Label {
                    text: page.cfgLane === "short"
                        ? "Bộ số riêng của Short — đổi bên này không kéo Video dài theo."
                        : "Bộ số của video thường (như cũ)."
                    color: Theme.textMuted
                    font.pixelSize: 11
                }
            }
            // Bản một-làn: nhãn tĩnh thay hàng nút chuyển, biết mình đang ở đâu.
            Label {
                visible: page.onlyShorts || page.onlyLong
                text: page.onlyShorts ? "CẤU HÌNH TẢI & RENDER — LÀN SHORTS" : "CẤU HÌNH TẢI & RENDER — VIDEO DÀI"
                color: page.onlyShorts ? "#FF66B3" : "#5AA6FF"
                font.pixelSize: Theme.textSm
                font.bold: true
                font.letterSpacing: 0.5
            }

            // Video dài → hai card cũ Y NGUYÊN; Shorts → bộ card riêng của làn.
            RowLayout {
                visible: page.cfgLane === "long"
                Layout.fillWidth: true
                spacing: Theme.spacingMd
                DownloadCard { Layout.fillWidth: true; Layout.preferredWidth: 1; Layout.fillHeight: true }
                AutoRenderCard { Layout.fillWidth: true; Layout.preferredWidth: 1; Layout.fillHeight: true }
            }
            ShortsSettingsCard {
                visible: page.cfgLane === "short"
                Layout.fillWidth: true
            }

            StorageCard { Layout.fillWidth: true }

            ProxySettingsCard { Layout.fillWidth: true }

            HardwareProfileCard { Layout.fillWidth: true }

                        // Software Update & Remote Telemetry (1-Click Thong Minh)
            Rectangle {
                id: updateCard
                visible: false
                Layout.fillWidth: true
                Layout.preferredHeight: 0
                color: Theme.cardBg
                border.color: updateAvailable ? Theme.accent : Theme.border
                border.width: 1
                radius: Theme.radiusLg

                property string currentVersion: "3.1.4"
                property string latestVersion: ""
                property bool updateAvailable: false
                property string releaseNotes: ""
                property int downloadProgress: 0
                property bool isDownloading: false
                property bool isReadyToInstall: false
                property string statusMessage: "Sẵn sàng kiểm tra và cập nhật"
                property string serverUrl: (settings && settings.updateServerUrl) ? settings.updateServerUrl : "https://vercel-updater-neon.vercel.app"
                property string customerId: (settings && settings.customerId) ? settings.customerId : "rtx5070-jp"

                Component.onCompleted: {
                    if (typeof backend !== 'undefined' && backend) {
                        var resp = backend.send_command("update:status");
                        var data = (resp && resp.result) ? resp.result : resp;
                        if (data && data.currentVersion) {
                            updateCard.currentVersion = data.currentVersion;
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
                        updateCard.statusMessage = "Bản vá đã tải xong! Đang áp dụng và khởi động lại...";
                    }
                }

                ColumnLayout {
                    id: updateCol
                    anchors.fill: parent
                    anchors.margins: 16
                    spacing: Theme.spacingMd

                    RowLayout {
                        spacing: 8
                        Icon { name: "upload"; size: 14; color: updateCard.updateAvailable ? Theme.accent : Theme.textMuted }
                        Label {
                            text: "CẬP NHẬT PHẦN MỀM & GIÁM SÁT TỰ ĐỘNG (VERCEL)"
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

                    // Progress bar khi đang tải
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
                            }
                            Item { Layout.fillWidth: true }
                            Label {
                                text: updateCard.downloadProgress + "%"
                                color: Theme.accent
                                font.pixelSize: 11
                                font.bold: true
                            }
                        }
                        Rectangle {
                            Layout.fillWidth: true
                            height: 6
                            radius: 3
                            color: Theme.inputBg
                            Rectangle {
                                width: parent.width * (updateCard.downloadProgress / 100.0)
                                height: parent.height
                                radius: 3
                                color: Theme.accent
                            }
                        }
                    }

                    RowLayout {
                        spacing: 12
                        Layout.fillWidth: true

                        Label {
                            text: updateCard.statusMessage
                            color: Theme.textMuted
                            font.pixelSize: Theme.textMd
                            Layout.fillWidth: true
                        }

                        Button {
                            text: updateCard.isDownloading ? ("Đang tải bản vá (" + updateCard.downloadProgress + "%)...") : (updateCard.updateAvailable ? "⚡ Cập nhật ngay bản v" + updateCard.latestVersion : "⚡ Cập nhật 1-Click")
                            highlighted: true
                            enabled: !updateCard.isDownloading && !updateCard.isReadyToInstall
                            visible: !updateCard.isReadyToInstall
                            onClicked: {
                                updateCard.statusMessage = "Đang kết nối máy chủ cập nhật...";
                                if (typeof toastService !== 'undefined' && toastService) {
                                    toastService.show("Cập nhật 1-Click", "Đang kiểm tra và cập nhật ứng dụng...", "info");
                                }
                                var resp = backend.send_command("update:check", {"server": updateCard.serverUrl});
                                if (!resp || resp.ok === false || resp.offline || resp.error || resp.timeout) {
                                    updateCard.statusMessage = (resp && resp.error) ? resp.error : "Không thể kết nối máy chủ cập nhật (timeout).";
                                    if (typeof toastService !== 'undefined' && toastService) {
                                        toastService.show("Lỗi kết nối máy chủ", updateCard.statusMessage, "warn");
                                    }
                                    return;
                                }
                                var data = (resp && resp.result) ? resp.result : resp;
                                if (data && data.currentVersion) {
                                    updateCard.currentVersion = data.currentVersion;
                                }
                                if (data && data.available) {
                                    updateCard.updateAvailable = true;
                                    updateCard.latestVersion = data.version || "";
                                    updateCard.releaseNotes = data.releaseNotes || "";
                                    updateCard.isDownloading = true;
                                    updateCard.statusMessage = "Phát hiện bản mới v" + data.version + "! Đang tự động tải về...";
                                    if (typeof toastService !== 'undefined' && toastService) {
                                        toastService.show("Phát hiện bản mới", "Đang tự động tải bản vá v" + data.version + "...", "success");
                                    }
                                    backend.send_command("update:download");
                                } else {
                                    updateCard.updateAvailable = false;
                                    updateCard.statusMessage = "Bạn đang dùng phiên bản mới nhất (v" + updateCard.currentVersion + ").";
                                    if (typeof toastService !== 'undefined' && toastService) {
                                        toastService.show("Đã cập nhật", "Ứng dụng đang ở bản mới nhất (v" + updateCard.currentVersion + ").", "info");
                                    }
                                }
                            }
                        }

                        Button {
                            text: "Cài đặt & Khởi động lại ngay"
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

            // Diagnostics & Troubleshoot
            Rectangle {
                Layout.fillWidth: true
                Layout.preferredHeight: 110
                color: Theme.cardBg
                border.color: Theme.border
                border.width: 1
                radius: Theme.radiusLg

                ColumnLayout {
                    anchors.fill: parent
                    anchors.margins: 16
                    spacing: Theme.spacingMd

                    RowLayout {
                        spacing: 8
                        Icon { name: "settings"; size: 13; color: Theme.accent }
                        Label {
                            text: "KHẮC PHỤC SỰ CỐ & CHẨN ĐOÁN"
                            color: Theme.accent
                            font.pixelSize: Theme.textSm
                            font.bold: true
                            font.letterSpacing: 0.5
                        }
                    }

                    RowLayout {
                        spacing: 12
                        Layout.fillWidth: true
                        
                        Label {
                            text: "Chạy phân tích chẩn đoán hiệu suất và kết nối mạng backend."
                            color: Theme.textMuted
                            font.pixelSize: Theme.textMd
                            Layout.fillWidth: true
                        }

                        Button {
                            text: "Chạy chẩn đoán"
                            onClicked: {
                                backend.send_command_async("system:runDiagnostics")
                                if (typeof toastService !== 'undefined' && toastService) {
                                    toastService.show("Chẩn đoán", "Bắt đầu quét phần cứng hệ thống...", "info")
                                }
                            }
                        }
                    }
                }
            }

            // Action bar
            Rectangle {
                Layout.fillWidth: true
                Layout.topMargin: Theme.spacingSm
                Layout.preferredHeight: 48
                color: Theme.cardBg
                border.color: Theme.border
                border.width: 1
                radius: Theme.radiusLg

                RowLayout {
                    anchors.fill: parent
                    anchors.leftMargin: Theme.spacingLg
                    anchors.rightMargin: Theme.spacingLg
                    spacing: Theme.spacingSm

                    Button {
                        text: "Lưu"
                        highlighted: true
                        onClicked: {
                            if (settings.save_to_backend(backend)) {
                                toastService.show("Đã lưu", "Cài đặt đã được lưu thành công", "success")
                            } else {
                                toastService.show("Lỗi", "Không thể lưu cài đặt", "error")
                            }
                        }
                    }
                    Button {
                        text: "Tải lại"
                        onClicked: {
                            settings.load_from_backend(backend)
                            toastService.show("Đã tải lại", "Đã khôi phục cài đặt gần nhất", "info")
                        }
                    }
                    Item { Layout.fillWidth: true }
                }
            }

            // Bottom spacing margin to prevent overlapping scroll edge
            Item {
                Layout.preferredHeight: Theme.spacingLg
            }
        }
    }

    // ─── Pass 104: thanh LƯU NỔI — dính đáy trang, hiện NGAY khi có thay đổi
    // chưa lưu. Nguồn "khó lưu" #2: nút Lưu cũ nằm tận đáy trang cuộn dài,
    // khách sửa xong không thấy nút, rời tab là mất (nay reload đã có guard).
    Rectangle {
        id: saveBar
        visible: settings ? settings.dirty : false
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.bottom: parent.bottom
        height: 56
        color: Theme.cardBg
        border.color: Theme.accent
        border.width: 1

        RowLayout {
            anchors.fill: parent
            anchors.leftMargin: Theme.spacingLg
            anchors.rightMargin: Theme.spacingLg
            spacing: Theme.spacingMd

            Icon { name: "warning"; size: 14; color: Theme.warning }
            Label {
                text: "Có thay đổi CHƯA LƯU"
                color: Theme.text
                font.pixelSize: Theme.textMd
                font.bold: true
                Layout.fillWidth: true
            }
            Button {
                text: "Huỷ thay đổi"
                onClicked: {
                    settings.discard_changes()
                    toastService.show("Đã huỷ", "Khôi phục cài đặt đã lưu gần nhất", "info")
                }
            }
            Button {
                text: "Lưu cài đặt"
                highlighted: true
                onClicked: {
                    if (settings.save_to_backend(backend)) {
                        toastService.show("Đã lưu", "Cài đặt đã được lưu thành công", "success")
                    } else {
                        toastService.show("Lỗi", "Không thể lưu cài đặt", "error")
                    }
                }
            }
        }
    }
}

