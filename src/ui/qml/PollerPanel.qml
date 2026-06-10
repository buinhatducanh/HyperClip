// src/ui/qml/PollerPanel.qml
// Poller control — status, latency metrics, activity log.
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

SettingsCard {
    title: "PHÁT HIỆN"
    Layout.preferredHeight: 340

    ColumnLayout {
        width: parent.width
        spacing: 6

        // ─── Top bar: status + controls ────────────────────────
        RowLayout {
            Layout.fillWidth: true
            StatusDot {
                state: poller.active ? "running" : "paused"
                size: 8
                showRing: poller.active
                Layout.alignment: Qt.AlignVCenter
            }
            Label {
                text: poller.active ? "ĐANG CHẠY" : "TẠM DỪNG"
                color: poller.active ? Theme.success : Theme.textMuted
                font.pixelSize: 15
                font.bold: true
            }
            Label {
                text: "| " + poller.pollIntervalMs + "ms"
                color: Theme.textMuted
                font.pixelSize: 14
                font.family: "monospace"
            }
            Item { Layout.fillWidth: true }
            IconButton {
                iconName: poller.active ? "pause" : "play"
                label: poller.active ? "Tạm dừng" : "Tiếp tục"
                iconSize: 12
                Layout.minimumWidth: 80
                onClicked: poller.active ? poller.pause(backend) : poller.resume(backend)
            }
            IconButton {
                iconName: "refresh"
                iconSize: 14
                Layout.preferredWidth: 32
                Layout.preferredHeight: 28
                onClicked: poller.refresh_from_backend(backend)
            }
        }

        // ─── 3 metric chips ────────────────────────────────────
        RowLayout {
            spacing: 4

            Rectangle {
                Layout.fillWidth: true; Layout.preferredHeight: 22
                color: poller.latencyColor + "18"; radius: 4
                border.color: poller.latencyColor; border.width: 1
                Label {
                    anchors.centerIn: parent
                    text: poller.lastDetectionLatencyStr + " cuối"
                    color: poller.latencyColor
                    font.pixelSize: 14; font.bold: true
                }
            }

            Rectangle {
                Layout.fillWidth: true; Layout.preferredHeight: 22
                color: poller.slaColor + "18"; radius: 4
                border.color: poller.slaColor; border.width: 1
                Label {
                    anchors.centerIn: parent
                    text: poller.slaPercent.toFixed(0) + "% <5s"
                    color: poller.slaColor
                    font.pixelSize: 14; font.bold: true
                }
            }

            Rectangle {
                Layout.fillWidth: true; Layout.preferredHeight: 22
                color: Theme.accent + "18"; radius: 4
                border.color: Theme.accent; border.width: 1
                Label {
                    anchors.centerIn: parent
                    text: poller.detectionsToday + " hôm nay"
                    color: Theme.accent
                    font.pixelSize: 14; font.bold: true
                }
            }
        }

        // ─── Activity list ─────────────────────────────────────
        Label {
            text: "GẦN ĐÂY"
            color: Theme.textMuted
            font.pixelSize: 15; font.bold: true
            Layout.topMargin: 2
        }

        ListView {
            id: detList
            Layout.fillWidth: true
            Layout.fillHeight: true
            model: detectionHistory
            clip: true
            spacing: 2
            delegate: Rectangle {
                id: item
                width: detList.width
                height: compactRow.height + (expanded ? detailRow.height + 10 : 0)
                color: expanded ? Theme.cardBg : (index % 2 === 0 ? Theme.rowEven : "transparent")
                radius: 3

                property bool expanded: false

                ColumnLayout {
                    anchors.fill: parent; anchors.margins: 6; spacing: 4

                    // Compact row
                    RowLayout {
                        id: compactRow
                        Layout.fillWidth: true
                        spacing: 6

                        MouseArea {
                            anchors.fill: parent
                            onClicked: item.expanded = !item.expanded
                        }

                        Label {
                            text: model.detectedTimeStr || ""
                            color: Theme.textMuted; font.pixelSize: 14
                            font.family: "monospace"; Layout.preferredWidth: 38
                        }
                        Label {
                            text: model.title || ""
                            color: Theme.text; font.pixelSize: 14
                            elide: Text.ElideRight; Layout.fillWidth: true
                        }
                        Label {
                            text: model.latencyStr || ""
                            color: item.expanded ? Theme.textMuted
                                  : (model.latencyMs > 0 && model.latencyMs < 5000 ? Theme.success
                                     : model.latencyMs < 10000 ? "#FFD93D" : Theme.error)
                            font.pixelSize: 14; font.bold: true
                        }
                    }

                    // Expanded detail
                    ColumnLayout {
                        id: detailRow
                        Layout.fillWidth: true
                        visible: item.expanded
                        spacing: 1

                        RowLayout { Layout.fillWidth: true; spacing: 6; Layout.preferredHeight: 14
                            Label { text: "Age at detect"; color: Theme.textMuted; font.pixelSize: 12; Layout.preferredWidth: 60 }
                            Label { text: model.ageAtDetection || "—"; color: Theme.text; font.pixelSize: 12 }
                            Item { Layout.fillWidth: true }
                            Label { text: "Status"; color: Theme.textMuted; font.pixelSize: 12 }
                            Label { text: model.status || "—"; color: model.status === "ready" ? Theme.success : model.status === "error" ? Theme.error : Theme.textMuted; font.pixelSize: 12; font.bold: true }
                        }
                        RowLayout { Layout.fillWidth: true; spacing: 6; Layout.preferredHeight: 14
                            Label { text: "Channel"; color: Theme.textMuted; font.pixelSize: 12; Layout.preferredWidth: 60 }
                            Label { text: model.channelName || "—"; color: Theme.text; font.pixelSize: 12; elide: Text.ElideRight; Layout.fillWidth: true }
                        }
                        RowLayout { Layout.fillWidth: true; spacing: 6; Layout.preferredHeight: 14
                            Label { text: "Download"; color: Theme.textMuted; font.pixelSize: 12; Layout.preferredWidth: 60 }
                            Label { text: model.downloadedSize > 0 ? (model.downloadedSize/1048576).toFixed(1)+"MB in "+(model.downloadTimeSec || 0).toFixed(0)+"s" : "—"; color: Theme.text; font.pixelSize: 12 }
                            Item { Layout.fillWidth: true }
                            Label { text: model.width > 0 ? model.width+"×"+model.height : ""; color: Theme.textMuted; font.pixelSize: 12 }
                        }
                    }
                }
            }

            Label {
                visible: detList.count === 0
                anchors.centerIn: parent
                text: "Chưa có lượt phát hiện nào"
                color: Theme.textMuted; font.pixelSize: 16
            }
        }
    }
}
