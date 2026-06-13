// src/ui/qml/main.qml
// Electron-style 3-column layout: TopBar | Sidebar (auto-collapse) | Center | WorkspaceQueue
// Center shows Settings / VideoDetail / RenderedVideoDetail (mutually exclusive, no tab stack)
import QtQuick
import QtQuick.Window
import QtQuick.Layouts
import QtQuick.Controls

ApplicationWindow {
    id: root
    width: 1280
    height: 800
    minimumWidth: 900
    minimumHeight: 600
    visible: true
    title: "HyperClip"
    color: Theme.bg

    // Center pane view state: "settings" | "workspace" | "rendered" | "operation" | "management"
    property string centerView: "settings"
    property string filterChannelId: ""

    ColumnLayout {
        anchors.fill: parent
        spacing: 0

        // ─── TopBar (slim, 40px) ─────────────────────────────────
        TopMenuBar {
            id: topBar
            Layout.fillWidth: true
            centerView: root.centerView
            onNavigateToView: function(view) {
                root.centerView = view
            }
        }

        // ─── Main 3-column area ─────────────────────────────────
        RowLayout {
            Layout.fillWidth: true
            Layout.fillHeight: true
            spacing: 0

            // Left: Sidebar (fixed 220px) — HIDDEN in Operation / Management view
            Sidebar {
                id: sideBar
                Layout.fillHeight: true
                Layout.preferredWidth: (root.centerView === "operation" || root.centerView === "management") ? 0 : 220
                visible: root.centerView !== "operation" && root.centerView !== "management"
                activeChannelId: root.filterChannelId
                onChannelSelected: function(id) {
                    root.filterChannelId = id
                    if (typeof dashGrid !== "undefined" && dashGrid) {
                        dashGrid.filterChannelId = id
                    }
                }
                onAddChannel: function(url) {
                    channelListModel.add_channel(url)
                    if (toastService) toastService.show("Đang thêm kênh", url, "info")
                }
            }

            // Center: Settings / VideoDetail / Rendered / Operation
            Rectangle {
                id: centerPane
                Layout.fillWidth: true
                Layout.fillHeight: true
                Layout.minimumWidth: (root.centerView === "operation" || root.centerView === "management") ? 600 : 400
                color: Theme.bg

                Loader {
                    id: centerLoader
                    anchors.fill: parent
                    sourceComponent: {
                        if (root.centerView === "workspace") return workspaceView
                        if (root.centerView === "rendered") return renderedView
                        if (root.centerView === "operation") return operationView
                        if (root.centerView === "management") return managementView
                        return settingsView
                    }
                }

                Component { id: settingsView; SettingsPanel {} }
                Component { id: workspaceView; VideoDetailPanel {
                    workspaceId: detailEditor.currentWorkspaceId
                    workspaceData: detailEditor.currentWorkspaceData
                } }
                Component { id: renderedView; RenderedVideoDetail {
                    videoId: detailEditor.currentRenderedId
                    videoData: detailEditor.currentRenderedData
                } }
                Component { id: operationView; OperationPanel {} }
                Component { id: managementView; ManagementPanel {} }
            }

            // Right: WorkspaceQueue (240-400px) + rendered mini above — HIDDEN in Operation / Management view
            Rectangle {
                Layout.preferredWidth: (root.centerView === "operation" || root.centerView === "management") ? 0 : 320
                Layout.minimumWidth: (root.centerView === "operation" || root.centerView === "management") ? 0 : 240
                Layout.maximumWidth: (root.centerView === "operation" || root.centerView === "management") ? 0 : 400
                Layout.fillHeight: true
                visible: root.centerView !== "settings" && root.centerView !== "operation" && root.centerView !== "management"
                color: Theme.bg
                border.color: Theme.border
                border.width: 0

                // Left border line
                Rectangle {
                    anchors.left: parent.left
                    anchors.top: parent.top
                    anchors.bottom: parent.bottom
                    width: 1
                    color: Theme.border
                }

                ColumnLayout {
                    anchors.fill: parent
                    spacing: 0

                    // System monitor (compact, fixed height)
                    SystemMonitor {
                        Layout.fillWidth: true
                        Layout.preferredHeight: 110
                    }

                    // Rendered videos (compact list)
                    Rectangle {
                        Layout.fillWidth: true
                        Layout.preferredHeight: 120
                        color: Theme.cardBg
                        border.color: Theme.border
                        border.width: 0

                        Rectangle {
                            anchors.left: parent.left
                            anchors.right: parent.right
                            anchors.bottom: parent.bottom
                            height: 1
                            color: Theme.border
                        }

                        ColumnLayout {
                            anchors.fill: parent
                            anchors.margins: 6
                            spacing: 2

                            RowLayout {
                                spacing: 4
                                Icon {
                                    name: "render"
                                    size: 11
                                    color: Theme.textMuted
                                    Layout.alignment: Qt.AlignVCenter
                                }
                                Label {
                                    text: "ĐÃ RENDER"
                                    color: Theme.textMuted
                                    font.pixelSize: 10
                                    font.bold: true
                                }
                                Item { Layout.fillWidth: true }
                                StatusDot {
                                    state: renderedMini.count > 0 ? "ready" : "idle"
                                    size: 6
                                    showRing: false
                                }
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
                                    height: 24
                                    color: index % 2 === 0 ? Theme.rowEven : "transparent"

                                    RowLayout {
                                        anchors.fill: parent
                                        anchors.leftMargin: 4
                                        anchors.rightMargin: 4
                                        spacing: 4

                                        Icon {
                                            name: "render"
                                            size: 12
                                            color: Theme.accent
                                        }
                                        Label {
                                            text: model.title || ""
                                            color: Theme.text
                                            font.pixelSize: 11
                                            elide: Text.ElideRight
                                            Layout.fillWidth: true
                                        }
                                        Label {
                                            text: model.fileSize ? (model.fileSize/1048576).toFixed(1) + "M" : ""
                                            color: Theme.textMuted
                                            font.pixelSize: 10
                                        }
                                    }

                                    MouseArea {
                                        anchors.fill: parent
                                        cursorShape: Qt.PointingHandCursor
                                        onClicked: {
                                            detailEditor.loadRendered(model.id)
                                            root.centerView = "rendered"
                                            var resp = backend.send_command("rendered:get", {"id": model.id})
                                            if (resp && resp.ok !== false) {
                                                detailEditor.currentRenderedData = resp.result
                                            }
                                        }
                                    }
                                }

                                Label {
                                    anchors.centerIn: parent
                                    visible: renderedMini.count === 0
                                    text: "Chưa có"
                                    color: Theme.textMuted
                                    font.pixelSize: 11
                                }
                            }
                        }
                    }

                    // Workspace queue (fill remaining)
                    WorkspaceQueue {
                        id: queue
                        Layout.fillWidth: true
                        Layout.fillHeight: true
                        channelFilter: root.filterChannelId
                        onOpenWorkspace: function(ws_id) {
                            // Switch view immediately with model data
                            detailEditor.loadWorkspace(ws_id)
                            root.centerView = "workspace"
                            // Async fetch full data from Rust
                            var resp = backend.send_command("workspace:get", {"id": ws_id})
                            if (resp && resp.ok !== false) {
                                detailEditor.currentWorkspaceData = detailEditor.normalizeWorkspaceData(resp.result)
                            }
                        }
                    }
                }
            }
        }
    }

    // ─── DetailEditor (global) — referenced by WorkspaceCard, channel sidebar ─
    DetailEditor {
        id: detailEditor
        visible: false
    }

    // ─── DashboardGrid (legacy, kept for any model that still references it) ──
    DashboardGrid {
        id: dashGrid
        visible: false
    }

    // ─── Toast notifications (global) ─────────────────────────────
    ToastManager {
        id: toastManager
        anchors.fill: parent
        z: 9998
    }

    // ─── LoginScreen overlay ─────────────────────────────────────
    LoginScreen {
        id: loginOverlay
        anchors.fill: parent
        visible: !auth.isReady
        z: 999
    }

    // ─── Update toast ────────────────────────────────────────────
    Rectangle {
        id: updateToast
        anchors.right: parent.right
        anchors.bottom: parent.bottom
        anchors.margins: 16
        visible: false
        width: 360
        height: 60
        color: Theme.cardBg
        border.color: Theme.accent
        border.width: 1
        Label {
            anchors.centerIn: parent
            text: "🆕 Có bản cập nhật mới"
            color: Theme.accent
            font.pixelSize: 14
        }
    }
}
