// src/ui/qml/PollerPanel.qml
// Poller control — status, latency metrics, activity log.
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

SettingsCard {
    title: "PHÁT HIỆN"
    Layout.preferredHeight: 380
    Layout.minimumHeight: 300
    Layout.fillHeight: true

    // ─── Top bar: status + controls ────────────────────────
    RowLayout {
        Layout.fillWidth: true
        StatusDot {
            state: (poller && poller.active) ? "running" : "paused"
            size: 8
            showRing: poller && poller.active
            Layout.alignment: Qt.AlignVCenter
        }
        Label {
            text: (poller && poller.active) ? "ĐANG CHẠY" : "TẠM DỪNG"
            color: (poller && poller.active) ? Theme.success : Theme.textMuted
            font.pixelSize: 15
            font.bold: true
        }
        Label {
            text: "| " + (poller ? poller.pollIntervalMs : 3000) + "ms"
            color: Theme.textMuted
            font.pixelSize: 14
            font.family: "monospace"
        }
        Item { Layout.fillWidth: true }
        IconButton {
            iconName: (poller && poller.active) ? "pause" : "play"
            label: (poller && poller.active) ? "Tạm dừng" : "Tiếp tục"
            iconSize: 12
            Layout.minimumWidth: 80
            onClicked: if (poller) { poller.active ? poller.pause(backend) : poller.resume(backend) }
        }
        IconButton {
            iconName: "refresh"
            iconSize: 14
            Layout.preferredWidth: 32
            Layout.preferredHeight: 28
            onClicked: if (poller) { poller.refresh_from_backend(backend) }
        }
    }

    // ─── 3 metric chips ────────────────────────────────────
    RowLayout {
        spacing: 4

        Rectangle {
            Layout.fillWidth: true; Layout.preferredHeight: 22
            color: ((poller && poller.detectionsToday > 0 && poller.lastDetectionLatencyStr !== "—") ? poller.latencyColor : Theme.textMuted) + "18"; radius: 4
            border.color: (poller && poller.detectionsToday > 0 && poller.lastDetectionLatencyStr !== "—") ? poller.latencyColor : Theme.textMuted; border.width: 1
            Label {
                anchors.centerIn: parent
                text: (poller && poller.detectionsToday > 0) ? poller.lastDetectionLatencyStr + " cuối" : "— cuối"
                color: (poller && poller.detectionsToday > 0 && poller.lastDetectionLatencyStr !== "—") ? poller.latencyColor : Theme.textMuted
                font.pixelSize: 14; font.bold: true
            }
        }

        Rectangle {
            Layout.fillWidth: true; Layout.preferredHeight: 22
            color: ((poller && poller.detectionsToday > 0) ? poller.slaColor : Theme.textMuted) + "18"; radius: 4
            border.color: (poller && poller.detectionsToday > 0) ? poller.slaColor : Theme.textMuted; border.width: 1
            Label {
                anchors.centerIn: parent
                text: (poller && poller.detectionsToday > 0) ? poller.slaPercent.toFixed(0) + "% <5s" : "— <5s"
                color: (poller && poller.detectionsToday > 0) ? poller.slaColor : Theme.textMuted
                font.pixelSize: 14; font.bold: true
            }
        }

        Rectangle {
            Layout.fillWidth: true; Layout.preferredHeight: 22
            color: Theme.accent + "18"; radius: 4
            border.color: Theme.accent; border.width: 1
            Label {
                anchors.centerIn: parent
                text: (poller ? poller.detectionsToday : 0) + " hôm nay"
                color: Theme.accent
                font.pixelSize: 14; font.bold: true
            }
        }
    }

    // ─── Activity list ───────────────────────────────────────
    RowLayout {
        Layout.fillWidth: true
        Layout.topMargin: 2
        Label {
            text: "LỊCH SỬ PHÁT HIỆN"
            color: Theme.textMuted
            font.pixelSize: 15; font.bold: true
        }
        Item { Layout.fillWidth: true }
        IconButton {
            iconName: "trash"
            label: "Xóa"
            iconSize: 12
            Layout.preferredHeight: 24
            onClicked: {
                if (detectionHistory) {
                    detectionHistory.clear(backend)
                    if (poller) {
                        poller.refresh_from_backend(backend)
                    }
                }
            }
        }
    }

    ListView {
        id: detList
        Layout.fillWidth: true
        Layout.fillHeight: true
        Layout.minimumHeight: 100
        model: detectionHistory
        clip: true
        spacing: 1
        delegate: Rectangle {
            id: item
            width: detList.width
            height: layout.implicitHeight + 16
            color: expanded ? Theme.cardBg : (index % 2 === 0 ? Theme.rowEven : "transparent")
            radius: 3

            property bool expanded: false

            ColumnLayout {
                id: layout
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.top: parent.top
                anchors.margins: 8
                spacing: 6

                // Compact row
                RowLayout {
                    id: compactRow
                    Layout.fillWidth: true
                    spacing: 8

                    // Time column
                    Label {
                        text: model.detectedTimeStr || ""
                        color: Theme.textMuted; font.pixelSize: 14
                        font.family: "monospace"; Layout.preferredWidth: 60
                    }
                    // Age at detection — colored by WHO caused the latency:
                    // catchup (app was off when published) and YouTube-side
                    // surfacing delays are not app failures, so they must not
                    // show as red.
                    Label {
                        text: {
                            if (model.status === "scheduled") return "hẹn giờ"
                            const age = model.ageAtDetection || "—"
                            if (model.latencySource === "catchup") return age + " bù"
                            if (model.latencySource === "youtube") return age + " YT"
                            return age
                        }
                        color: model.status === "scheduled" ? "#FFB74D"
                             : model.latencySource === "catchup" ? Theme.textMuted
                             : model.latencySource === "youtube" ? "#4FC3F7"
                             : (model.latencyMs > 0 && model.latencyMs < 5000) ? Theme.success
                             : (model.latencyMs < 10000) ? "#FFD93D" : Theme.error
                        font.pixelSize: 14; font.bold: true
                        Layout.preferredWidth: 62
                    }
                    // Status badge
                    Label {
                        text: {
                            switch(model.status) {
                                case "waiting": return "Chờ"
                                case "downloading": return "Đang tải"
                                case "ready": return "Sẵn sàng"
                                case "scheduled": return "Chờ chiếu"
                                case "error": return "Lỗi"
                                default: return model.status || "—"
                            }
                        }
                        color: model.status === "ready" ? Theme.success
                             : model.status === "error" ? Theme.error
                             : model.status === "downloading" ? "#FFD93D"
                             : Theme.textMuted
                        font.pixelSize: 14; font.bold: true
                        Layout.preferredWidth: 70
                    }
                    // Title — scheduled premieres show YouTube's own schedule text
                    // ("Công chiếu 18:35") so the customer knows the app saw the
                    // premiere and is waiting for air time.
                    Label {
                        text: {
                            const t = model.title || ""
                            if (model.status === "scheduled" && model.scheduleText)
                                return t + "  —  " + model.scheduleText
                            return t
                        }
                        color: Theme.text; font.pixelSize: 14
                        elide: Text.ElideRight; Layout.fillWidth: true
                    }
                }

                // Expanded detail
                ColumnLayout {
                    id: detailRow
                    Layout.fillWidth: true
                    visible: item.expanded
                    spacing: 2

                    RowLayout { Layout.fillWidth: true; spacing: 8; Layout.preferredHeight: 16
                        Label { text: "Ngày xuất bản"; color: Theme.textMuted; font.pixelSize: 12; Layout.preferredWidth: 70 }
                        Label { text: model.publishedDateStr || "—"; color: Theme.text; font.pixelSize: 12 }
                        Item { Layout.fillWidth: true }
                        Label { text: "Ngày phát hiện"; color: Theme.textMuted; font.pixelSize: 12; Layout.preferredWidth: 70 }
                        Label { text: model.detectedDateStr || "—"; color: Theme.text; font.pixelSize: 12 }
                    }
                    RowLayout { Layout.fillWidth: true; spacing: 8; Layout.preferredHeight: 16
                        Label { text: "Kênh"; color: Theme.textMuted; font.pixelSize: 12; Layout.preferredWidth: 70 }
                        Label { text: model.channelName || "—"; color: Theme.text; font.pixelSize: 12; elide: Text.ElideRight; Layout.fillWidth: true }
                    }
                    RowLayout { Layout.fillWidth: true; spacing: 8; Layout.preferredHeight: 16
                        Label { text: "Download"; color: Theme.textMuted; font.pixelSize: 12; Layout.preferredWidth: 70 }
                        Label { text: model.downloadedSize > 0 ? (model.downloadedSize/1048576).toFixed(1)+"MB in "+(model.downloadTimeSec || 0).toFixed(1)+"s" : "—"; color: Theme.text; font.pixelSize: 12 }
                        Item { Layout.fillWidth: true }
                        Label { text: model.width > 0 ? model.width+"×"+model.height : ""; color: Theme.textMuted; font.pixelSize: 12 }
                    }
                }
            }

            MouseArea {
                anchors.fill: parent
                onClicked: item.expanded = !item.expanded
                z: -1
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