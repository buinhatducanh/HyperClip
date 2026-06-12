// src/ui/qml/DetectionPanel.qml
// Detection thresholds + poller monitoring + activity log
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

ScrollView {
    id: root
    clip: true

    ColumnLayout {
        width: root.width - 24
        spacing: 12
        x: 12
        y: 12

        // ─── Detection filter settings ─────────────────────
        SettingsCard {
            title: "BỘ LỌC PHÁT HIỆN"

            ColumnLayout {
                width: parent.width
                spacing: 6

                RowLayout {
                    Layout.fillWidth: true
                    spacing: 8
                    Label {
                        text: "Bật quét"
                        color: Theme.textMuted
                        font.pixelSize: 11
                    }
                    Item { Layout.fillWidth: true }
                    Switch {
                        checked: settings.pollingEnabled
                        onToggled: settings.pollingEnabled = checked
                    }
                }

                Label {
                    text: "Trạng thái: " + (poller.active ? "Đang chạy" : "Tạm dừng")
                          + (poller.lastError ? " · " + poller.lastError : "")
                    color: poller.active ? Theme.success : Theme.textMuted
                    font.pixelSize: 10
                }

                GridLayout {
                    columns: 2
                    columnSpacing: 16
                    rowSpacing: 6
                    Layout.fillWidth: true

                    Label { text: "Chu kỳ (ms)"; color: Theme.textMuted; font.pixelSize: 11 }
                    SpinBox {
                        Layout.fillWidth: true
                        from: 1000; to: 60000; stepSize: 500
                        value: settings.pollIntervalMs
                        editable: true
                        onValueModified: settings.pollIntervalMs = value
                    }

                    Label { text: "TG tối thiểu (s)"; color: Theme.textMuted; font.pixelSize: 11 }
                    SpinBox {
                        Layout.fillWidth: true
                        from: 0; to: 3600
                        value: settings.videoMinDurationSec
                        editable: true
                        onValueModified: settings.videoMinDurationSec = value
                    }

                    Label { text: "TG tối đa (phút)"; color: Theme.textMuted; font.pixelSize: 11 }
                    TextField {
                        Layout.fillWidth: true
                        text: Math.round(settings.videoMaxDurationSec / 60).toString()
                        validator: IntValidator { bottom: 1; top: 120 }
                        onEditingFinished: {
                            let mins = parseInt(text)
                            if (!isNaN(mins)) {
                                settings.videoMaxDurationSec = mins * 60
                            }
                        }
                    }
                }

                Button {
                    text: poller.active ? "Tạm dừng" : "Tiếp tục"
                    onClicked: poller.active ? poller.pause(backend) : poller.resume(backend)
                }
            }
        }

        // ─── Poller monitoring + activity log ──────────────
        PollerPanel { Layout.fillWidth: true; Layout.preferredHeight: 380 }
    }
}
