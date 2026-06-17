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
        rowSpacing: Theme.spacingSm
        Layout.fillWidth: true
 
        Label { text: "Độ phân giải"; color: Theme.textMuted; font.pixelSize: Theme.textMd }
        ComboBox {
            Layout.fillWidth: true
            font.pixelSize: Theme.textMd
            model: ["1080p", "720p", "360p"]
            currentIndex: settings ? model.indexOf(settings.autoRenderResolution) : 0
            onActivated: if (settings) settings.autoRenderResolution = model[currentIndex]
        }
 
        Label { text: "FPS"; color: Theme.textMuted; font.pixelSize: Theme.textMd }
        ComboBox {
            Layout.fillWidth: true
            font.pixelSize: Theme.textMd
            model: [30, 60]
            currentIndex: settings ? [30, 60].indexOf(settings.autoRenderFPS) : 0
            onActivated: if (settings) settings.autoRenderFPS = model[currentIndex]
        }
 
        Label { text: "Tốc độ"; color: Theme.textMuted; font.pixelSize: Theme.textMd }
        RowLayout {
            Layout.fillWidth: true
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
                Layout.preferredWidth: 36
            }
        }
 
        Label { text: "Số phần tách"; color: Theme.textMuted; font.pixelSize: Theme.textMd }
        SpinBox {
            Layout.fillWidth: true
            font.pixelSize: Theme.textMd
            from: 1; to: 10
            value: settings ? settings.autoSplitParts : 1
            editable: true
            onValueModified: if (settings) settings.autoSplitParts = value
        }
 
        Label { text: "Hoặc số phút"; color: Theme.textMuted; font.pixelSize: Theme.textMd }
        SpinBox {
            Layout.fillWidth: true
            font.pixelSize: Theme.textMd
            from: 0; to: 120
            value: settings ? settings.autoSplitMinutes : 0
            editable: true
            onValueModified: if (settings) settings.autoSplitMinutes = value
        }
 
        Label { text: "Mẫu tiêu đề"; color: Theme.textMuted; font.pixelSize: Theme.textMd }
        TextField {
            Layout.fillWidth: true
            font.pixelSize: Theme.textMd
            text: settings ? settings.autoRenderTitleTemplate : ""
            onEditingFinished: if (settings) settings.autoRenderTitleTemplate = text
        }
    }
}
