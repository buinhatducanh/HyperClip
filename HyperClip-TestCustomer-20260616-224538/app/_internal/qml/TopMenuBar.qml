// src/ui/qml/TopMenuBar.qml
// Slim top bar — brand + DL quality badge. No tabs (Electron-style).
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Rectangle {
    id: bar
    color: Theme.cardBg
    border.color: Theme.border
    border.width: 0
    height: 40

    property string centerView: "settings"
    signal navigateToView(string view)

    // Bottom border line
    Rectangle {
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.bottom: parent.bottom
        height: 1
        color: Theme.border
    }

    RowLayout {
        anchors.fill: parent
        anchors.leftMargin: 16
        anchors.rightMargin: 16
        spacing: 12

        // ─── Brand ─────────────────────────────────────────────
        Label {
            text: "HyperClip"
            color: Theme.text
            font.pixelSize: 13
            font.bold: true
        }

        // Vertical separator
        Rectangle {
            width: 1; height: 14
            color: Theme.border
        }

        // ─── DL quality badge ──────────────────────────────────
        RowLayout {
            spacing: 4
            Icon {
                name: "download"
                size: 12
                color: Theme.textMuted
                Layout.alignment: Qt.AlignVCenter
            }
            Rectangle {
                Layout.preferredHeight: 18
                Layout.preferredWidth: dlBadgeLabel.implicitWidth + 12
                radius: 3
                color: Theme.success + "18"
                border.color: Theme.success + "44"
                border.width: 1
                Label {
                    id: dlBadgeLabel
                    anchors.centerIn: parent
                    text: (settings ? settings.autoDownloadQuality : "720") + "p"
                    color: Theme.success
                    font.pixelSize: 10
                    font.bold: true
                }
            }
        }

        // ─── Back button (shown when in workspace/rendered view) ───
        Rectangle {
            Layout.preferredWidth: 24
            Layout.preferredHeight: 24
            radius: 3
            color: backMa.containsMouse ? Theme.hoverBg : "transparent"
            border.color: Theme.border
            border.width: 1
            visible: bar.centerView === "workspace" || bar.centerView === "rendered"
            Icon {
                anchors.centerIn: parent
                name: "back"
                size: 14
                color: Theme.text
            }
            MouseArea {
                id: backMa
                anchors.fill: parent
                hoverEnabled: true
                cursorShape: Qt.PointingHandCursor
                onClicked: bar.navigateToView("settings")
            }
        }

        // ─── View switcher ─────────────────────────────────────
        Rectangle {
            Layout.preferredHeight: 24
            Layout.preferredWidth: switchRow.implicitWidth + 4
            color: Theme.bg
            border.color: Theme.border
            border.width: 1
            radius: 3

            RowLayout {
                id: switchRow
                anchors.centerIn: parent
                spacing: 0

                Repeater {
                    model: [
                        {view: "settings", label: "Cài đặt", icon: "settings"},
                        {view: "operation", label: "Vận hành", icon: "info"},
                        {view: "management", label: "Quản lí", icon: "kebab"},
                        {view: "scancore", label: "Lõi quét", icon: "bolt"},
                        {view: "tiktok", label: "TikTok", icon: "upload"}
                    ]
                    delegate: Rectangle {
                        id: tabDelegate
                        readonly property bool active: bar.centerView === modelData.view
                        Layout.preferredHeight: 22
                        Layout.preferredWidth: tabRow.implicitWidth + 16
                        color: active ? Theme.accent : "transparent"
                        radius: 2
                        RowLayout {
                            id: tabRow
                            anchors.centerIn: parent
                            spacing: 4
                            Icon {
                                name: modelData.icon
                                size: 12
                                color: tabDelegate.active ? "white" : Theme.textMuted
                            }
                            Label {
                                text: modelData.label
                                color: tabDelegate.active ? "white" : Theme.textMuted
                                font.pixelSize: 10
                                font.bold: tabDelegate.active
                            }
                        }
                        MouseArea {
                            anchors.fill: parent
                            cursorShape: Qt.PointingHandCursor
                            onClicked: bar.navigateToView(modelData.view)
                        }
                    }
                }
            }
        }

        Item { Layout.fillWidth: true }
    }
}
