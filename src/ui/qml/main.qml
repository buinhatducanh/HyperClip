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

    // Top-level page: "dashboard" | "settings" | "operation"
    property string currentPage: "dashboard"
    // Dashboard sub-tab: "queue" | "channels" | "rendered"
    property string sidebarHighlight: "queue"

    RowLayout {
        anchors.fill: parent
        spacing: 0

        // ─── Left: Sidebar (persistent) ──────────────────────────
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

        // ─── Right: Content ─────────────────────────────────────
        Item {
            Layout.fillWidth: true
            Layout.fillHeight: true

            // Dashboard: Queue view
            RowLayout {
                anchors.fill: parent
                spacing: 0
                visible: root.currentPage === "dashboard" && root.sidebarHighlight === "queue"

                WorkspaceQueue {
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                }
                DetailEditor {
                    id: detailEditor
                    Layout.preferredWidth: 400
                    Layout.fillHeight: true
                }
            }

            // Dashboard: Channels view (with add form + list)
            Rectangle {
                anchors.fill: parent
                color: Theme.bg
                visible: root.currentPage === "dashboard" && root.sidebarHighlight === "channels"

                ChannelList {
                    anchors.fill: parent
                    anchors.margins: 8
                }
            }

            // Rendered view
            Rectangle {
                anchors.fill: parent
                color: Theme.bg
                border.color: Theme.border
                border.width: 1
                visible: root.currentPage === "dashboard" && root.sidebarHighlight === "rendered"

                ColumnLayout {
                    anchors.fill: parent
                    anchors.margins: 6
                    spacing: 4

                    SearchBar {
                        Layout.fillWidth: true
                        placeholderText: "Tìm video đã render..."
                        id: renderedSearch
                        onSearchChanged: renderedList.searchText = searchText
                        onClearClicked: renderedList.searchText = ""
                    }

                    Rectangle {
                        Layout.fillWidth: true; Layout.preferredHeight: 1
                        color: Theme.border
                    }

                    ListView {
                        id: renderedList
                        Layout.fillWidth: true
                        Layout.fillHeight: true
                        clip: true
                        spacing: 1
                        property string searchText: ""

                        model: renderedModel

                        delegate: Rectangle {
                            width: ListView.view.width
                            height: 56
                            visible: {
                                if (!renderedList.searchText) return true
                                const t = (model.title || "").toLowerCase()
                                return t.includes(renderedList.searchText.toLowerCase())
                            }
                            color: index % 2 === 0 ? Theme.rowEven : Theme.rowOdd

                            RowLayout {
                                anchors.fill: parent
                                anchors.margins: 6
                                spacing: 8

                                MouseArea {
                                    Layout.fillWidth: true
                                    Layout.fillHeight: true
                                    cursorShape: Qt.PointingHandCursor
                                    onClicked: detailEditor.loadRendered(model.id)

                                    RowLayout {
                                        anchors.fill: parent
                                        spacing: 8
                                        Rectangle {
                                            Layout.preferredWidth: 32
                                            Layout.preferredHeight: 32
                                            color: Theme.bg
                                            border.color: Theme.border
                                            border.width: 1
                                            Label {
                                                anchors.centerIn: parent
                                                text: "▶"
                                                color: Theme.success
                                                font.pixelSize: 14
                                            }
                                        }
                                        ColumnLayout {
                                            Layout.fillWidth: true
                                            spacing: 2
                                            Label {
                                                text: model.title
                                                color: Theme.text
                                                font.pixelSize: 11
                                                font.bold: true
                                                elide: Text.ElideRight
                                                Layout.fillWidth: true
                                            }
                                            Label {
                                                text: (model.channelName || "—") + " · " + model.quality + " · " + (model.fileSize/1048576).toFixed(1) + " MB"
                                                color: Theme.textMuted
                                                font.pixelSize: 9
                                            }
                                        }
                                    }
                                }
                                Button {
                                    text: "📂"
                                    Layout.preferredWidth: 28
                                    onClicked: renderedModel.open_folder(backend, model.id)
                                }
                            }
                        }

                        Label {
                            anchors.centerIn: parent
                            visible: parent.count === 0
                            text: "Chưa có video đã render"
                            color: Theme.textMuted
                            font.pixelSize: 11
                        }
                    }
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
            text: "🆕 Có bản cập nhật mới"
            color: Theme.accent
            font.pixelSize: 12
        }
    }
}
