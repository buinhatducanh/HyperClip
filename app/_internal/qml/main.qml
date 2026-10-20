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
    title: (typeof isShortEdition !== "undefined" && isShortEdition) ? "HyperShort" : "HyperClip"
    color: Theme.bg

    palette.highlight: Theme.accent
    palette.highlightedText: "#FFFFFF"
    palette.window: Theme.bg
    palette.windowText: Theme.text
    palette.base: Theme.cardBg
    palette.text: Theme.text
    palette.button: Theme.inputBg
    palette.buttonText: Theme.text
    palette.alternateBase: Theme.rowEven
    palette.toolTipBase: Theme.cardBg
    palette.toolTipText: Theme.text

    // Center pane view state: "settings" | "workspace" | "rendered" | "management" | "scancore" | "tiktok"
    property string centerView: "settings"
    property string filterChannelId: ""
    property string pendingView: ""
    // Các trang chiếm toàn màn hình (ẩn Sidebar + cột queue phải).
    readonly property bool wideView: centerView === "management"
                                     || centerView === "tiktok" || centerView === "scancore"

    function getCenterComponent(view) {
        if (view === "workspace") return workspaceView
        if (view === "rendered") return renderedView
        if (view === "management") return managementView
        if (view === "scancore") return scanCoreView
        if (view === "tiktok") return tiktokView
        return settingsView
    }

    function changeView(view) {
        if (root.centerView === "settings" && view !== "settings" && settings.dirty) {
            root.pendingView = view
            unsavedDialog.open()
        } else {
            root.centerView = view
        }
    }

    ColumnLayout {
        anchors.fill: parent
        spacing: 0

        // ─── TopBar (slim, 40px) ─────────────────────────────────
        TopMenuBar {
            id: topBar
            Layout.fillWidth: true
            centerView: root.centerView
            onNavigateToView: function(view) {
                root.changeView(view)
            }
        }

        // ─── Main 3-column area ─────────────────────────────────
        RowLayout {
            Layout.fillWidth: true
            Layout.fillHeight: true
            spacing: 0

            // Left: Sidebar (fixed 220px) — HIDDEN in wide views
            Sidebar {
                id: sideBar
                Layout.fillHeight: true
                Layout.preferredWidth: root.wideView ? 0 : 220
                visible: !root.wideView
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

            // Pass 54: kết quả thêm kênh — trùng kênh thì nói rõ tên kênh đã
            // theo dõi (trước đây backend bỏ qua trong im lặng, hoặc tệ hơn là
            // đẻ ra hàng trùng).
            Connections {
                target: channelListModel
                function onAddResult(ok, message) {
                    if (!toastService) return
                    if (ok) toastService.show("Đã thêm kênh", "", "success")
                    else toastService.show("Không thêm được kênh", message, "warning")
                }
            }

            // Center: Settings / VideoDetail / Rendered / Operation
            Rectangle {
                id: centerPane
                Layout.fillWidth: true
                Layout.fillHeight: true
                Layout.minimumWidth: root.wideView ? 600 : 400
                color: Theme.bg

                Loader {
                    id: centerLoader
                    anchors.fill: parent
                    asynchronous: true
                    sourceComponent: root.getCenterComponent(root.centerView)
                    NumberAnimation on opacity {
                        id: fadeAnim
                        from: 0.7
                        to: 1.0
                        duration: Theme.animFast
                        easing.type: Easing.OutCubic
                    }
                    onLoaded: fadeAnim.restart()
                }

                Component { id: settingsView; SettingsPage {} }
                Component { id: workspaceView; VideoDetailPanel {
                    workspaceId: detailEditor.currentWorkspaceId
                    workspaceData: detailEditor.currentWorkspaceData
                } }
                Component { id: renderedView; RenderedVideoDetail {
                    videoId: detailEditor.currentRenderedId
                    videoData: detailEditor.currentRenderedData
                } }
                                Component { id: managementView; ManagementPanel {
                    onOpenScanCore: root.changeView("scancore")
                } }
                Component { id: scanCoreView; ScanCorePanel {} }
                Component { id: tiktokView; TikTokPanel {} }
            }

            // Right: WorkspaceQueue (240-400px) + rendered mini above — HIDDEN in Settings + wide views
            Rectangle {
                readonly property bool hidden: root.wideView || root.centerView === "settings"
                Layout.preferredWidth: hidden ? 0 : 320
                Layout.minimumWidth: hidden ? 0 : 240
                Layout.maximumWidth: hidden ? 0 : 400
                Layout.fillHeight: true
                visible: !hidden
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

                    // System monitor (compact, self-sizing)
                    SystemMonitor {
                        Layout.fillWidth: true
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
                                            // Capture id trước: delegate ListView có thể bị recycle
                                            // trước khi callLater chạy. Qt.callLater đẩy fetch đồng
                                            // bộ ra khỏi stack mouse-delivery (send_command spin
                                            // nested loop tại đây = nguồn crash 18/07).
                                            var rid = model.id
                                            detailEditor.loadRendered(rid)
                                            root.changeView("rendered")
                                            Qt.callLater(function() {
                                                var resp = backend.send_command("rendered:get", {"id": rid})
                                                if (resp && resp.ok !== false) {
                                                    detailEditor.currentRenderedData = resp.result
                                                }
                                            })
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
                        onSelectChannelFilter: function(id) {
                            root.filterChannelId = id
                            if (typeof dashGrid !== "undefined" && dashGrid) {
                                dashGrid.filterChannelId = id
                            }
                        }
                        onOpenWorkspace: function(ws_id) {
                            // Switch view immediately with model data
                            detailEditor.loadWorkspace(ws_id)
                            root.changeView("workspace")
                            // Fetch đầy đủ từ Rust — hoãn ra khỏi stack click qua
                            // Qt.callLater (send_command đồng bộ ngay trong handler
                            // spin nested loop = nguồn crash reset ListView 18/07).
                            Qt.callLater(function() {
                                var resp = backend.send_command("workspace:get", {"id": ws_id})
                                if (resp && resp.ok !== false) {
                                    detailEditor.currentWorkspaceData = detailEditor.normalizeWorkspaceData(resp.result)
                                }
                            })
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
        visible: auth ? !auth.isReady : true
        z: 999
    }

    // ─── Onboarding overlay ──────────────────────────────────────
    OnboardingPage {
        id: onboardingOverlay
        anchors.fill: parent
        visible: (auth && auth.isReady) && (settings ? !settings.onboardingComplete : true)
        z: 998
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

    Dialog {
        id: unsavedDialog
        title: "Thay đổi chưa lưu"
        modal: true
        anchors.centerIn: Overlay.overlay
        width: 460
        standardButtons: Dialog.NoButton
        padding: 0

        background: Rectangle {
            color: Theme.cardBg
            border.color: Theme.border
            border.width: 1
            radius: Theme.radiusLg
            Rectangle {
                anchors.top: parent.top
                anchors.left: parent.left
                anchors.right: parent.right
                height: 4
                color: Theme.accent
                radius: Theme.radiusLg
            }
        }

        header: Rectangle {
            color: "transparent"
            height: 52
            RowLayout {
                anchors.fill: parent
                anchors.leftMargin: 20
                anchors.rightMargin: 20
                spacing: 10
                Text {
                    text: "⚠️"
                    font.pixelSize: 18
                }
                Label {
                    text: "Xác nhận chuyển trang"
                    color: Theme.text
                    font.pixelSize: 15
                    font.bold: true
                    Layout.fillWidth: true
                }
            }
        }

        contentItem: ColumnLayout {
            spacing: 16

            Label {
                text: "Bạn có thay đổi cài đặt chưa lưu. Bạn có muốn lưu các thay đổi này trước khi chuyển trang không?"
                color: Theme.text
                font.pixelSize: Theme.textSm
                wrapMode: Text.WordWrap
                Layout.fillWidth: true
                Layout.leftMargin: 20
                Layout.rightMargin: 20
                lineHeight: 1.2
            }

            Rectangle {
                Layout.fillWidth: true
                height: 1
                color: Theme.border
                Layout.leftMargin: 20
                Layout.rightMargin: 20
            }

            RowLayout {
                Layout.fillWidth: true
                Layout.leftMargin: 20
                Layout.rightMargin: 20
                Layout.bottomMargin: 16
                spacing: 10

                Button {
                    id: cancelBtn
                    text: "Hủy"
                    contentItem: Text {
                        text: cancelBtn.text
                        font.pixelSize: Theme.textSm
                        font.bold: true
                        color: cancelBtn.hovered ? Theme.text : Theme.textMuted
                        horizontalAlignment: Text.AlignHCenter
                        verticalAlignment: Text.AlignVCenter
                    }
                    background: Rectangle {
                        implicitWidth: 80
                        implicitHeight: 34
                        color: cancelBtn.hovered ? Theme.cardElevatedBg : "transparent"
                        border.color: cancelBtn.hovered ? Theme.border : "transparent"
                        radius: Theme.radiusMd
                    }
                    onClicked: {
                        unsavedDialog.close()
                    }
                }

                Item { Layout.fillWidth: true }

                Button {
                    id: discardBtn
                    text: "Không lưu"
                    contentItem: Text {
                        text: discardBtn.text
                        font.pixelSize: Theme.textSm
                        font.bold: true
                        color: Theme.error
                        horizontalAlignment: Text.AlignHCenter
                        verticalAlignment: Text.AlignVCenter
                    }
                    background: Rectangle {
                        implicitWidth: 100
                        implicitHeight: 34
                        color: discardBtn.hovered ? Theme.error + "25" : "transparent"
                        border.color: Theme.error + "60"
                        border.width: 1
                        radius: Theme.radiusMd
                    }
                    onClicked: {
                        settings.discard_changes()
                        toastService.show("Đã huỷ thay đổi", "Các cài đặt đã được khôi phục", "info")
                        root.centerView = root.pendingView
                        unsavedDialog.close()
                    }
                }

                Button {
                    id: saveBtn
                    text: "Lưu cài đặt"
                    contentItem: Text {
                        text: saveBtn.text
                        font.pixelSize: Theme.textSm
                        font.bold: true
                        color: "#FFFFFF"
                        horizontalAlignment: Text.AlignHCenter
                        verticalAlignment: Text.AlignVCenter
                    }
                    background: Rectangle {
                        implicitWidth: 110
                        implicitHeight: 34
                        color: saveBtn.hovered ? Qt.lighter(Theme.accent, 1.15) : Theme.accent
                        radius: Theme.radiusMd
                    }
                    onClicked: {
                        if (settings.save_to_backend(backend)) {
                            toastService.show("Đã lưu", "Cài đặt đã được lưu thành công", "success")
                            root.centerView = root.pendingView
                        } else {
                            toastService.show("Lỗi", "Không thể lưu cài đặt", "error")
                        }
                        unsavedDialog.close()
                    }
                }
            }
        }
    }
}
