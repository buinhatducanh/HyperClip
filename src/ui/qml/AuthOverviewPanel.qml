// src/ui/qml/AuthOverviewPanel.qml
// Consolidated auth: cookie/OAuth status, Chrome sessions, projects, API keys
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

ScrollView {
    id: root
    clip: true

    ColumnLayout {
        width: root.width - 24
        spacing: 12
        x: 12
        y: 12

        Label {
            text: "Xác thực"
            color: Theme.text
            font.pixelSize: 20
            font.bold: true
            Layout.bottomMargin: 8
        }

        AuthPanel { Layout.fillWidth: true }
        SessionsPanel { Layout.fillWidth: true }
        ProjectsPanel { Layout.fillWidth: true }
        KeysPanel { Layout.fillWidth: true }
    }
}
