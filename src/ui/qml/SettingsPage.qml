// src/ui/qml/SettingsPage.qml
// Consolidated settings page showing all panels in a single scrollable view.
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Rectangle {
    id: page
    color: Theme.bg

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

            RowLayout {
                Layout.fillWidth: true
                spacing: Theme.spacingMd
                DownloadCard { Layout.fillWidth: true; Layout.preferredWidth: 1; Layout.fillHeight: true }
                AutoRenderCard { Layout.fillWidth: true; Layout.preferredWidth: 1; Layout.fillHeight: true }
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
                                backend.send_command("update:check")
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
                                backend.send_command("system:runDiagnostics")
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

