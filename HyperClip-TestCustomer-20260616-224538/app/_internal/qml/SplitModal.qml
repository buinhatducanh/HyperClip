// src/ui/qml/SplitModal.qml
// Premium Dark Mode Split & Auto-Render Modal.
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Dialog {
    id: dlg
    modal: true
    dim: true
    anchors.centerIn: Overlay.overlay
    width: 600
    height: 620
    padding: 0
    closePolicy: Popup.CloseOnEscape | Popup.CloseOnPressOutside

    property string workspaceId: ""
    property int totalDuration: 600  // seconds
    property int numParts: 2
    property var titleInputs: ["", "", ""]

    function openFor(id, duration) {
        workspaceId = id
        totalDuration = duration || 600
        numParts = 2
        var arr = []
        for (var i = 0; i < 3; i++) {
            arr.push("Part " + (i + 1))
        }
        titleInputs = arr
        open()
    }

    background: Rectangle {
        color: Theme.cardBg
        border.color: Theme.border
        border.width: 1
        radius: Theme.radiusXl
        clip: true

        Rectangle {
            anchors.top: parent.top
            anchors.left: parent.left
            anchors.right: parent.right
            height: 3
            color: Theme.accent
        }
    }

    contentItem: ColumnLayout {
        spacing: 0

        // Header
        Rectangle {
            Layout.fillWidth: true
            Layout.preferredHeight: 52
            color: "transparent"

            RowLayout {
                anchors.fill: parent
                anchors.leftMargin: 20
                anchors.rightMargin: 16
                spacing: 12

                Rectangle {
                    width: 32
                    height: 32
                    radius: 16
                    color: Theme.accent + "25"
                    border.color: Theme.accent + "66"
                    border.width: 1

                    Icon {
                        anchors.centerIn: parent
                        name: "render"
                        size: 15
                        color: Theme.accent
                    }
                }

                ColumnLayout {
                    Layout.fillWidth: true
                    spacing: 1
                    Label {
                        text: "Tách Video & Tự Động Render"
                        color: Theme.text
                        font.pixelSize: 15
                        font.bold: true
                    }
                    Label {
                        text: "Chia nhỏ video dài thành nhiều phần độc lập và xuất bản"
                        color: Theme.textMuted
                        font.pixelSize: 11
                    }
                }

                IconButton {
                    iconName: "close"
                    iconSize: 12
                    variant: "ghost"
                    tooltipText: "Đóng (Esc)"
                    onClicked: dlg.close()
                }
            }
        }

        // Divider
        Rectangle {
            Layout.fillWidth: true
            height: 1
            color: Theme.border
        }

        // Scrollable Body
        ScrollView {
            Layout.fillWidth: true
            Layout.fillHeight: true
            clip: true

            ColumnLayout {
                width: dlg.width - 40
                x: 20; y: 16
                spacing: 16

                // Number of parts selection (Segmented Pill)
                ColumnLayout {
                    Layout.fillWidth: true
                    spacing: 8

                    Label {
                        text: "SỐ LƯỢNG VIDEO CẦN TÁCH:"
                        color: Theme.textMuted
                        font.pixelSize: 11
                        font.bold: true
                    }

                    RowLayout {
                        spacing: 8
                        Repeater {
                            model: [
                                {parts: 1, label: "1 Video (Giữ nguyên)"},
                                {parts: 2, label: "2 Phần (Part 1, 2)"},
                                {parts: 3, label: "3 Phần (Part 1, 2, 3)"}
                            ]
                            delegate: Rectangle {
                                readonly property bool active: dlg.numParts === modelData.parts
                                Layout.preferredHeight: 34
                                Layout.fillWidth: true
                                radius: Theme.radiusMd
                                color: active ? Theme.accent + "33" : Theme.inputBg
                                border.color: active ? Theme.accent : Theme.border
                                border.width: 1

                                Label {
                                    anchors.centerIn: parent
                                    text: modelData.label
                                    color: active ? Theme.accent : Theme.textMuted
                                    font.pixelSize: 12
                                    font.bold: active
                                }

                                MouseArea {
                                    anchors.fill: parent
                                    cursorShape: Qt.PointingHandCursor
                                    onClicked: dlg.numParts = modelData.parts
                                }
                            }
                        }
                    }
                }

                // Per-part titles
                ColumnLayout {
                    Layout.fillWidth: true
                    spacing: 8

                    Label {
                        text: "TIÊU ĐỀ TỪNG PHẦN & THỜI LƯỢNG DỰ KIẾN:"
                        color: Theme.textMuted
                        font.pixelSize: 11
                        font.bold: true
                    }

                    Repeater {
                        model: 3
                        delegate: RowLayout {
                            Layout.fillWidth: true
                            visible: index < dlg.numParts
                            spacing: 8

                            Rectangle {
                                width: 70
                                height: 34
                                radius: Theme.radiusSm
                                color: Theme.inputBg
                                border.color: Theme.border
                                border.width: 1
                                Label {
                                    anchors.centerIn: parent
                                    text: "Phần " + (index + 1)
                                    color: Theme.text
                                    font.pixelSize: 12
                                    font.bold: true
                                }
                            }

                            TextField {
                                id: titleField
                                Layout.fillWidth: true
                                Layout.preferredHeight: 34
                                font.pixelSize: 12
                                color: Theme.text
                                placeholderTextColor: Theme.textMuted
                                placeholderText: "Nhập tiêu đề phần " + (index + 1) + "..."
                                text: dlg.titleInputs[index]
                                background: Rectangle {
                                    color: Theme.inputBg
                                    border.color: titleField.activeFocus ? Theme.accent : Theme.border
                                    border.width: 1
                                    radius: Theme.radiusSm
                                }
                                onEditingFinished: {
                                    var arr = dlg.titleInputs.slice()
                                    arr[index] = text
                                    dlg.titleInputs = arr
                                }
                            }

                            // Duration badge
                            Rectangle {
                                width: 110
                                height: 34
                                radius: Theme.radiusSm
                                color: Qt.rgba(0, 0, 0, 0.2)
                                border.color: Theme.border
                                border.width: 1

                                Label {
                                    anchors.centerIn: parent
                                    text: {
                                        var partDur = dlg.totalDuration / Math.max(1, dlg.numParts)
                                        var start = index * partDur
                                        var end = Math.min((index + 1) * partDur, dlg.totalDuration)
                                        return formatTime(start) + " → " + formatTime(end)
                                    }
                                    color: Theme.textMuted
                                    font.pixelSize: 11
                                    font.family: "monospace"
                                }
                            }
                        }
                    }
                }

                // Render Settings Group
                Rectangle {
                    Layout.fillWidth: true
                    Layout.preferredHeight: renderSetCol.implicitHeight + 24
                    color: Theme.inputBg
                    border.color: Theme.border
                    border.width: 1
                    radius: Theme.radiusMd

                    ColumnLayout {
                        id: renderSetCol
                        anchors.fill: parent
                        anchors.margins: 12
                        spacing: 10

                        Label {
                            text: "CẤU HÌNH RENDER XUẤT BẢN:"
                            color: Theme.textMuted
                            font.pixelSize: 10
                            font.bold: true
                        }

                        RowLayout {
                            Layout.fillWidth: true
                            spacing: 16

                            // Resolution
                            ColumnLayout {
                                Layout.fillWidth: true
                                spacing: 4
                                Label { text: "Độ phân giải"; color: Theme.textMuted; font.pixelSize: 11 }
                                ComboBox {
                                    id: resCombo
                                    Layout.fillWidth: true
                                    Layout.preferredHeight: 32
                                    model: ["1080p", "720p", "480p", "360p"]
                                    currentIndex: (typeof settings !== "undefined" && settings !== null) ? model.indexOf(settings.autoRenderResolution) : 0
                                }
                            }

                            // FPS
                            ColumnLayout {
                                Layout.fillWidth: true
                                spacing: 4
                                Label { text: "Tốc độ khung hình (FPS)"; color: Theme.textMuted; font.pixelSize: 11 }
                                ComboBox {
                                    id: fpsCombo
                                    Layout.fillWidth: true
                                    Layout.preferredHeight: 32
                                    model: [30, 60]
                                    currentIndex: (typeof settings !== "undefined" && settings !== null) ? [30, 60].indexOf(settings.autoRenderFPS) : 0
                                }
                            }

                            // Speed Slider
                            ColumnLayout {
                                Layout.fillWidth: true
                                spacing: 4
                                RowLayout {
                                    Label { text: "Tốc độ phát:"; color: Theme.textMuted; font.pixelSize: 11 }
                                    Label { text: speedSlider.value.toFixed(1) + "x"; color: Theme.accent; font.pixelSize: 11; font.bold: true }
                                }
                                Slider {
                                    id: speedSlider
                                    Layout.fillWidth: true
                                    from: 1.0; to: 2.0; stepSize: 0.1
                                    value: (typeof settings !== "undefined" && settings !== null) ? settings.autoRenderSpeed : 1.0
                                }
                            }
                        }
                    }
                }
            }
        }

        // Footer
        Rectangle {
            Layout.fillWidth: true
            Layout.preferredHeight: 60
            color: Qt.rgba(0, 0, 0, 0.25)
            border.color: Theme.border
            border.width: 1

            RowLayout {
                anchors.fill: parent
                anchors.leftMargin: 20
                anchors.rightMargin: 20
                spacing: 12

                CheckBox {
                    id: autoRenderSwitch
                    text: "Tự động render ngay sau khi tách"
                    checked: true
                }

                Item { Layout.fillWidth: true }

                Rectangle {
                    Layout.preferredWidth: 80
                    Layout.preferredHeight: 34
                    radius: Theme.radiusMd
                    color: cancelMa.containsMouse ? Theme.hoverBg : "transparent"
                    border.color: cancelMa.containsMouse ? Theme.cardBorderHover : Theme.border
                    border.width: 1

                    Label {
                        anchors.centerIn: parent
                        text: "Hủy bỏ"
                        color: cancelMa.containsMouse ? "#FFFFFF" : Theme.textMuted
                        font.pixelSize: 12
                        font.bold: true
                    }

                    MouseArea {
                        id: cancelMa
                        anchors.fill: parent
                        hoverEnabled: true
                        cursorShape: Qt.PointingHandCursor
                        onClicked: dlg.close()
                    }
                }

                Rectangle {
                    Layout.preferredWidth: 160
                    Layout.preferredHeight: 34
                    radius: Theme.radiusMd
                    color: startSplitMa.containsMouse ? Theme.accentHover : Theme.accent

                    RowLayout {
                        anchors.centerIn: parent
                        spacing: 6
                        Icon {
                            name: "render"
                            size: 13
                            color: "#FFFFFF"
                        }
                        Label {
                            text: autoRenderSwitch.checked ? "Tách & Render Ngay" : "Tách File"
                            color: "#FFFFFF"
                            font.pixelSize: 12
                            font.bold: true
                        }
                    }

                    MouseArea {
                        id: startSplitMa
                        anchors.fill: parent
                        hoverEnabled: true
                        cursorShape: Qt.PointingHandCursor
                        onClicked: {
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

                            backend.send_command_async("workspace:split", {
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
        }
    }

    function formatTime(sec) {
        var m = Math.floor(sec / 60)
        var s = Math.floor(sec % 60)
        return m + ":" + (s < 10 ? "0" : "") + s
    }
}
