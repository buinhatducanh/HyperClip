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
            checked: settings.autoRender
            onToggled: settings.autoRender = checked
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
            currentIndex: model.indexOf(settings.autoRenderResolution)
            onActivated: settings.autoRenderResolution = model[currentIndex]
        }

        Label { text: "FPS"; color: Theme.textMuted; font.pixelSize: Theme.textMd }
        ComboBox {
            Layout.fillWidth: true
            font.pixelSize: Theme.textMd
            model: [30, 60]
            currentIndex: [30, 60].indexOf(settings.autoRenderFPS)
            onActivated: settings.autoRenderFPS = model[currentIndex]
        }

        Label { text: "Tốc độ"; color: Theme.textMuted; font.pixelSize: Theme.textMd }
        RowLayout {
            Layout.fillWidth: true
            spacing: Theme.spacingSm
            Slider {
                Layout.fillWidth: true
                from: 1.0; to: 2.0; stepSize: 0.1
                value: settings.autoRenderSpeed
                onValueChanged: settings.autoRenderSpeed = value
            }
            Label {
                text: settings.autoRenderSpeed.toFixed(1) + "x"
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
            value: settings.autoSplitParts
            onValueChanged: settings.autoSplitParts = value
        }

        Label { text: "Hoặc số phút"; color: Theme.textMuted; font.pixelSize: Theme.textMd }
        SpinBox {
            Layout.fillWidth: true
            font.pixelSize: Theme.textMd
            from: 0; to: 120
            value: settings.autoSplitMinutes
            onValueChanged: settings.autoSplitMinutes = value
        }

        Label { text: "Mẫu tiêu đề"; color: Theme.textMuted; font.pixelSize: Theme.textMd }
        TextField {
            Layout.fillWidth: true
            font.pixelSize: Theme.textMd
            text: settings.autoRenderTitleTemplate
            onEditingFinished: settings.autoRenderTitleTemplate = text
        }
    }
}
