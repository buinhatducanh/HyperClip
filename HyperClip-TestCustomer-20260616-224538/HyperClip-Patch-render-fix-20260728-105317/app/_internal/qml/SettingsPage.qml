// src/ui/qml/SettingsPage.qml
// Consolidated settings page — grouped sections + pinned save bar.
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

    // Nhãn nhóm mục: chữ mờ viết hoa + đường kẻ mảnh kéo hết hàng.
    component GroupLabel: RowLayout {
        property string label: ""
        Layout.fillWidth: true
        Layout.topMargin: Theme.spacingXs
        spacing: Theme.spacingSm
        Label {
            text: label
            color: Theme.textMuted
            font.pixelSize: Theme.textXs
            font.bold: true
            font.letterSpacing: 1.4
        }
        Rectangle {
            Layout.fillWidth: true
            Layout.preferredHeight: 1
            Layout.alignment: Qt.AlignVCenter
            color: Theme.border
            opacity: 0.6
        }
    }

    ColumnLayout {
        anchors.fill: parent
        spacing: 0

        ScrollView {
            id: scroll
            Layout.fillWidth: true
            Layout.fillHeight: true
            clip: true
            contentWidth: availableWidth   // không cuộn ngang

            ColumnLayout {
                width: Math.min(scroll.availableWidth - Theme.spacingXl * 2, 1180)
                x: Math.max(Theme.spacingLg, (scroll.availableWidth - width) / 2)
                y: Theme.spacingLg
                spacing: Theme.spacingSm

                // ─── Page header ───────────────────────────────
                RowLayout {
                    Layout.fillWidth: true
                    Layout.bottomMargin: Theme.spacingXs
                    spacing: Theme.spacingSm

                    Rectangle {
                        Layout.preferredWidth: 32
                        Layout.preferredHeight: 32
                        radius: Theme.radiusMd
                        color: Qt.rgba(Theme.accent.r, Theme.accent.g, Theme.accent.b, 0.14)
                        Icon {
                            anchors.centerIn: parent
                            name: "settings"
                            size: 16
                            color: Theme.accent
                        }
                    }
                    Label {
                        text: "Cài đặt"
                        color: Theme.text
                        font.pixelSize: Theme.textLg
                        font.bold: true
                        Layout.fillWidth: true
                        Layout.alignment: Qt.AlignVCenter
                    }
                }

                // ─── Nhóm: Phát hiện & Tài khoản ───────────────
                GroupLabel { label: "PHÁT HIỆN & TÀI KHOẢN" }
                RowLayout {
                    Layout.fillWidth: true
                    spacing: Theme.spacingSm
                    DetectionPanel { Layout.fillWidth: true; Layout.preferredWidth: 1; Layout.fillHeight: true; Layout.alignment: Qt.AlignTop }
                    AuthPanel { Layout.fillWidth: true; Layout.preferredWidth: 1; Layout.fillHeight: true; Layout.alignment: Qt.AlignTop }
                }

                // ─── Nhóm: Tải & Render ────────────────────────
                GroupLabel { label: "TẢI & RENDER" }
                RowLayout {
                    Layout.fillWidth: true
                    spacing: Theme.spacingSm
                    DownloadCard { Layout.fillWidth: true; Layout.preferredWidth: 1; Layout.fillHeight: true; Layout.alignment: Qt.AlignTop }
                    AutoRenderCard { Layout.fillWidth: true; Layout.preferredWidth: 1; Layout.fillHeight: true; Layout.alignment: Qt.AlignTop }
                }

                // ─── Nhóm: Hệ thống ────────────────────────────
                GroupLabel { label: "HỆ THỐNG" }
                StorageCard { Layout.fillWidth: true }
                HardwareProfileCard { Layout.fillWidth: true }

                RowLayout {
                    Layout.fillWidth: true
                    spacing: Theme.spacingSm

                    SettingsCard {
                        Layout.fillWidth: true
                        Layout.preferredWidth: 1
                        Layout.fillHeight: true
                        Layout.alignment: Qt.AlignTop
                        title: "CẬP NHẬT PHẦN MỀM"
                        iconName: "upload"
                        RowLayout {
                            Layout.fillWidth: true
                            spacing: Theme.spacingSm
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

                    SettingsCard {
                        Layout.fillWidth: true
                        Layout.preferredWidth: 1
                        Layout.fillHeight: true
                        Layout.alignment: Qt.AlignTop
                        title: "KHẮC PHỤC SỰ CỐ & CHẨN ĐOÁN"
                        iconName: "settings"
                        RowLayout {
                            Layout.fillWidth: true
                            spacing: Theme.spacingSm
                            Label {
                                text: "Quét chẩn đoán hiệu suất và kết nối mạng backend."
                                color: Theme.textMuted
                                font.pixelSize: Theme.textMd
                                wrapMode: Text.WordWrap
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

                // Đệm đáy để không dính mép cuộn.
                Item { Layout.preferredHeight: Theme.spacingLg }
            }
        }

        // ─── Thanh Lưu GHIM đáy (luôn thấy) ─────────────────
        Rectangle {
            Layout.fillWidth: true
            Layout.preferredHeight: 46
            color: Theme.cardBg

            Rectangle {   // viền trên
                anchors { top: parent.top; left: parent.left; right: parent.right }
                height: 1
                color: Theme.border
            }

            RowLayout {
                anchors.fill: parent
                anchors.leftMargin: Theme.spacingXl
                anchors.rightMargin: Theme.spacingXl
                spacing: Theme.spacingSm

                Label {
                    text: "Thay đổi chỉ áp dụng sau khi bấm Lưu."
                    color: Theme.textMuted
                    font.pixelSize: Theme.textSm
                    Layout.fillWidth: true
                }
                Button {
                    text: "Tải lại"
                    onClicked: {
                        settings.load_from_backend(backend)
                        toastService.show("Đã tải lại", "Đã khôi phục cài đặt gần nhất", "info")
                    }
                }
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
            }
        }
    }
}
