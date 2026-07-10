// src/ui/qml/DownloadCard.qml
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

SettingsCard {
    title: "TẢI XUỐNG"

    RowLayout {
        Layout.fillWidth: true
        spacing: Theme.spacingMd
        Label {
            text: "Tự động tải"
            color: Theme.text
            font.pixelSize: Theme.textMd
            Layout.fillWidth: true
        }
        Switch {
            checked: settings ? settings.autoDownloadEnabled : true
            onToggled: if (settings) settings.autoDownloadEnabled = checked
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
            Label {
                text: "Chất lượng tải"
                color: Theme.text
                font.pixelSize: Theme.textMd
                font.bold: true
            }
            Label {
                text: "Độ phân giải video mục tiêu (ví dụ 1080p, 720p)."
                color: Theme.textMuted
                font.pixelSize: 11
                wrapMode: Text.WordWrap
                Layout.fillWidth: true
            }
        }
        ComboBox {
            Layout.preferredWidth: 140
            Layout.alignment: Qt.AlignRight
            font.pixelSize: Theme.textMd
            model: ["1080", "720", "480", "360"]
            currentIndex: settings ? Math.max(0, model.indexOf(settings.autoDownloadQuality)) : 0
            onActivated: if (settings) settings.autoDownloadQuality = model[currentIndex]
        }
 
        ColumnLayout {
            spacing: 2
            Layout.fillWidth: true
            Label {
                text: "Độ tuổi video tối đa (phút)"
                color: Theme.text
                font.pixelSize: Theme.textMd
                font.bold: true
            }
            Label {
                text: "Chỉ tải video đăng tải trong N phút qua (1440 = 24h)."
                color: Theme.textMuted
                font.pixelSize: 11
                wrapMode: Text.WordWrap
                Layout.fillWidth: true
            }
        }
        SpinBox {
            Layout.preferredWidth: 140
            Layout.alignment: Qt.AlignRight
            font.pixelSize: Theme.textMd
            from: 1
            to: 1440
            value: settings ? settings.autoDownloadMaxAgeMinutes : 1440
            editable: true
            onValueModified: if (settings) settings.autoDownloadMaxAgeMinutes = value
        }
 
        ColumnLayout {
            spacing: 2
            Layout.fillWidth: true
            Label {
                text: "Cắt tối đa (phút)"
                color: Theme.text
                font.pixelSize: Theme.textMd
                font.bold: true
            }
            Label {
                text: "Chỉ tải N phút đầu của video để tiết kiệm dung lượng."
                color: Theme.textMuted
                font.pixelSize: 11
                wrapMode: Text.WordWrap
                Layout.fillWidth: true
            }
        }
        SpinBox {
            Layout.preferredWidth: 140
            Layout.alignment: Qt.AlignRight
            font.pixelSize: Theme.textMd
            from: 1
            to: 999
            value: settings ? settings.defaultTrimLimit : 10
            editable: true
            onValueModified: if (settings) settings.defaultTrimLimit = value
        }
 
        ColumnLayout {
            spacing: 2
            Layout.fillWidth: true
            Label {
                text: "Tải đồng thời"
                color: Theme.text
                font.pixelSize: Theme.textMd
                font.bold: true
            }
            Label {
                text: "Số luồng tải yt-dlp song song tối đa."
                color: Theme.textMuted
                font.pixelSize: 11
                wrapMode: Text.WordWrap
                Layout.fillWidth: true
            }
        }
        SpinBox {
            Layout.preferredWidth: 140
            Layout.alignment: Qt.AlignRight
            font.pixelSize: Theme.textMd
            from: 1
            to: 16
            value: settings ? settings.maxConcurrentDownloads : 1
            editable: true
            onValueModified: if (settings) settings.maxConcurrentDownloads = value
        }

        ColumnLayout {
            spacing: 2
            Layout.fillWidth: true
            Label {
                text: "Direct Route IP (Bypass VPN)"
                color: Theme.text
                font.pixelSize: Theme.textMd
                font.bold: true
            }
            Label {
                text: "Bỏ qua VPN, kết nối trực tiếp IP vật lý để tăng tốc độ tải."
                color: Theme.textMuted
                font.pixelSize: 11
                wrapMode: Text.WordWrap
                Layout.fillWidth: true
            }
        }
        Switch {
            Layout.alignment: Qt.AlignRight
            checked: settings ? settings.bypassVpn : true
            onToggled: if (settings) settings.bypassVpn = checked
        }
    }
}
