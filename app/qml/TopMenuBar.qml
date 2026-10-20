// src/ui/qml/TopMenuBar.qml
// Slim, modern top bar with comfortable button hitboxes and navigation.
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Rectangle {
    id: bar
    color: Theme.cardBg
    border.color: Theme.border
    border.width: 0
    height: 44

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
        spacing: 14

        // ─── Brand ────────────────────────────────────────────────────────
        RowLayout {
            spacing: 8
            Rectangle {
                width: 22; height: 22; radius: 4
                color: Theme.accent
                Icon { anchors.centerIn: parent; name: "bolt"; size: 12; color: "white" }
            }
            Label {
                text: "HyperClip"
                color: Theme.text
                font.pixelSize: 14
                font.bold: true
                font.letterSpacing: 0.5
            }
            Rectangle {
                Layout.preferredHeight: 18
                Layout.preferredWidth: 36
                radius: 3
                color: Theme.accent + "20"
                border.color: Theme.accent + "44"
                border.width: 1
                Label {
                    anchors.centerIn: parent
                    text: "v3.0"
                    color: Theme.accent
                    font.pixelSize: 10
                    font.bold: true
                }
            }
        }

        // Vertical separator
        Rectangle {
            width: 1; height: 18
            color: Theme.border
        }

        // ─── DL quality badge ─────────────────────────────────────────────
        RowLayout {
            spacing: 6
            Icon {
                name: "download"
                size: 12
                color: Theme.textMuted
                Layout.alignment: Qt.AlignVCenter
            }
            Rectangle {
                Layout.preferredHeight: 20
                Layout.preferredWidth: dlBadgeLabel.implicitWidth + 14
                radius: 4
                color: Theme.success + "18"
                border.color: Theme.success + "44"
                border.width: 1
                Label {
                    id: dlBadgeLabel
                    anchors.centerIn: parent
                    text: (settings ? settings.autoDownloadQuality : "720") + "p"
                    color: Theme.success
                    font.pixelSize: 11
                    font.bold: true
                }
            }
        }

        // ─── Back button ──────────────────────────────────────────────────
        Rectangle {
            Layout.preferredWidth: 28
            Layout.preferredHeight: 28
            radius: Theme.radiusMd
            color: backMa.containsMouse ? Theme.hoverBg : "transparent"
            border.color: backMa.containsMouse ? Theme.cardBorderHover : Theme.border
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
            ToolTip.visible: backMa.containsMouse
            ToolTip.text: "Quay lại Cài đặt"
            ToolTip.delay: 300
        }

        // ─── View switcher (Comfortable 32px height) ──────────────────────
        Rectangle {
            Layout.preferredHeight: 32
            Layout.preferredWidth: switchRow.implicitWidth + 6
            color: Theme.bg
            border.color: Theme.border
            border.width: 1
            radius: Theme.radiusMd

            RowLayout {
                id: switchRow
                anchors.centerIn: parent
                spacing: 2

                Repeater {
                    model: [
                        {view: "settings", label: "Cài đặt", icon: "settings"},
                        {view: "management", label: "Quản lí", icon: "kebab"},
                        {view: "scancore", label: "Lõi quét", icon: "bolt"},
                        {view: "tiktok", label: "TikTok", icon: "upload"}
                    ]
                    delegate: Rectangle {
                        id: tabDelegate
                        readonly property bool active: bar.centerView === modelData.view
                        Layout.preferredHeight: 28
                        Layout.preferredWidth: tabRow.implicitWidth + 20
                        color: active ? Theme.accent : (itemMa.containsMouse ? Theme.hoverBg : "transparent")
                        radius: Theme.radiusSm

                        Behavior on color { ColorAnimation { duration: 120 } }

                        RowLayout {
                            id: tabRow
                            anchors.centerIn: parent
                            spacing: 5
                            Icon {
                                name: modelData.icon
                                size: 12
                                color: tabDelegate.active ? "white" : (itemMa.containsMouse ? Theme.text : Theme.textMuted)
                            }
                            Label {
                                text: modelData.label
                                color: tabDelegate.active ? "white" : (itemMa.containsMouse ? Theme.text : Theme.textMuted)
                                font.pixelSize: 11
                                font.bold: tabDelegate.active
                            }
                        }
                        MouseArea {
                            id: itemMa
                            anchors.fill: parent
                            hoverEnabled: true
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
