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
        TextField {
            Layout.fillWidth: true
            font.pixelSize: Theme.textMd
            text: settings.videoStoragePath
            onEditingFinished: settings.videoStoragePath = text
        }

        Label { text: "Thư mục output"; color: Theme.textMuted; font.pixelSize: Theme.textMd }
        TextField {
            Layout.fillWidth: true
            font.pixelSize: Theme.textMd
            text: settings.outputPath
            onEditingFinished: settings.outputPath = text
        }

        Label { text: "Dọn sau (ngày)"; color: Theme.textMuted; font.pixelSize: Theme.textMd }
        SpinBox {
            Layout.fillWidth: true
            font.pixelSize: Theme.textMd
            from: 0; to: 365
            value: settings.downloadsCleanupDays
            editable: true
            onValueModified: settings.downloadsCleanupDays = value
        }

        Label { text: "Render đồng thời"; color: Theme.textMuted; font.pixelSize: Theme.textMd }
        SpinBox {
            Layout.fillWidth: true
            font.pixelSize: Theme.textMd
            from: 1; to: 16
            value: settings.maxConcurrentRenders
            editable: true
            onValueModified: settings.maxConcurrentRenders = value
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
