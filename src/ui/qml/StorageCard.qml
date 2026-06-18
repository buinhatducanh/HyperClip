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

        Label {
            text: "Thư mục video"
            color: Theme.textMuted
            font.pixelSize: Theme.textMd
            Layout.fillWidth: true
        }
        RowLayout {
            Layout.preferredWidth: 320
            Layout.alignment: Qt.AlignRight
            spacing: Theme.spacingSm
            TextField {
                Layout.fillWidth: true
                font.pixelSize: Theme.textMd
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
 
        Label {
            text: "Thư mục output"
            color: Theme.textMuted
            font.pixelSize: Theme.textMd
            Layout.fillWidth: true
        }
        RowLayout {
            Layout.preferredWidth: 320
            Layout.alignment: Qt.AlignRight
            spacing: Theme.spacingSm
            TextField {
                Layout.fillWidth: true
                font.pixelSize: Theme.textMd
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
 
        Label {
            text: "Dọn sau (ngày)"
            color: Theme.textMuted
            font.pixelSize: Theme.textMd
            Layout.fillWidth: true
        }
        SpinBox {
            Layout.preferredWidth: 180
            Layout.alignment: Qt.AlignRight
            font.pixelSize: Theme.textMd
            from: 0; to: 365
            value: settings ? settings.downloadsCleanupDays : 7
            editable: true
            onValueModified: if (settings) settings.downloadsCleanupDays = value
        }
    }
 
    RowLayout {
        Layout.fillWidth: true
        Layout.topMargin: Theme.spacingLg
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
