// src/ui/qml/StorageCard.qml
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

SettingsCard {
    title: "BỘ NHỚ"
    Layout.preferredHeight: 240

    ColumnLayout {
        width: parent.width
        spacing: 8

        GridLayout {
            columns: 2
            columnSpacing: 24
            rowSpacing: 8
            Layout.fillWidth: true

            Label { text: "Thư mục video"; color: Theme.textMuted; font.pixelSize: 11 }
            TextField {
                Layout.fillWidth: true
                text: settings.videoStoragePath
                onEditingFinished: settings.videoStoragePath = text
            }

            Label { text: "Thư mục output"; color: Theme.textMuted; font.pixelSize: 11 }
            TextField {
                Layout.fillWidth: true
                text: settings.outputPath
                onEditingFinished: settings.outputPath = text
            }

            Label { text: "Dọn sau (ngày)"; color: Theme.textMuted; font.pixelSize: 11 }
            SpinBox {
                Layout.fillWidth: true
                from: 0
                to: 365
                value: settings.downloadsCleanupDays
                onValueChanged: settings.downloadsCleanupDays = value
            }

            Label { text: "Số render đồng thời"; color: Theme.textMuted; font.pixelSize: 11 }
            SpinBox {
                Layout.fillWidth: true
                from: 1
                to: 16
                value: settings.maxConcurrentRenders
                onValueChanged: settings.maxConcurrentRenders = value
            }
        }

        RowLayout {
            Layout.fillWidth: true
            Button {
                text: "Xóa video đã tải"
                onClicked: {
                    backend.send_command("storage:clearDownloads")
                    activityModel.add_entry("storage", "Đã yêu cầu xóa video", "warn")
                }
            }
            Button {
                text: "Xóa ảnh nền blur"
                onClicked: {
                    backend.send_command("storage:clearBlur")
                    activityModel.add_entry("storage", "Đã yêu cầu xóa blur", "warn")
                }
            }
        }
    }
}
