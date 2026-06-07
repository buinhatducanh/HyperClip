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

    // Top-level page switcher
    property string currentPage: "dashboard"

    StackView {
        id: pageStack
        anchors.fill: parent
        initialItem: dashboardPage
    }

    Component {
        id: dashboardPage
        RowLayout {
            spacing: 0
            Sidebar {
                Layout.preferredWidth: 220
                Layout.fillHeight: true
                onCurrentPageChanged: {
                    if (currentPage === "settings") pageStack.push(settingsPage)
                    else if (currentPage === "operation") pageStack.push(operationPage)
                }
            }
            WorkspaceQueue {
                Layout.fillWidth: true
                Layout.fillHeight: true
            }
            DetailEditor {
                Layout.preferredWidth: 400
                Layout.fillHeight: true
            }
        }
    }
    Component {
        id: settingsPage
        Item {
            RowLayout {
                spacing: 0
                anchors.fill: parent
                Rectangle {
                    Layout.preferredWidth: 220
                    Layout.fillHeight: true
                    color: Theme.bg
                    border.color: Theme.border
                    border.width: 1
                    ColumnLayout {
                        anchors.fill: parent
                        anchors.margins: 16
                        Label {
                            text: "Settings"
                            color: Theme.accent
                            font.pixelSize: 18
                            font.bold: true
                        }
                        Button {
                            text: "← Back to Dashboard"
                            Layout.fillWidth: true
                            onClicked: pageStack.pop()
                        }
                        Item { Layout.fillHeight: true }
                    }
                }
                SettingsPage {
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                }
            }
        }
    }
    Component {
        id: operationPage
        Item {
            RowLayout {
                spacing: 0
                anchors.fill: parent
                Rectangle {
                    Layout.preferredWidth: 220
                    Layout.fillHeight: true
                    color: Theme.bg
                    border.color: Theme.border
                    border.width: 1
                    ColumnLayout {
                        anchors.fill: parent
                        anchors.margins: 16
                        Label {
                            text: "Operation"
                            color: Theme.accent
                            font.pixelSize: 18
                            font.bold: true
                        }
                        Button {
                            text: "← Back to Dashboard"
                            Layout.fillWidth: true
                            onClicked: pageStack.pop()
                        }
                        Item { Layout.fillHeight: true }
                    }
                }
                OperationPanel {
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                }
            }
        }
    }

    // LoginScreen overlay (shown when not authenticated)
    LoginScreen {
        id: loginOverlay
        anchors.fill: parent
        visible: !auth.isReady
    }

    // UpdateBar toast (bottom-right)
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
