// src/ui/qml/OperationPanel.qml
// MMO Operation Center — consolidated view of poller, auth, sessions, projects, keys
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

ScrollView {
    id: root
    clip: true

    ColumnLayout {
        id: contentLayout
        width: root.width - 24
        spacing: 16
        x: 12
        y: 12

        // ─── Header ──────────────────────────────────────────────
        RowLayout {
            Layout.fillWidth: true
            Label {
                text: "Trung tâm vận hành"
                color: Theme.text
                font.pixelSize: 30
                font.bold: true
                Layout.bottomMargin: 8
            }
            Item { Layout.fillWidth: true }
            StatusDot {
                state: (poller && poller.active) ? "running" : "paused"
                size: 12
                showRing: poller && poller.active
                Layout.alignment: Qt.AlignVCenter
            }
            Label {
                text: (poller && poller.active) ? "ĐANG CHẠY" : "TẠM DỪNG"
                color: (poller && poller.active) ? Theme.success : Theme.textMuted
                font.pixelSize: 16
                font.bold: true
                Layout.alignment: Qt.AlignVCenter
            }
        }

        // ─── Row 1: Poller + Auth ────────────────────────────────
        RowLayout {
            Layout.fillWidth: true
            spacing: 12

            PollerPanel { Layout.fillWidth: true; Layout.preferredHeight: 420; Layout.minimumWidth: 320 }
            AuthPanel { Layout.fillWidth: true; Layout.preferredHeight: 420; Layout.minimumWidth: 320 }
        }

        // ─── Row 2: Sessions + Projects + Keys ───────────────────
        RowLayout {
            Layout.fillWidth: true
            spacing: 12

            SessionsPanel { Layout.fillWidth: true; Layout.preferredHeight: 320; Layout.minimumWidth: 280 }
            ProjectsPanel { Layout.fillWidth: true; Layout.preferredHeight: 320; Layout.minimumWidth: 280 }
            KeysPanel { Layout.fillWidth: true; Layout.preferredHeight: 320; Layout.minimumWidth: 280 }
        }
    }
}