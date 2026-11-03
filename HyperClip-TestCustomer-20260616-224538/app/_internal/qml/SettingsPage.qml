// src/ui/qml/SettingsPage.qml
// Consolidated settings page showing all panels in a single scrollable view.
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Rectangle {
    id: page
    color: Theme.bg

    // 20/08 (chá»‘t sau 3 vĂ²ng thá»­): UI CÅ¨ + Ä‘Ăºng Má»˜T bá»• sung â€” nĂºt chuyá»ƒn xem
    // cáº¥u hĂ¬nh táº£i/render cá»§a lĂ n "Video dĂ i" hay lĂ n "Shorts" (backend hai
    // lĂ n Pass 91 giá»¯ nguyĂªn; Short váº«n táº£i 360p/render 720p x1.1 theo bá»™
    // riĂªng). "long" â†’ hai card cÅ© y nguyĂªn; "short" â†’ ShortsSettingsCard.
    //
    // Pass 104: cfgLane Tá»° THEO cáº¥u hĂ¬nh lĂ n â€” báº£n Shorts-only má»Ÿ trang lĂ 
    // tháº¥y ngay bá»™ Shorts, khĂ´ng pháº£i báº¥m chuyá»ƒn; chá»‰ Má»˜T lĂ n báº­t thĂ¬ áº©n luĂ´n
    // hĂ ng nĂºt chuyá»ƒn cho gá»n. Báº¥m tay (khi cáº£ hai lĂ n báº­t) váº«n tháº¯ng auto.
    property string cfgLaneManual: ""
    readonly property bool onlyShorts: Boolean(settings && settings.shortsEnabled && !settings.longEnabled)
    readonly property bool onlyLong: Boolean(settings && settings.longEnabled && !settings.shortsEnabled)
    readonly property string cfgLane: onlyShorts ? "short"
                                    : onlyLong ? "long"
                                    : (cfgLaneManual !== "" ? cfgLaneManual : "long")

    onVisibleChanged: {
        if (visible) {
            // Pass 104: Äá»ªNG náº¡p láº¡i khi cĂ²n thay Ä‘á»•i chÆ°a lÆ°u â€” báº£n cÅ© cá»© rá»i
            // tab quay láº¡i lĂ  sá»­a Ä‘á»•i bá»‹ láº·ng láº½ xoĂ¡ sáº¡ch (nguá»“n "khĂ³ lÆ°u" #1).
            if (!settings || !settings.dirty) {
                Qt.callLater(settings.load_from_backend, backend)
            }
        }
    }

    ScrollView {
        id: root
        anchors.fill: parent
        // Pass 104: chá»«a chá»— cho thanh lÆ°u ná»•i â€” khĂ´ng che ná»™i dung cuá»‘i trang.
        anchors.bottomMargin: saveBar.visible ? saveBar.height : 0
        clip: true

        ColumnLayout {
            width: root.width - Theme.spacingLg * 2
            spacing: Theme.spacingMd
            x: Theme.spacingLg
            y: Theme.spacingLg

            Label {
                text: "CĂ i Ä‘áº·t"
                color: Theme.text
                font.pixelSize: Theme.textXl
                font.bold: true
                Layout.fillWidth: true
                Layout.bottomMargin: Theme.spacingXs
            }
            // ─── Tóm tắt quy trình tự động hóa E2E ───
            Rectangle {
                Layout.fillWidth: true
                Layout.preferredHeight: flowSummaryLayout.implicitHeight + 20
                radius: Theme.radiusLg
                color: Theme.cardBg
                border.color: Theme.border
                border.width: 1

                ColumnLayout {
                    id: flowSummaryLayout
                    anchors.fill: parent
                    anchors.margins: 12
                    spacing: 8

                    RowLayout {
                        Layout.fillWidth: true
                        spacing: 8
                        Label {
                            text: "QUY TRÌNH TỰ ĐỘNG HÓA E2E: TẢI ➔ TÁCH PART ➔ RENDER ➔ ĐĂNG TIKTOK"
                            color: Theme.accent
                            font.pixelSize: Theme.textSm
                            font.bold: true
                            font.letterSpacing: 0.5
                        }
                        Item { Layout.fillWidth: true }
                        Label {
                            text: "Đang áp dụng trực tiếp"
                            color: Theme.textMuted
                            font.pixelSize: 11
                        }
                    }

                    RowLayout {
                        Layout.fillWidth: true
                        spacing: 8

                        // Bước 1: Tải
                        Rectangle {
                            Layout.fillWidth: true
                            Layout.preferredHeight: 46
                            radius: 6
                            color: Theme.surface
                            border.color: Theme.border
                            border.width: 1
                            ColumnLayout {
                                anchors.centerIn: parent
                                spacing: 2
                                Label { text: "1. TẢI VIDEO"; color: Theme.textMuted; font.pixelSize: 10; font.bold: true }
                                Label {
                                    text: (settings && settings.defaultTrimLimit < 900) ? ("Tải " + settings.defaultTrimLimit + " phút đầu") : "Tải trọn vẹn"
                                    color: Theme.text; font.pixelSize: 12; font.bold: true
                                }
                            }
                        }

                        Label { text: "➔"; color: Theme.accent; font.pixelSize: 13 }

                        // Bước 2: Chia Part
                        Rectangle {
                            Layout.fillWidth: true
                            Layout.preferredHeight: 46
                            radius: 6
                            color: Theme.surface
                            border.color: Theme.border
                            border.width: 1
                            ColumnLayout {
                                anchors.centerIn: parent
                                spacing: 2
                                Label { text: "2. CHIA PART"; color: Theme.textMuted; font.pixelSize: 10; font.bold: true }
                                Label {
                                    text: (settings && settings.autoSplitEnabled) ? ("Chia " + settings.autoSplitParts + " Part liên tục") : "1 Video đơn"
                                    color: (settings && settings.autoSplitEnabled) ? Theme.success : Theme.textMuted; font.pixelSize: 12; font.bold: true
                                }
                            }
                        }

                        Label { text: "➔"; color: Theme.accent; font.pixelSize: 13 }

                        // Bước 3: Render
                        Rectangle {
                            Layout.fillWidth: true
                            Layout.preferredHeight: 46
                            radius: 6
                            color: Theme.surface
                            border.color: Theme.border
                            border.width: 1
                            ColumnLayout {
                                anchors.centerIn: parent
                                spacing: 2
                                Label { text: "3. MẪU RENDER"; color: Theme.textMuted; font.pixelSize: 10; font.bold: true }
                                Label {
                                    text: "AdsPow 1:1 (" + (settings ? settings.autoRenderResolution : "1080p") + ")"
                                    color: "#5AA6FF"; font.pixelSize: 12; font.bold: true
                                }
                            }
                        }

                        Label { text: "➔"; color: Theme.accent; font.pixelSize: 13 }

                        // Bước 4: Đăng TikTok
                        Rectangle {
                            Layout.fillWidth: true
                            Layout.preferredHeight: 46
                            radius: 6
                            color: Theme.surface
                            border.color: (settings && settings.tiktokUploadEnabled) ? Theme.success : Theme.border
                            border.width: 1
                            ColumnLayout {
                                anchors.centerIn: parent
                                spacing: 2
                                Label { text: "4. ĐĂNG TIKTOK"; color: Theme.textMuted; font.pixelSize: 10; font.bold: true }
                                Label {
                                    text: (settings && settings.tiktokUploadEnabled) ? "BẬT (Từng part)" : "TẮT (Chỉ lưu)"
                                    color: (settings && settings.tiktokUploadEnabled) ? Theme.success : Theme.warning; font.pixelSize: 12; font.bold: true
                                }
                            }
                        }
                    }
                }
            }

            RowLayout {
                Layout.fillWidth: true
                spacing: Theme.spacingMd
                DetectionPanel { Layout.fillWidth: true; Layout.preferredWidth: 1; Layout.fillHeight: true }
                AuthPanel { Layout.fillWidth: true; Layout.preferredWidth: 1; Layout.preferredHeight: 220; Layout.fillHeight: true }
            }

            // â”€â”€â”€ NĂºt chuyá»ƒn: Ä‘ang chá»‰nh cáº¥u hĂ¬nh táº£i/render cho lĂ n nĂ o â”€â”€â”€
            // Pass 104: chá»‰ hiá»‡n khi Cáº¢ HAI lĂ n báº­t â€” má»™t lĂ n thĂ¬ khá»i há»i.
            RowLayout {
                visible: !page.onlyShorts && !page.onlyLong
                Layout.fillWidth: true
                spacing: 8
                Label {
                    text: "Cáº¤U HĂŒNH Táº¢I & RENDER CHO:"
                    color: Theme.textMuted
                    font.pixelSize: Theme.textSm
                    font.bold: true
                    font.letterSpacing: 0.5
                }
                Repeater {
                    model: [
                        { key: "long",  label: "Video dĂ i", color: "#5AA6FF" },
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
                        ? "Bá»™ sá»‘ riĂªng cá»§a Short â€” Ä‘á»•i bĂªn nĂ y khĂ´ng kĂ©o Video dĂ i theo."
                        : "Bá»™ sá»‘ cá»§a video thÆ°á»ng (nhÆ° cÅ©)."
                    color: Theme.textMuted
                    font.pixelSize: 11
                }
            }
            // Báº£n má»™t-lĂ n: nhĂ£n tÄ©nh thay hĂ ng nĂºt chuyá»ƒn, biáº¿t mĂ¬nh Ä‘ang á»Ÿ Ä‘Ă¢u.
            Label {
                visible: page.onlyShorts || page.onlyLong
                text: page.onlyShorts ? "Cáº¤U HĂŒNH Táº¢I & RENDER â€” LĂ€N SHORTS" : "Cáº¤U HĂŒNH Táº¢I & RENDER â€” VIDEO DĂ€I"
                color: page.onlyShorts ? "#FF66B3" : "#5AA6FF"
                font.pixelSize: Theme.textSm
                font.bold: true
                font.letterSpacing: 0.5
            }

            // Video dĂ i â†’ hai card cÅ© Y NGUYĂN; Shorts â†’ bá»™ card riĂªng cá»§a lĂ n.
            RowLayout {
                visible: page.cfgLane === "long"
                Layout.fillWidth: true
                spacing: Theme.spacingMd
                DownloadCard { Layout.fillWidth: true; Layout.preferredWidth: 1; Layout.fillHeight: true }
                AutoRenderCard { Layout.fillWidth: true; Layout.preferredWidth: 1; Layout.fillHeight: true }
            }
            // ─── Thẻ Đăng TikTok (Làn Video dài) ───
            SettingsCard {
                visible: page.cfgLane === "long"
                Layout.fillWidth: true
                title: "TỰ ĐỘNG ĐĂNG TIKTOK (LÀN VIDEO DÀI)"

                RowLayout {
                    Layout.fillWidth: true
                    spacing: Theme.spacingMd
                    ColumnLayout {
                        Layout.fillWidth: true
                        spacing: 2
                        Label {
                            text: "Tự động đăng TikTok theo từng Part (Xong part nào đăng part đó)"
                            color: Theme.text
                            font.pixelSize: Theme.textMd
                            font.bold: true
                        }
                        Label {
                            text: "Cơ chế cuốn chiếu: Ngay khi Part 1 render xong, hệ thống lập tức gọi AdsPower để đăng Part 1 lên TikTok ngay (trong khi Part 2, Part 3 tiếp tục render nền). Tắt công tắc để chỉ render lưu máy, không tự đăng."
                            color: Theme.textMuted
                            font.pixelSize: 11
                            wrapMode: Text.WordWrap
                            Layout.fillWidth: true
                        }
                    }
                    Switch {
                        checked: settings ? Boolean(settings.tiktokUploadEnabled) : false
                        onToggled: {
                            if (settings) {
                                settings.tiktokUploadEnabled = checked
                            }
                        }
                    }
                }

                GridLayout {
                    columns: 2
                    columnSpacing: Theme.spacingLg
                    rowSpacing: Theme.spacingMd
                    Layout.fillWidth: true

                    ColumnLayout {
                        spacing: 2
                        Layout.fillWidth: true
                        Label { text: "Đăng siêu tốc (FastDone)"; color: Theme.text; font.pixelSize: Theme.textMd; font.bold: true }
                        Label {
                            text: "Bấm Đăng xong báo hoàn tất ngay lập tức (tiết kiệm 1.5 - 2.1s chờ redirect trang xác nhận của TikTok)."
                            color: Theme.textMuted; font.pixelSize: 11; wrapMode: Text.WordWrap; Layout.fillWidth: true
                        }
                    }
                    Switch {
                        Layout.alignment: Qt.AlignRight
                        checked: (settings && typeof settings.tiktokFastDone !== "undefined") ? Boolean(settings.tiktokFastDone) : true
                        onToggled: if (settings) settings.tiktokFastDone = checked
                    }
                }
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
                property string statusMessage: "Sáºµn sĂ ng kiá»ƒm tra vĂ  cáº­p nháº­t"
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
                            updateCard.statusMessage = "Äang táº£i báº£n vĂ¡: " + updateCard.downloadProgress + "%...";
                        }
                    }
                    function onUpdate_ready(params) {
                        updateCard.isDownloading = false;
                        updateCard.isReadyToInstall = true;
                        updateCard.statusMessage = "Báº£n vĂ¡ Ä‘Ă£ táº£i xong! Äang Ă¡p dá»¥ng vĂ  khá»Ÿi Ä‘á»™ng láº¡i...";
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
                            text: "Cáº¬P NHáº¬T PHáº¦N Má»€M & GIĂM SĂT Tá»° Äá»˜NG (VERCEL)"
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
                                text: "v" + updateCard.currentVersion + (updateCard.updateAvailable ? " â” v" + updateCard.latestVersion : " (Má»›i nháº¥t)")
                                color: updateCard.updateAvailable ? Theme.accent : Theme.textMuted
                                font.pixelSize: 10
                                font.bold: true
                            }
                        }
                    }

                    // Progress bar khi Ä‘ang táº£i
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
                            text: updateCard.isDownloading ? ("Äang táº£i báº£n vĂ¡ (" + updateCard.downloadProgress + "%)...") : (updateCard.updateAvailable ? "â¡ Cáº­p nháº­t ngay báº£n v" + updateCard.latestVersion : "â¡ Cáº­p nháº­t 1-Click")
                            highlighted: true
                            enabled: !updateCard.isDownloading && !updateCard.isReadyToInstall
                            visible: !updateCard.isReadyToInstall
                            onClicked: {
                                updateCard.statusMessage = "Äang káº¿t ná»‘i mĂ¡y chá»§ cáº­p nháº­t...";
                                if (typeof toastService !== 'undefined' && toastService) {
                                    toastService.show("Cáº­p nháº­t 1-Click", "Äang kiá»ƒm tra vĂ  cáº­p nháº­t á»©ng dá»¥ng...", "info");
                                }
                                var resp = backend.send_command("update:check", {"server": updateCard.serverUrl});
                                if (!resp || resp.ok === false || resp.offline || resp.error || resp.timeout) {
                                    updateCard.statusMessage = (resp && resp.error) ? resp.error : "KhĂ´ng thá»ƒ káº¿t ná»‘i mĂ¡y chá»§ cáº­p nháº­t (timeout).";
                                    if (typeof toastService !== 'undefined' && toastService) {
                                        toastService.show("Lá»—i káº¿t ná»‘i mĂ¡y chá»§", updateCard.statusMessage, "warn");
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
                                    updateCard.statusMessage = "PhĂ¡t hiá»‡n báº£n má»›i v" + data.version + "! Äang tá»± Ä‘á»™ng táº£i vá»...";
                                    if (typeof toastService !== 'undefined' && toastService) {
                                        toastService.show("PhĂ¡t hiá»‡n báº£n má»›i", "Äang tá»± Ä‘á»™ng táº£i báº£n vĂ¡ v" + data.version + "...", "success");
                                    }
                                    backend.send_command("update:download");
                                } else {
                                    updateCard.updateAvailable = false;
                                    updateCard.statusMessage = "Báº¡n Ä‘ang dĂ¹ng phiĂªn báº£n má»›i nháº¥t (v" + updateCard.currentVersion + ").";
                                    if (typeof toastService !== 'undefined' && toastService) {
                                        toastService.show("ÄĂ£ cáº­p nháº­t", "á»¨ng dá»¥ng Ä‘ang á»Ÿ báº£n má»›i nháº¥t (v" + updateCard.currentVersion + ").", "info");
                                    }
                                }
                            }
                        }

                        Button {
                            text: "CĂ i Ä‘áº·t & Khá»Ÿi Ä‘á»™ng láº¡i ngay"
                            highlighted: true
                            visible: updateCard.isReadyToInstall
                            onClicked: {
                                if (typeof toastService !== 'undefined' && toastService) {
                                    toastService.show("Khá»Ÿi Ä‘á»™ng láº¡i", "Äang Ă¡p dá»¥ng báº£n vĂ¡ vĂ  khá»Ÿi Ä‘á»™ng láº¡i HyperClip...", "info");
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
                            text: "KHáº®C PHá»¤C Sá»° Cá» & CHáº¨N ÄOĂN"
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
                            text: "Cháº¡y phĂ¢n tĂ­ch cháº©n Ä‘oĂ¡n hiá»‡u suáº¥t vĂ  káº¿t ná»‘i máº¡ng backend."
                            color: Theme.textMuted
                            font.pixelSize: Theme.textMd
                            Layout.fillWidth: true
                        }

                        Button {
                            text: "Cháº¡y cháº©n Ä‘oĂ¡n"
                            onClicked: {
                                backend.send_command_async("system:runDiagnostics")
                                if (typeof toastService !== 'undefined' && toastService) {
                                    toastService.show("Cháº©n Ä‘oĂ¡n", "Báº¯t Ä‘áº§u quĂ©t pháº§n cá»©ng há»‡ thá»‘ng...", "info")
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
                        text: "LÆ°u"
                        highlighted: true
                        onClicked: {
                            if (settings.save_to_backend(backend)) {
                                toastService.show("ÄĂ£ lÆ°u", "CĂ i Ä‘áº·t Ä‘Ă£ Ä‘Æ°á»£c lÆ°u thĂ nh cĂ´ng", "success")
                            } else {
                                toastService.show("Lá»—i", "KhĂ´ng thá»ƒ lÆ°u cĂ i Ä‘áº·t", "error")
                            }
                        }
                    }
                    Button {
                        text: "Táº£i láº¡i"
                        onClicked: {
                            settings.load_from_backend(backend)
                            toastService.show("ÄĂ£ táº£i láº¡i", "ÄĂ£ khĂ´i phá»¥c cĂ i Ä‘áº·t gáº§n nháº¥t", "info")
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

    // â”€â”€â”€ Pass 104: thanh LÆ¯U Ná»”I â€” dĂ­nh Ä‘Ă¡y trang, hiá»‡n NGAY khi cĂ³ thay Ä‘á»•i
    // chÆ°a lÆ°u. Nguá»“n "khĂ³ lÆ°u" #2: nĂºt LÆ°u cÅ© náº±m táº­n Ä‘Ă¡y trang cuá»™n dĂ i,
    // khĂ¡ch sá»­a xong khĂ´ng tháº¥y nĂºt, rá»i tab lĂ  máº¥t (nay reload Ä‘Ă£ cĂ³ guard).
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
                text: "CĂ³ thay Ä‘á»•i CHÆ¯A LÆ¯U"
                color: Theme.text
                font.pixelSize: Theme.textMd
                font.bold: true
                Layout.fillWidth: true
            }
            Button {
                text: "Huá»· thay Ä‘á»•i"
                onClicked: {
                    settings.discard_changes()
                    toastService.show("ÄĂ£ huá»·", "KhĂ´i phá»¥c cĂ i Ä‘áº·t Ä‘Ă£ lÆ°u gáº§n nháº¥t", "info")
                }
            }
            Button {
                text: "LÆ°u cĂ i Ä‘áº·t"
                highlighted: true
                onClicked: {
                    if (settings.save_to_backend(backend)) {
                        toastService.show("ÄĂ£ lÆ°u", "CĂ i Ä‘áº·t Ä‘Ă£ Ä‘Æ°á»£c lÆ°u thĂ nh cĂ´ng", "success")
                    } else {
                        toastService.show("Lá»—i", "KhĂ´ng thá»ƒ lÆ°u cĂ i Ä‘áº·t", "error")
                    }
                }
            }
        }
    }
}

