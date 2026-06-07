// src/ui/qml/SplitModal.qml
// Split a workspace into N parts (auto/manual)
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Dialog {
    id: dlg
    title: "Tách video thành nhiều phần"
    modal: true
    width: 480
    height: 380

    property string workspaceId: ""
    property int totalDuration: 600  // seconds
    property int numParts: 2
    property var intervals: []

    function openFor(id, duration) {
        workspaceId = id
        totalDuration = duration || 600
        numParts = 2
        intervals = []
        open()
    }

    ColumnLayout {
        anchors.fill: parent
        spacing: 12

        // Mode toggle
        RowLayout {
            Layout.fillWidth: true
            Label {
                text: "Mode:"
                color: Theme.textMuted
                font.pixelSize: 11
            }
            RadioButton {
                text: "Tự động (chia đều)"
                checked: true
                onToggled: { if (checked) partSpinner.enabled = true; manualBox.visible = false }
            }
            RadioButton {
                text: "Thủ công"
                onToggled: { if (checked) partSpinner.enabled = false; manualBox.visible = true }
            }
        }

        // Auto: spinner
        RowLayout {
            Layout.fillWidth: true
            Label { text: "Số phần:"; color: Theme.textMuted; font.pixelSize: 11 }
            SpinBox {
                id: partSpinner
                from: 2
                to: 10
                value: dlg.numParts
                onValueChanged: dlg.numParts = value
            }
            Label {
                text: "≈ " + Math.floor(dlg.totalDuration / Math.max(1, dlg.numParts) / 60) + ":" +
                      (Math.floor(dlg.totalDuration / Math.max(1, dlg.numParts) % 60) < 10 ? "0" : "") +
                      Math.floor(dlg.totalDuration / Math.max(1, dlg.numParts) % 60) + " mỗi phần"
                color: Theme.textMuted
                font.pixelSize: 10
            }
        }

        // Manual: interval input
        GroupBox {
            id: manualBox
            visible: false
            Layout.fillWidth: true
            title: "Thời điểm kết thúc (giây, phân cách bởi dấu phẩy)"
            background: Rectangle {
                color: Theme.bg
                border.color: Theme.border
                border.width: 1
            }
            label: Label {
                text: parent.title
                color: Theme.accent
                font.pixelSize: 10
            }
            TextField {
                id: manualField
                Layout.fillWidth: true
                placeholderText: "120, 240, 360, ..."
                onEditingFinished: {
                    dlg.intervals = text.split(",").map(s => parseFloat(s.trim())).filter(x => !isNaN(x))
                }
            }
        }

        // Preview
        GroupBox {
            Layout.fillWidth: true
            title: "PREVIEW"
            background: Rectangle {
                color: Theme.bg
                border.color: Theme.border
                border.width: 1
            }
            label: Label {
                text: parent.title
                color: Theme.accent
                font.pixelSize: 10
            }
            ColumnLayout {
                anchors.fill: parent
                spacing: 2
                Repeater {
                    model: {
                        const parts = dlg.intervals.length > 0
                            ? dlg.intervals.length + 1
                            : dlg.numParts
                        const partDur = dlg.totalDuration / Math.max(1, parts)
                        return parts
                    }
                    delegate: Label {
                        text: "Part " + (index + 1) + ": 00:00 → " +
                              Math.floor((index + 1) * dlg.totalDuration / dlg.numParts / 60) + ":" +
                              (Math.floor((index + 1) * dlg.totalDuration / dlg.numParts % 60) < 10 ? "0" : "") +
                              Math.floor((index + 1) * dlg.totalDuration / dlg.numParts % 60)
                        color: Theme.text
                        font.pixelSize: 10
                        font.family: "monospace"
                    }
                }
            }
        }

        RowLayout {
            Layout.fillWidth: true
            Switch {
                text: "Auto-render sau khi tách"
                checked: true
            }
            Item { Layout.fillWidth: true }
            Button {
                text: "Hủy"
                onClicked: dlg.close()
            }
            Button {
                text: "Tách"
                onClicked: {
                    backend.send_command("workspace:split", {
                        "id": dlg.workspaceId,
                        "intervals": dlg.intervals.length > 0 ? dlg.intervals : null,
                        "numParts": dlg.numParts,
                        "autoRender": true
                    })
                    activityModel.add_entry("ws", "Splitting " + dlg.workspaceId, "info")
                    dlg.close()
                }
            }
        }
    }
}
