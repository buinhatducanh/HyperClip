// src/ui/qml/DashboardGrid.qml
// Single integrated dashboard: queue (left), system/detection/rendered (right), activity log (bottom)
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Rectangle {
    id: root
    color: Theme.bg

    property string filterChannelId: ""
    signal openDetail(string type, string id)  // "workspace" | "rendered"

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 6
        spacing: 4

        // ─── Main row: Queue (left) | System/Detection/Rendered (right) ──
        RowLayout {
            Layout.fillWidth: true
            Layout.fillHeight: true
            spacing: 4

            // ─── Left: Queue + DetailEditor ──────────────────────────
            RowLayout {
                Layout.fillWidth: true
                Layout.fillHeight: true
                spacing: 4

                WorkspaceQueue {
                    id: queue
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    channelFilter: root.filterChannelId
                }

                DetailEditor {
                    id: detailEditor
                    Layout.preferredWidth: 380
                    Layout.fillHeight: true
                }
            }

            // ─── Right panel: System → Detection → Rendered ──────────
            Rectangle {
                Layout.preferredWidth: 280
                Layout.fillHeight: true
                color: "transparent"

                ColumnLayout {
                    anchors.fill: parent
                    spacing: 4

                    // System monitor
                    SystemMonitor {
                        Layout.fillWidth: true
                    }

                    // Detection status (compact)
                    Rectangle {
                        Layout.fillWidth: true
                        Layout.preferredHeight: 80
                        color: Theme.cardBg
                        border.color: Theme.border
                        border.width: 1

                        ColumnLayout {
                            anchors.fill: parent
                            anchors.margins: 6
                            spacing: 2

                            Label {
                                text: "PHÁT HIỆN"
                                color: Theme.textMuted
                                font.pixelSize: 12
                                font.bold: true
                            }

                            RowLayout {
                                spacing: 6
                                Rectangle {
                                    width: 6; height: 6; radius: 3
                                    color: (poller && poller.active) ? Theme.success : Theme.textMuted
                                }
                                Label {
                                    text: (poller && poller.active) ? "ĐANG CHẠY" : "TẠM DỪNG"
                                    color: (poller && poller.active) ? Theme.success : Theme.textMuted
                                    font.pixelSize: 13; font.bold: true
                                }
                                Label {
                                    text: "| " + (poller ? poller.pollIntervalMs : 3000) + "ms"
                                    color: Theme.textMuted
                                    font.pixelSize: 12
                                }
                                Item { Layout.fillWidth: true }
                            }
 
                            RowLayout {
                                spacing: 4
                                Rectangle {
                                    Layout.fillWidth: true
                                    height: 18
                                    color: (poller && poller.detectionsToday > 0 && poller.lastDetectionLatencyStr !== "—") ? poller.latencyColor : Theme.textMuted
                                    opacity: 0.2
                                    radius: 3
                                    Label {
                                        anchors.centerIn: parent
                                        text: poller ? (poller.lastDetectionLatencyStr || "—") : "—"
                                        font.pixelSize: 11; font.bold: true
                                    }
                                }
                                Rectangle {
                                    Layout.fillWidth: true
                                    height: 18
                                    color: (poller && poller.detectionsToday > 0) ? poller.slaColor : Theme.textMuted
                                    opacity: 0.2
                                    radius: 3
                                    Label {
                                        anchors.centerIn: parent
                                        text: (poller && poller.detectionsToday > 0) ? (poller.slaPercent.toFixed(0) + "% <5s") : "— <5s"
                                        font.pixelSize: 11; font.bold: true
                                    }
                                }
                                Rectangle {
                                    Layout.fillWidth: true
                                    height: 18
                                    color: Theme.accent
                                    opacity: 0.2
                                    radius: 3
                                    Label {
                                        anchors.centerIn: parent
                                        text: (poller ? (poller.detectionsToday || 0) : 0) + " hôm nay"
                                        font.pixelSize: 11; font.bold: true
                                    }
                                }
                            }
                        }
                    }

                    // ─── Rendered videos (compact) ──────────────────
                    Rectangle {
                        Layout.fillWidth: true
                        Layout.fillHeight: true
                        color: Theme.cardBg
                        border.color: Theme.border
                        border.width: 1
                        Layout.preferredHeight: 200

                        ColumnLayout {
                            anchors.fill: parent
                            anchors.margins: 6
                            spacing: 2

                            Label {
                                text: "ĐÃ RENDER"
                                color: Theme.textMuted
                                font.pixelSize: 12
                                font.bold: true
                            }

                            ListView {
                                id: renderedMini
                                Layout.fillWidth: true
                                Layout.fillHeight: true
                                model: renderedModel
                                clip: true
                                spacing: 1

                                delegate: Rectangle {
                                    width: renderedMini.width
                                    height: 32
                                    color: index % 2 === 0 ? Theme.rowEven : "transparent"

                                    RowLayout {
                                        anchors.fill: parent
                                        anchors.margins: 4
                                        spacing: 4

                                        Label {
                                            text: "🎬"
                                            font.pixelSize: 14
                                            Layout.preferredWidth: 18
                                        }
                                        ColumnLayout {
                                            Layout.fillWidth: true
                                            spacing: 0
                                            Label {
                                                text: model.title || ""
                                                color: Theme.text
                                                font.pixelSize: 13
                                                elide: Text.ElideRight
                                                Layout.fillWidth: true
                                            }
                                            Label {
                                                text: (model.channelName || "—") + " · " + (model.quality || "")
                                                color: Theme.textMuted
                                                font.pixelSize: 11
                                            }
                                        }
                                        Label {
                                            text: model.fileSize ? (model.fileSize/1048576).toFixed(1) + "MB" : ""
                                            color: Theme.textMuted
                                            font.pixelSize: 12
                                        }
                                    }

                                    MouseArea {
                                        anchors.fill: parent
                                        cursorShape: Qt.PointingHandCursor
                                        onClicked: {
                                            detailEditor.loadRendered(model.id)
                                        }
                                    }
                                }

                                Label {
                                    anchors.centerIn: parent
                                    visible: renderedMini.count === 0
                                    text: "Chưa có"
                                    color: Theme.textMuted
                                    font.pixelSize: 14
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
