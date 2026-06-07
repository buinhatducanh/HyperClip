// src/ui/qml/SettingsPage.qml
// Tabbed settings page: General / Operation / Sessions / System / Logs / Update
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Rectangle {
    id: page
    color: Theme.bg

    property string activeTab: "general"

    ColumnLayout {
        anchors.fill: parent
        spacing: 0

        // Tab bar
        Rectangle {
            Layout.fillWidth: true
            Layout.preferredHeight: 40
            color: "#181818"
            border.color: Theme.border
            border.width: 0
            RowLayout {
                anchors.fill: parent
                anchors.leftMargin: 8
                spacing: 0
                Repeater {
                    model: [
                        {key: "general", label: "General"},
                        {key: "operation", label: "Operation"},
                        {key: "sessions", label: "Sessions"},
                        {key: "system", label: "System"},
                        {key: "logs", label: "Logs"},
                        {key: "update", label: "Update"},
                    ]
                    delegate: Rectangle {
                        Layout.fillHeight: true
                        Layout.preferredWidth: 96
                        color: page.activeTab === modelData.key ? "#1F2A33" : "transparent"
                        border.color: page.activeTab === modelData.key ? Theme.accent : "transparent"
                        border.width: page.activeTab === modelData.key ? 1 : 0
                        Label {
                            anchors.centerIn: parent
                            text: modelData.label
                            color: page.activeTab === modelData.key ? Theme.accent : Theme.textMuted
                            font.pixelSize: 11
                            font.bold: page.activeTab === modelData.key
                        }
                        MouseArea {
                            anchors.fill: parent
                            cursorShape: Qt.PointingHandCursor
                            onClicked: page.activeTab = modelData.key
                        }
                    }
                }
                Item { Layout.fillWidth: true }
            }
        }
        Rectangle { Layout.fillWidth: true; Layout.preferredHeight: 1; color: Theme.border }

        // Tab content
        Loader {
            Layout.fillWidth: true
            Layout.fillHeight: true
            sourceComponent: {
                if (page.activeTab === "operation") return operationComp
                if (page.activeTab === "sessions") return sessionsComp
                if (page.activeTab === "system") return systemComp
                if (page.activeTab === "logs") return logsComp
                if (page.activeTab === "update") return updateComp
                return generalComp
            }
        }

        Component { id: generalComp; SettingsPanel {} }
        Component { id: operationComp; OperationPanel {} }
        Component { id: sessionsComp
            Rectangle {
                color: Theme.bg
                ColumnLayout {
                    anchors.fill: parent
                    anchors.margins: 12
                    spacing: 12
                    SessionsPanel { Layout.fillWidth: true }
                }
            }
        }
        Component { id: systemComp
            Rectangle {
                color: Theme.bg
                ColumnLayout {
                    anchors.fill: parent
                    anchors.margins: 12
                    spacing: 12
                    PollerPanel { Layout.fillWidth: true }
                    AuthPanel { Layout.fillWidth: true }
                }
            }
        }
        Component { id: logsComp
            Rectangle {
                color: Theme.bg
                ColumnLayout {
                    anchors.fill: parent
                    anchors.margins: 12
                    spacing: 12
                    ActivityLogCard { Layout.fillWidth: true; Layout.preferredHeight: 400 }
                    Button {
                        text: "Export logs"
                        onClicked: backend.send_command("logs:export")
                    }
                }
            }
        }
        Component { id: updateComp
            Rectangle {
                color: Theme.bg
                ColumnLayout {
                    anchors.fill: parent
                    anchors.margins: 12
                    spacing: 12
                    Label {
                        text: "Update"
                        color: Theme.text
                        font.pixelSize: 20
                        font.bold: true
                    }
                    Button {
                        text: "Check for update"
                        onClicked: backend.send_command("update:check")
                    }
                    Button {
                        text: "Run diagnostics"
                        onClicked: backend.send_command("system:runDiagnostics")
                    }
                }
            }
        }
    }
}
