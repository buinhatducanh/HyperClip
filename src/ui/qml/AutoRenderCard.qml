// src/ui/qml/AutoRenderCard.qml
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

SettingsCard {
    title: "TỰ ĐỘNG RENDER"
    Layout.preferredHeight: 280

    ColumnLayout {
        width: parent.width
        spacing: 8

        RowLayout {
            Layout.fillWidth: true
            Switch {
                checked: settings.autoRender
                onToggled: settings.autoRender = checked
                Layout.alignment: Qt.AlignRight
            }
        }

        GridLayout {
            columns: 2
            columnSpacing: 24
            rowSpacing: 8
            Layout.fillWidth: true

            Label { text: "Độ phân giải"; color: Theme.textMuted; font.pixelSize: 11 }
            ComboBox {
                Layout.fillWidth: true
                model: ["1080p", "720p", "360p"]
                currentIndex: model.indexOf(settings.autoRenderResolution)
                onActivated: settings.autoRenderResolution = model[currentIndex]
            }

            Label { text: "FPS"; color: Theme.textMuted; font.pixelSize: 11 }
            ComboBox {
                Layout.fillWidth: true
                model: [30, 60]
                currentIndex: [30, 60].indexOf(settings.autoRenderFPS)
                onActivated: settings.autoRenderFPS = model[currentIndex]
            }

            Label { text: "Tốc độ"; color: Theme.textMuted; font.pixelSize: 11 }
            RowLayout {
                Layout.fillWidth: true
                Slider {
                    Layout.fillWidth: true
                    from: 1.0
                    to: 2.0
                    stepSize: 0.1
                    value: settings.autoRenderSpeed
                    onValueChanged: settings.autoRenderSpeed = value
                }
                Label {
                    text: settings.autoRenderSpeed.toFixed(1) + "x"
                    color: Theme.text
                    font.pixelSize: 11
                    Layout.preferredWidth: 32
                }
            }

            Label { text: "Số phần tách"; color: Theme.textMuted; font.pixelSize: 11 }
            SpinBox {
                Layout.fillWidth: true
                from: 1
                to: 10
                value: settings.autoSplitParts
                onValueChanged: settings.autoSplitParts = value
            }

            Label { text: "Hoặc số phút"; color: Theme.textMuted; font.pixelSize: 11 }
            SpinBox {
                Layout.fillWidth: true
                from: 0
                to: 120
                value: settings.autoSplitMinutes
                onValueChanged: settings.autoSplitMinutes = value
            }

            Label { text: "Mẫu tiêu đề"; color: Theme.textMuted; font.pixelSize: 11 }
            TextField {
                Layout.fillWidth: true
                text: settings.autoRenderTitleTemplate
                onEditingFinished: settings.autoRenderTitleTemplate = text
            }
        }
    }
}
