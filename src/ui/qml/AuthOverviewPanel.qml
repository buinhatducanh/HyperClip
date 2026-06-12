// src/ui/qml/AuthOverviewPanel.qml
// Consolidated auth: cookie/OAuth status, Chrome sessions, projects, API keys
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

ScrollView {
    id: root
    clip: true

    ColumnLayout {
        id: contentLayout
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

        AuthPanel { Layout.fillWidth: true; Layout.preferredHeight: 220 }
        SessionsPanel { Layout.fillWidth: true; Layout.preferredHeight: 320 }
        ProjectsPanel { Layout.fillWidth: true; Layout.preferredHeight: 280 }
        KeysPanel { Layout.fillWidth: true; Layout.preferredHeight: 280 }
    }
}
