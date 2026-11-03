// src/ui/qml/TopMenuBar.qml
// Slim, modern top bar with comfortable button hitboxes and navigation.
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Rectangle {
    id: bar
    color: Theme.cardBg
    border.color: Theme.border
    border.width: 0
    height: 44

    property string centerView: "settings"
    signal navigateToView(string view)

    // Bottom border line
    Rectangle {
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.bottom: parent.bottom
        height: 1
        color: Theme.border
    }

    RowLayout {
        anchors.fill: parent
        anchors.leftMargin: 16
        anchors.rightMargin: 16
        spacing: 14

        // ─── Brand ────────────────────────────────────────────────────────
        RowLayout {
            spacing: 8
            Rectangle {
                width: 22; height: 22; radius: 4
                color: Theme.accent
                Icon { anchors.centerIn: parent; name: "bolt"; size: 12; color: "white" }
            }
            Label {
                text: "HyperClip"
                color: Theme.text
                font.pixelSize: 14
                font.bold: true
                font.letterSpacing: 0.5
            }
            Rectangle {
                visible: false
                Layout.preferredHeight: 18
                Layout.preferredWidth: vBadgeLabel.implicitWidth + 12
                radius: 3
                color: Theme.accent + "20"
                border.color: Theme.accent + "44"
                border.width: 1
                Label {
                    id: vBadgeLabel
                    anchors.centerIn: parent
                    text: "v" + bar.currentAppVersion
                    color: Theme.accent
                    font.pixelSize: 10
                    font.bold: true
                }
            }
        }

        // Vertical separator
        Rectangle {
            width: 1; height: 18
            color: Theme.border
        }

        // ─── DL quality badge ─────────────────────────────────────────────
        RowLayout {
            spacing: 6
            Icon {
                name: "download"
                size: 12
                color: Theme.textMuted
                Layout.alignment: Qt.AlignVCenter
            }
            Rectangle {
                Layout.preferredHeight: 20
                Layout.preferredWidth: dlBadgeLabel.implicitWidth + 14
                radius: 4
                color: Theme.surfaceHover
                border.color: Theme.cardBorder
                border.width: 1
                Label {
                    id: dlBadgeLabel
                    anchors.centerIn: parent
                    text: (settings ? settings.autoDownloadQuality : "720") + "p"
                    color: Theme.textMuted
                    font.pixelSize: 11
                    font.bold: true
                }
            }
        }

        // ─── Back button ──────────────────────────────────────────────────
        Rectangle {
            Layout.preferredWidth: 28
            Layout.preferredHeight: 28
            radius: Theme.radiusMd
            color: backMa.containsMouse ? Theme.hoverBg : "transparent"
            border.color: backMa.containsMouse ? Theme.cardBorderHover : Theme.border
            border.width: 1
            visible: bar.centerView === "workspace" || bar.centerView === "rendered"
            Icon {
                anchors.centerIn: parent
                name: "back"
                size: 14
                color: Theme.text
            }
            MouseArea {
                id: backMa
                anchors.fill: parent
                hoverEnabled: true
                cursorShape: Qt.PointingHandCursor
                onClicked: bar.navigateToView("settings")
            }
            ToolTip.visible: backMa.containsMouse
            ToolTip.text: "Quay lại Cài đặt"
            ToolTip.delay: 300
        }

        // ─── View switcher (Comfortable 32px height) ──────────────────────
        Rectangle {
            Layout.preferredHeight: 32
            Layout.preferredWidth: switchRow.implicitWidth + 6
            color: Theme.bg
            border.color: Theme.border
            border.width: 1
            radius: Theme.radiusMd

            RowLayout {
                id: switchRow
                anchors.centerIn: parent
                spacing: 2

                Repeater {
                    model: [
                        {view: "management", label: "Quản lí", icon: "kebab"},
                        {view: "scancore", label: "Lõi quét", icon: "bolt"},
                        {view: "tiktok", label: "TikTok", icon: "upload"},
                        {view: "settings", label: "Cài đặt", icon: "settings"}
                    ]
                    delegate: Rectangle {
                        id: tabDelegate
                        readonly property bool active: bar.centerView === modelData.view
                        Layout.preferredHeight: 28
                        Layout.preferredWidth: tabRow.implicitWidth + 20
                        color: active ? Theme.surfaceHover : (itemMa.containsMouse ? Theme.hoverBg : "transparent")
                        border.color: active ? Theme.cardBorderHover : "transparent"
                        border.width: 1
                        radius: Theme.radiusSm

                        Behavior on color { ColorAnimation { duration: 120 } }

                        RowLayout {
                            id: tabRow
                            anchors.centerIn: parent
                            spacing: 5
                            Icon {
                                name: modelData.icon
                                size: 12
                                color: tabDelegate.active ? Theme.text : (itemMa.containsMouse ? Theme.text : Theme.textMuted)
                            }
                            Label {
                                text: modelData.label
                                color: tabDelegate.active ? Theme.text : (itemMa.containsMouse ? Theme.text : Theme.textMuted)
                                font.pixelSize: 11
                                font.bold: tabDelegate.active
                            }
                        }
                        MouseArea {
                            id: itemMa
                            anchors.fill: parent
                            hoverEnabled: true
                            cursorShape: Qt.PointingHandCursor
                            onClicked: bar.navigateToView(modelData.view)
                        }
                    }
                }
            }
        }

        Item { Layout.fillWidth: true }

        // ─── 1-Click Update Button (Prominent Header Action) ──────────────
        Rectangle {
            id: updateBtn
            visible: false
            Layout.preferredHeight: 30
            Layout.preferredWidth: updateRow.implicitWidth + 24
            radius: Theme.radiusMd
            color: bar.updateStatus === "available" 
                   ? (updateMa.containsMouse ? "#00B4FF" : Theme.accent)
                   : (bar.updateStatus === "ready" 
                      ? "#10B981" 
                      : (updateMa.containsMouse ? Theme.surfaceHover : Theme.cardBg))
            border.color: bar.updateStatus === "available" || bar.updateStatus === "ready"
                          ? "transparent"
                          : (updateMa.containsMouse ? Theme.accent : Theme.cardBorder)
            border.width: 1

            // Subtle pulsing animation when update is available
            SequentialAnimation on opacity {
                running: bar.updateStatus === "available"
                loops: Animation.Infinite
                NumberAnimation { to: 0.75; duration: 800; easing.type: Easing.InOutQuad }
                NumberAnimation { to: 1.0; duration: 800; easing.type: Easing.InOutQuad }
            }

            Behavior on color { ColorAnimation { duration: 150 } }

            RowLayout {
                id: updateRow
                anchors.centerIn: parent
                spacing: 7

                Icon {
                    name: bar.updateStatus === "ready" ? "check" : (bar.updateStatus === "downloading" ? "download" : "upload")
                    size: 13
                    color: (bar.updateStatus === "available" || bar.updateStatus === "ready") ? "#070A10" : Theme.accent
                }

                Label {
                    text: {
                        if (bar.updateStatus === "installing") return "Đang nâng cấp & mở lại...";
                        if (bar.updateStatus === "downloading") return "Đang tải " + bar.updateProgress + "%...";
                        if (bar.updateStatus === "ready") return "Đang nâng cấp & mở lại...";
                        if (bar.updateStatus === "available") return "🚀 Cập nhật v" + bar.latestAppVersion + " (1-Click)";
                        if (bar.updateStatus === "checking") return "Đang kiểm tra...";
                        return "⚡ Cập nhật 1-Click";
                    }
                    color: (bar.updateStatus === "available" || bar.updateStatus === "ready") ? "#070A10" : Theme.text
                    font.pixelSize: 11
                    font.bold: true
                }
            }

            MouseArea {
                id: updateMa
                anchors.fill: parent
                hoverEnabled: true
                cursorShape: Qt.PointingHandCursor
                onClicked: bar.runOneClickUpdate()
            }

            ToolTip.visible: updateMa.containsMouse
            ToolTip.text: bar.updateStatus === "available"
                          ? "Có bản cập nhật mới v" + bar.latestAppVersion + "! Bấm để tự động tải & cài đặt."
                          : (bar.updateStatus === "downloading" 
                             ? "Đang tải gói cập nhật (" + bar.updateProgress + "%)..." 
                             : "Bấm để tự động kiểm tra và nâng cấp phiên bản mới nhất từ Vercel.")
            ToolTip.delay: 300
        }
    }

    // ─── Updater Logic & Events ──────────────────────────────────────────
    property string updateStatus: "idle" // "idle", "checking", "available", "downloading", "ready"
    property int updateProgress: 0
    property string currentAppVersion: "3.1.4"
    property string latestAppVersion: ""

    Component.onCompleted: {
        if (typeof backend !== 'undefined' && backend) {
            var resp = backend.send_command("update:status");
            var data = (resp && resp.result) ? resp.result : resp;
            if (data) {
                if (data.currentVersion) bar.currentAppVersion = data.currentVersion;
                if (data.available) {
                    bar.updateStatus = "available";
                    bar.latestAppVersion = data.version || "";
                }
                if (data.downloaded) {
                    bar.updateStatus = "ready";
                }
            }
        }
        bgCheckTimer.start();
    }

    Timer {
        id: bgCheckTimer
        interval: 3500
        repeat: false
        onTriggered: {
            if (bar.updateStatus === "idle" && typeof backend !== 'undefined' && backend) {
                var resp = backend.send_command("update:check", {});
                var data = (resp && resp.result) ? resp.result : resp;
                if (data && data.available) {
                    bar.updateStatus = "available";
                    bar.latestAppVersion = data.version || "";
                } else if (data && data.currentVersion) {
                    bar.currentAppVersion = data.currentVersion;
                }
            }
        }
    }

    Connections {
        target: typeof eventBus !== 'undefined' ? eventBus : null
        ignoreUnknownSignals: true
        function onUpdate_progress(params) {
            if (params) {
                bar.updateProgress = params.percent || 0;
                bar.updateStatus = "downloading";
            }
        }
        function onUpdate_ready(params) {
            bar.updateStatus = "installing";
            if (typeof toastService !== 'undefined' && toastService) {
                toastService.show("Cập nhật 1-Click", "Đã tải xong! Đang áp dụng bản vá và tự động mở lại HyperClip trong 2 giây...", "success");
            }
            if (typeof backend !== 'undefined' && backend) {
                backend.send_command("update:install");
            }
        }
        function onUpdate_error(params) {
            bar.updateStatus = "idle";
            var errMsg = (params && params.error) ? params.error : "Tải bản cập nhật thất bại.";
            if (typeof toastService !== 'undefined' && toastService) {
                toastService.show("Lỗi cập nhật", errMsg, "warn");
            }
        }
    }

    function runOneClickUpdate() {
        if (typeof backend === 'undefined' || !backend) return;
        if (bar.updateStatus === "installing" || bar.updateStatus === "ready") {
            if (typeof toastService !== 'undefined' && toastService) {
                toastService.show("Cập nhật 1-Click", "Đang tự động nâng cấp và khởi động lại HyperClip...", "info");
            }
            backend.send_command("update:install");
            return;
        }

        if (bar.updateStatus === "downloading") {
            if (typeof toastService !== 'undefined' && toastService) {
                toastService.show("Đang tải", "Bản cập nhật đang được tải (" + bar.updateProgress + "%)...", "info");
            }
            return;
        }

        bar.updateStatus = "checking";
        if (typeof toastService !== 'undefined' && toastService) {
            toastService.show("Cập nhật 1-Click", "Đang kết nối máy chủ kiểm tra bản cập nhật mới...", "info");
        }

        var resp = backend.send_command("update:check", {});
        if (!resp || resp.ok === false || resp.offline || resp.error || resp.timeout) {
            bar.updateStatus = "idle";
            var errMsg = (resp && resp.error) ? resp.error : "Không thể kết nối máy chủ cập nhật (timeout).";
            if (typeof toastService !== 'undefined' && toastService) {
                toastService.show("Lỗi kết nối máy chủ", errMsg, "warn");
            }
            return;
        }

        var data = (resp && resp.result) ? resp.result : resp;
        if (data && data.currentVersion) {
            bar.currentAppVersion = data.currentVersion;
        }

        if (data && data.available) {
            bar.latestAppVersion = data.version || "";
            bar.updateStatus = "downloading";
            if (typeof toastService !== 'undefined' && toastService) {
                toastService.show("Phát hiện bản mới", "Đang tự động tải bản vá v" + data.version + "...", "success");
            }
            backend.send_command("update:download");
        } else {
            bar.updateStatus = "idle";
            if (typeof toastService !== 'undefined' && toastService) {
                toastService.show("Đã cập nhật", "Bạn đang ở phiên bản mới nhất (v" + bar.currentAppVersion + ").", "info");
            }
        }
    }
}

