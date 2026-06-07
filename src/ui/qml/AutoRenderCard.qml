// src/ui/qml/AutoRenderCard.qml
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Rectangle {
    color: Theme.bg
    border.color: Theme.border
    border.width: 1
    Layout.preferredHeight: 280

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 12
        spacing: 8

        RowLayout {
            Layout.fillWidth: true
            Label {
                text: "AUTO-RENDER"
                color: Theme.accent
                font.pixelSize: 13
                font.bold: true
                Layout.fillWidth: true
            }
            Switch {
                checked: settings.autoRender
                onToggled: settings.autoRender = checked
            }
        }

        GridLayout {
            columns: 2
            columnSpacing: 24
            rowSpacing: 8
            Layout.fillWidth: true

            Label { text: "Resolution"; color: Theme.textMuted; font.pixelSize: 11 }
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

            Label { text: "Speed"; color: Theme.textMuted; font.pixelSize: 11 }
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

            Label { text: "Split parts"; color: Theme.textMuted; font.pixelSize: 11 }
            SpinBox {
                Layout.fillWidth: true
                from: 1
                to: 10
                value: settings.autoSplitParts
                onValueChanged: settings.autoSplitParts = value
            }

            Label { text: "Or minutes"; color: Theme.textMuted; font.pixelSize: 11 }
            SpinBox {
                Layout.fillWidth: true
                from: 0
                to: 120
                value: settings.autoSplitMinutes
                onValueChanged: settings.autoSplitMinutes = value
            }

            Label { text: "Title template"; color: Theme.textMuted; font.pixelSize: 11 }
            TextField {
                Layout.fillWidth: true
                text: settings.autoRenderTitleTemplate
                onEditingFinished: settings.autoRenderTitleTemplate = text
            }
        }
    }
}
