// src/ui/qml/StorageCard.qml
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

SettingsCard {
    title: "BỘ NHỚ"

    GridLayout {
        columns: 2
        columnSpacing: Theme.spacingLg
        rowSpacing: Theme.spacingSm
        Layout.fillWidth: true

        Label { text: "Thư mục video"; color: Theme.textMuted; font.pixelSize: Theme.textMd }
        RowLayout {
            Layout.fillWidth: true
            spacing: Theme.spacingSm
            TextField {
                Layout.fillWidth: true
                font.pixelSize: Theme.textMd
                text: settings ? settings.videoStoragePath : ""
                onEditingFinished: if (settings) settings.videoStoragePath = text
            }
            Button {
                text: "Mở"
                onClicked: if (settings && settings.videoStoragePath) backend.send_command("system:openFolder", {"path": settings.videoStoragePath})
            }
        }
 
        Label { text: "Thư mục output"; color: Theme.textMuted; font.pixelSize: Theme.textMd }
        RowLayout {
            Layout.fillWidth: true
            spacing: Theme.spacingSm
            TextField {
                Layout.fillWidth: true
                font.pixelSize: Theme.textMd
                text: settings ? settings.outputPath : ""
                onEditingFinished: if (settings) settings.outputPath = text
            }
            Button {
                text: "Mở"
                onClicked: if (settings && settings.outputPath) backend.send_command("system:openFolder", {"path": settings.outputPath})
            }
        }
 
        Label { text: "Dọn sau (ngày)"; color: Theme.textMuted; font.pixelSize: Theme.textMd }
        SpinBox {
            Layout.fillWidth: true
            font.pixelSize: Theme.textMd
            from: 0; to: 365
            value: settings ? settings.downloadsCleanupDays : 7
            editable: true
            onValueModified: if (settings) settings.downloadsCleanupDays = value
        }
 
        Label { text: "Render đồng thời"; color: Theme.textMuted; font.pixelSize: Theme.textMd }
        SpinBox {
            Layout.fillWidth: true
            font.pixelSize: Theme.textMd
            from: 1; to: 16
            value: settings ? settings.maxConcurrentRenders : 2
            editable: true
            onValueModified: if (settings) settings.maxConcurrentRenders = value
        }
    }

    RowLayout {
        Layout.fillWidth: true
        spacing: Theme.spacingSm
        Button {
            text: "Xóa video"
            Layout.minimumWidth: 64
            onClicked: {
                backend.send_command("storage:clearDownloads")
                activityModel.add_entry("storage", "Đã yêu cầu xóa video", "warn")
                if (toastService) toastService.showToast("Đang xóa video", "Yêu cầu đã gửi tới backend", "warn")
            }
        }
        Button {
            text: "Xóa ảnh blur"
            Layout.minimumWidth: 64
            onClicked: {
                backend.send_command("storage:clearBlur")
                activityModel.add_entry("storage", "Đã yêu cầu xóa blur", "warn")
                if (toastService) toastService.showToast("Đang xóa ảnh blur", "Yêu cầu đã gửi tới backend", "warn")
            }
        }
        Item { Layout.fillWidth: true; Layout.minimumWidth: 4 }
    }
}
