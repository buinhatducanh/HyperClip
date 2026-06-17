// src/ui/qml/SplitModal.qml
// Split a workspace into N parts (max 3) with per-part title input + auto-render
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Dialog {
    id: dlg
    title: "Tách và tự động render"
    modal: true
    width: 520
    height: 520

    property string workspaceId: ""
    property int totalDuration: 600  // seconds
    property int numParts: 2

    function openFor(id, duration) {
        workspaceId = id
        totalDuration = duration || 600
        numParts = 2
        // Default titles - assign new array to trigger change notification
        var arr = []
        for (var i = 0; i < 3; i++) {
            arr.push("Part " + (i + 1))
        }
        titleInputs = arr
        open()
    }

    // Per-part titles (max 3)
    property var titleInputs: ["", "", ""]

    ColumnLayout {
        anchors.fill: parent
        spacing: 12

        // Number of parts
        RowLayout {
            Layout.fillWidth: true
            Label {
                text: "Số video:"
                color: Theme.textMuted
                font.pixelSize: 16
            }
            RowLayout {
                spacing: 8
                Repeater {
                    model: [1, 2, 3]
                    delegate: RadioButton {
                        text: modelData
                        checked: dlg.numParts === modelData
                        onClicked: { dlg.numParts = modelData }
                    }
                }
            }
            Item { Layout.fillWidth: true }
        }

        // Per-part title inputs
        Label {
            text: "Tiêu đề từng phần:"
            color: Theme.textMuted
            font.pixelSize: 16
            Layout.topMargin: 8
        }

        Repeater {
            model: 3
            delegate: RowLayout {
                Layout.fillWidth: true
                visible: index < dlg.numParts
                Layout.preferredHeight: visible ? 36 : 0
                spacing: 8

                Label {
                    text: "Video " + (index + 1) + ":"
                    color: Theme.text
                    font.pixelSize: 15
                    Layout.preferredWidth: 72
                }
                TextField {
                    Layout.fillWidth: true
                    font.pixelSize: 15
                    placeholderText: "Nhập tiêu đề..."
                    text: dlg.titleInputs[index]
                    onEditingFinished: {
                        var arr = dlg.titleInputs
                        arr[index] = text
                        dlg.titleInputs = arr
                    }
                }

                // Duration preview
                Label {
                    text: {
                        var partDur = dlg.totalDuration / Math.max(1, dlg.numParts)
                        var start = index * partDur
                        var end = Math.min((index + 1) * partDur, dlg.totalDuration)
                        return formatTime(start) + " → " + formatTime(end)
                    }
                    color: Theme.textMuted
                    font.pixelSize: 13
                    font.family: "monospace"
                    Layout.preferredWidth: 130
                }
            }
        }

        // Visual separator
        Rectangle {
            Layout.fillWidth: true
            Layout.preferredHeight: 1
            color: Theme.border
            Layout.topMargin: 8
        }

        // Render settings
        Label {
            text: "Cài đặt render:"
            color: Theme.textMuted
            font.pixelSize: 16
        }

        GridLayout {
            columns: 2
            columnSpacing: Theme.spacingLg
            rowSpacing: 6
            Layout.fillWidth: true

            Label { text: "Độ phân giải"; color: Theme.textMuted; font.pixelSize: 14 }
            ComboBox {
                id: resCombo
                Layout.fillWidth: true
                font.pixelSize: 14
                model: ["1080p", "720p", "360p"]
                currentIndex: model.indexOf(settings.autoRenderResolution)
            }

            Label { text: "FPS"; color: Theme.textMuted; font.pixelSize: 14 }
            ComboBox {
                id: fpsCombo
                Layout.fillWidth: true
                font.pixelSize: 14
                model: [30, 60]
                currentIndex: [30, 60].indexOf(settings.autoRenderFPS)
            }

            Label { text: "Tốc độ"; color: Theme.textMuted; font.pixelSize: 14 }
            RowLayout {
                Layout.fillWidth: true
                spacing: 6
                Slider {
                    id: speedSlider
                    Layout.fillWidth: true
                    from: 1.0; to: 2.0; stepSize: 0.1
                    value: settings.autoRenderSpeed
                }
                Label {
                    text: speedSlider.value.toFixed(1) + "x"
                    color: Theme.text
                    font.pixelSize: 14
                    Layout.preferredWidth: 36
                }
            }
        }

        // Action buttons
        RowLayout {
            Layout.fillWidth: true
            Layout.topMargin: 8

            Switch {
                id: autoRenderSwitch
                text: "Tự động render sau khi tách"
                checked: true
            }

            Item { Layout.fillWidth: true }

            Button {
                text: "Hủy"
                Layout.minimumWidth: 36
                onClicked: dlg.close()
            }
            Button {
                text: "Tách" + (autoRenderSwitch.checked ? " & Render" : "")
                highlighted: true
                onClicked: {
                    // Build parts with per-part titles
                    var parts = []
                    var partDur = dlg.totalDuration / dlg.numParts
                    for (var i = 0; i < dlg.numParts; i++) {
                        var title = dlg.titleInputs[i] && dlg.titleInputs[i].trim()
                            ? dlg.titleInputs[i].trim()
                            : "Part " + (i + 1)
                        parts.push({
                            "start": i * partDur,
                            "end": Math.min((i + 1) * partDur, dlg.totalDuration),
                            "title": title
                        })
                    }

                    backend.send_command("workspace:split", {
                        "id": dlg.workspaceId,
                        "parts": parts,
                        "autoRender": autoRenderSwitch.checked,
                        "renderResolution": resCombo.currentText,
                        "renderFPS": fpsCombo.currentValue || fpsCombo.model[fpsCombo.currentIndex],
                        "renderSpeed": speedSlider.value
                    })
                    activityModel.add_entry("ws", "Splitting " + dlg.workspaceId + " into " + dlg.numParts + " parts", "info")
                    dlg.close()
                }
            }
        }
    }

    function formatTime(sec) {
        var m = Math.floor(sec / 60)
        var s = Math.floor(sec % 60)
        return m + ":" + (s < 10 ? "0" : "") + s
    }
}
