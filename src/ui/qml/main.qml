import QtQuick
import QtQuick.Window
import QtQuick.Layouts
import QtQuick.Controls

ApplicationWindow {
    id: root
    width: 1280
    height: 800
    visible: true
    title: "HyperClip"
    color: Theme.bg

    // Navigation
    property string currentPage: "dashboard"
    property string sidebarHighlight: "queue"

    RowLayout {
        anchors.fill: parent
        spacing: 0

        // ─── Left: Sidebar — ALWAYS visible ──────────────────────
        Sidebar {
            id: sidebar
            Layout.preferredWidth: 220
            Layout.fillHeight: true
            activeItem: root.sidebarHighlight
            onNavigateToPage: function(page) {
                root.sidebarHighlight = page
                if (page === "settings") root.currentPage = "settings"
                else if (page === "operation") root.currentPage = "operation"
                else root.currentPage = "dashboard"
            }
        }

        // ─── Right: Content area ─────────────────────────────────
        // All pages always mounted, visibility-switched (preserves state)
        Item {
            Layout.fillWidth: true
            Layout.fillHeight: true

            // Dashboard 3-pane
            RowLayout {
                id: dashboardContent
                anchors.fill: parent
                spacing: 0
                visible: root.currentPage === "dashboard"

                WorkspaceQueue {
                    id: workspaceQueue
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                }
                DetailEditor {
                    id: detailEditor
                    Layout.preferredWidth: 400
                    Layout.fillHeight: true
                }
            }

            // Settings full page
            SettingsPage {
                anchors.fill: parent
                visible: root.currentPage === "settings"
            }

            // Operation full page
            OperationPanel {
                anchors.fill: parent
                visible: root.currentPage === "operation"
            }
        }
    }

    // ─── LoginScreen overlay ───────────────────────────────────────
    LoginScreen {
        id: loginOverlay
        anchors.fill: parent
        visible: !auth.isReady
        z: 999
    }

    // ─── Update toast ──────────────────────────────────────────────
    Rectangle {
        id: updateToast
        anchors.right: parent.right
        anchors.bottom: parent.bottom
        anchors.margins: 16
        visible: false
        width: 360
        height: 60
        color: Theme.bg
        border.color: Theme.accent
        border.width: 1
        Label {
            anchors.centerIn: parent
            text: "🆕 Update available"
            color: Theme.accent
            font.pixelSize: 12
        }
    }
}
