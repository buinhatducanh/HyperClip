// src/ui/qml/AutoRenderCard.qml
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

SettingsCard {
    title: "TỰ ĐỘNG RENDER"

    RowLayout {
        Layout.fillWidth: true
        spacing: Theme.spacingMd
        Label {
            text: "Tự động render"
            color: Theme.text
            font.pixelSize: Theme.textMd
            Layout.fillWidth: true
        }
        Switch {
            checked: settings ? settings.autoRender : true
            onToggled: if (settings) settings.autoRender = checked
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
                text: "Độ phân giải"
                color: Theme.text
                font.pixelSize: Theme.textMd
                font.bold: true
            }
            Label {
                text: "Độ phân giải video dọc đầu ra (ví dụ 1080p, 720p)."
                color: Theme.textMuted
                font.pixelSize: 11
                wrapMode: Text.WordWrap
                Layout.fillWidth: true
            }
        }
        ComboBox {
            Layout.preferredWidth: 180
            Layout.alignment: Qt.AlignRight
            font.pixelSize: Theme.textMd
            model: ["1080p", "720p", "360p"]
            currentIndex: settings ? Math.max(0, model.indexOf(settings.autoRenderResolution)) : 0
            onActivated: if (settings) settings.autoRenderResolution = model[currentIndex]
        }
 
        ColumnLayout {
            spacing: 2
            Layout.fillWidth: true
            Label {
                text: "Khung hình (FPS)"
                color: Theme.text
                font.pixelSize: Theme.textMd
                font.bold: true
            }
            Label {
                text: "Tốc độ khung hình đầu ra (30 hoặc 60 fps)."
                color: Theme.textMuted
                font.pixelSize: 11
                wrapMode: Text.WordWrap
                Layout.fillWidth: true
            }
        }
        ComboBox {
            Layout.preferredWidth: 180
            Layout.alignment: Qt.AlignRight
            font.pixelSize: Theme.textMd
            model: [30, 60]
            currentIndex: settings ? Math.max(0, [30, 60].indexOf(settings.autoRenderFPS)) : 0
            onActivated: if (settings) settings.autoRenderFPS = model[currentIndex]
        }
 
        ColumnLayout {
            spacing: 2
            Layout.fillWidth: true
            Label {
                text: "Tốc độ phát (Speed)"
                color: Theme.text
                font.pixelSize: Theme.textMd
                font.bold: true
            }
            Label {
                text: "Tự động tăng tốc độ video (lách bản quyền và tăng độ cuốn)."
                color: Theme.textMuted
                font.pixelSize: 11
                wrapMode: Text.WordWrap
                Layout.fillWidth: true
            }
        }
        RowLayout {
            Layout.preferredWidth: 180
            Layout.alignment: Qt.AlignRight
            spacing: Theme.spacingSm
            Slider {
                Layout.fillWidth: true
                from: 1.0; to: 2.0; stepSize: 0.1
                value: settings ? settings.autoRenderSpeed : 1.0
                onValueChanged: if (settings) settings.autoRenderSpeed = value
            }
            Label {
                text: (settings ? settings.autoRenderSpeed : 1.0).toFixed(1) + "x"
                color: Theme.text
                font.pixelSize: Theme.textMd
                Layout.preferredWidth: 32
            }
        }
 
        ColumnLayout {
            spacing: 2
            Layout.fillWidth: true
            Label {
                text: "Tự động tách video"
                color: Theme.text
                font.pixelSize: Theme.textMd
                font.bold: true
            }
            Label {
                text: "Chia nhỏ video thành nhiều phần khi tải xong."
                color: Theme.textMuted
                font.pixelSize: 11
                wrapMode: Text.WordWrap
                Layout.fillWidth: true
            }
        }
        Switch {
            Layout.alignment: Qt.AlignRight
            checked: settings ? settings.autoSplitEnabled : false
            onToggled: if (settings) settings.autoSplitEnabled = checked
        }

        ColumnLayout {
            visible: settings ? settings.autoSplitEnabled : false
            spacing: 2
            Layout.fillWidth: true
            Label {
                text: "Chế độ tách"
                color: Theme.text
                font.pixelSize: Theme.textMd
                font.bold: true
            }
            Label {
                text: "Tách theo số lượng phần cố định hoặc theo số phút mỗi phần."
                color: Theme.textMuted
                font.pixelSize: 11
                wrapMode: Text.WordWrap
                Layout.fillWidth: true
            }
        }
        ComboBox {
            visible: settings ? settings.autoSplitEnabled : false
            Layout.preferredWidth: 180
            Layout.alignment: Qt.AlignRight
            font.pixelSize: Theme.textMd
            model: ["Tách theo số phần", "Tách theo thời lượng (phút)"]
            currentIndex: settings ? (settings.autoSplitMode === "minutes" ? 1 : 0) : 0
            onActivated: if (settings) settings.autoSplitMode = currentIndex === 1 ? "minutes" : "parts"
        }

        ColumnLayout {
            visible: settings ? (settings.autoSplitEnabled && settings.autoSplitMode === "parts") : false
            spacing: 2
            Layout.fillWidth: true
            Label {
                text: "Số phần tách"
                color: Theme.text
                font.pixelSize: Theme.textMd
                font.bold: true
            }
            Label {
                text: "Cắt video gốc thành N phần bằng nhau."
                color: Theme.textMuted
                font.pixelSize: 11
                wrapMode: Text.WordWrap
                Layout.fillWidth: true
            }
        }
        SpinBox {
            visible: settings ? (settings.autoSplitEnabled && settings.autoSplitMode === "parts") : false
            Layout.preferredWidth: 180
            Layout.alignment: Qt.AlignRight
            font.pixelSize: Theme.textMd
            from: 2; to: 20
            value: settings ? settings.autoSplitParts : 2
            editable: true
            onValueModified: if (settings) settings.autoSplitParts = value
        }

        ColumnLayout {
            visible: settings ? (settings.autoSplitEnabled && settings.autoSplitMode === "minutes") : false
            spacing: 2
            Layout.fillWidth: true
            Label {
                text: "Số phút / phần"
                color: Theme.text
                font.pixelSize: Theme.textMd
                font.bold: true
            }
            Label {
                text: "Tách nhỏ video theo khoảng thời gian N phút."
                color: Theme.textMuted
                font.pixelSize: 11
                wrapMode: Text.WordWrap
                Layout.fillWidth: true
            }
        }
        SpinBox {
            visible: settings ? (settings.autoSplitEnabled && settings.autoSplitMode === "minutes") : false
            Layout.preferredWidth: 180
            Layout.alignment: Qt.AlignRight
            font.pixelSize: Theme.textMd
            from: 1; to: 120
            value: settings ? settings.autoSplitMinutes : 5
            editable: true
            onValueModified: if (settings) settings.autoSplitMinutes = value
        }
 
        ColumnLayout {
            spacing: 2
            Layout.fillWidth: true
            Label {
                text: "Mẫu đặt tên file"
                color: Theme.text
                font.pixelSize: Theme.textMd
                font.bold: true
            }
            Label {
                text: "Cấu hình tên file xuất ra (hỗ trợ thẻ {title}, {part})."
                color: Theme.textMuted
                font.pixelSize: 11
                wrapMode: Text.WordWrap
                Layout.fillWidth: true
            }
        }
        TextField {
            Layout.preferredWidth: 180
            Layout.alignment: Qt.AlignRight
            font.pixelSize: Theme.textMd
            color: Theme.text
            placeholderTextColor: Theme.textMuted
            text: settings ? settings.autoRenderTitleTemplate : ""
            onEditingFinished: if (settings) settings.autoRenderTitleTemplate = text
            background: Rectangle {
                color: Theme.inputBg
                border.color: parent.activeFocus ? Theme.accent : Theme.border
                border.width: 1
                radius: Theme.radiusMd
            }
        }
 
        ColumnLayout {
            spacing: 2
            Layout.fillWidth: true
            Label {
                text: "Render song song"
                color: Theme.text
                font.pixelSize: Theme.textMd
                font.bold: true
            }
            Label {
                text: "Số lượng tiến trình render FFmpeg chạy đồng thời (khuyên dùng 2)."
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
            from: 1; to: 16
            value: settings ? settings.maxConcurrentRenders : 2
            editable: true
            onValueModified: if (settings) settings.maxConcurrentRenders = value
        }
    }
}
