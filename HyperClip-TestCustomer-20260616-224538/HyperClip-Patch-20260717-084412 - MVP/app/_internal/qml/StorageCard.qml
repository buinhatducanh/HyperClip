// src/ui/qml/StorageCard.qml
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

SettingsCard {
    title: "BỘ NHỚ"

    GridLayout {
        columns: 2
        columnSpacing: Theme.spacingLg
        rowSpacing: Theme.spacingMd
        Layout.fillWidth: true

        ColumnLayout {
            spacing: 2
            Layout.fillWidth: true
            Label {
                text: "Thư mục video nguồn"
                color: Theme.text
                font.pixelSize: Theme.textMd
                font.bold: true
            }
            Label {
                text: "Nơi lưu các video thô tải từ YouTube trước khi xử lý."
                color: Theme.textMuted
                font.pixelSize: 11
                wrapMode: Text.WordWrap
                Layout.fillWidth: true
            }
        }
        RowLayout {
            Layout.preferredWidth: 320
            Layout.alignment: Qt.AlignRight
            spacing: Theme.spacingSm
            TextField {
                Layout.fillWidth: true
                font.pixelSize: Theme.textMd
                color: Theme.text
                placeholderTextColor: Theme.textMuted
                text: settings ? settings.videoStoragePath : ""
                onEditingFinished: if (settings) settings.videoStoragePath = text
                background: Rectangle {
                    color: Theme.inputBg
                    border.color: parent.activeFocus ? Theme.accent : Theme.border
                    border.width: 1
                    radius: Theme.radiusMd
                }
            }
            Button {
                text: "Mở"
                onClicked: if (settings && settings.videoStoragePath) backend.send_command("system:openFolder", {"path": settings.videoStoragePath})
            }
        }
 
        ColumnLayout {
            spacing: 2
            Layout.fillWidth: true
            Label {
                text: "Thư mục xuất bản (Output)"
                color: Theme.text
                font.pixelSize: Theme.textMd
                font.bold: true
            }
            Label {
                text: "Nơi xuất ra file video dọc thành phẩm (.mp4)."
                color: Theme.textMuted
                font.pixelSize: 11
                wrapMode: Text.WordWrap
                Layout.fillWidth: true
            }
        }
        RowLayout {
            Layout.preferredWidth: 320
            Layout.alignment: Qt.AlignRight
            spacing: Theme.spacingSm
            TextField {
                Layout.fillWidth: true
                font.pixelSize: Theme.textMd
                color: Theme.text
                placeholderTextColor: Theme.textMuted
                text: settings ? settings.outputPath : ""
                onEditingFinished: if (settings) settings.outputPath = text
                background: Rectangle {
                    color: Theme.inputBg
                    border.color: parent.activeFocus ? Theme.accent : Theme.border
                    border.width: 1
                    radius: Theme.radiusMd
                }
            }
            Button {
                text: "Mở"
                onClicked: if (settings && settings.outputPath) backend.send_command("system:openFolder", {"path": settings.outputPath})
            }
        }
 
        ColumnLayout {
            spacing: 2
            Layout.fillWidth: true
            Label {
                text: "Tự động dọn dẹp (ngày)"
                color: Theme.text
                font.pixelSize: Theme.textMd
                font.bold: true
            }
            Label {
                text: "Xóa video đã tải/render sau N ngày để giải phóng đĩa cứng."
                color: Theme.textMuted
                font.pixelSize: 11
                wrapMode: Text.WordWrap
                Layout.fillWidth: true
            }
        }
        SpinBox {
            Layout.preferredWidth: 180
            Layout.alignment: Qt.AlignRight
            font.pixelSize: Theme.textMd
            from: 0; to: 365
            value: settings ? settings.downloadsCleanupDays : 7
            editable: true
            onValueModified: if (settings) settings.downloadsCleanupDays = value
            onActiveFocusChanged: {
                if (!activeFocus) {
                    var val = valueFromText(contentItem.text, locale)
                    val = Math.max(from, Math.min(to, val))
                    value = val
                    if (settings) settings.downloadsCleanupDays = val
                }
            }
        }
    }
 
    ColumnLayout {
        Layout.fillWidth: true
        Layout.topMargin: Theme.spacingMd
        spacing: 4
        
        Label {
            text: "DỌN DẸP THỦ CÔNG BỘ NHỚ ĐỆM:"
            color: Theme.accent
            font.pixelSize: 11
            font.bold: true
        }

        RowLayout {
            Layout.fillWidth: true
            spacing: Theme.spacingSm
            Button {
                text: "Xóa video tải tạm"
                Layout.minimumWidth: 120
                onClicked: {
                    backend.send_command("storage:clearDownloads")
                    activityModel.add_entry("storage", "Đã yêu cầu xóa video", "warn")
                    if (toastService) toastService.showToast("Đang xóa video", "Yêu cầu đã gửi tới backend", "warn")
                }
                ToolTip.text: "Xóa toàn bộ các video nguồn đã tải về trong thư mục lưu tạm"
                ToolTip.visible: hovered
                ToolTip.delay: 300
            }
            Button {
                text: "Xóa ảnh blur nền"
                Layout.minimumWidth: 120
                onClicked: {
                    backend.send_command("storage:clearBlur")
                    activityModel.add_entry("storage", "Đã yêu cầu xóa blur", "warn")
                    if (toastService) toastService.showToast("Đang xóa ảnh blur", "Yêu cầu đã gửi tới backend", "warn")
                }
                ToolTip.text: "Xóa toàn bộ ảnh nền blur đã lưu trữ trong bộ nhớ cache"
                ToolTip.visible: hovered
                ToolTip.delay: 300
            }
            Item { Layout.fillWidth: true; Layout.minimumWidth: 4 }
        }
    }
}
