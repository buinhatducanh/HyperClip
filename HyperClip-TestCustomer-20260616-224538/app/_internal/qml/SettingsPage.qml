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
    property string cfgLane: "long"

    onVisibleChanged: {
        if (visible) {
            Qt.callLater(settings.load_from_backend, backend)
        }
    }

    ScrollView {
        id: root
        anchors.fill: parent
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
            RowLayout {
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
                            onClicked: page.cfgLane = lanePick.modelData.key
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

            HardwareProfileCard { Layout.fillWidth: true }

            // Software Update
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
                        Icon { name: "upload"; size: 13; color: Theme.accent }
                        Label {
                            text: "CẬP NHẬT PHẦN MỀM"
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
                            text: "Phiên bản hiện tại: v1.2.0-stable"
                            color: Theme.text
                            font.pixelSize: Theme.textMd
                            Layout.fillWidth: true
                        }

                        Button {
                            text: "Kiểm tra cập nhật"
                            highlighted: true
                            onClicked: {
                                backend.send_command_async("update:check")
                                if (typeof toastService !== 'undefined' && toastService) {
                                    toastService.show("Cập nhật", "Đang kết nối tới máy chủ cập nhật...", "info")
                                }
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
}

