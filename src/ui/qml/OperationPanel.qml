// src/ui/qml/OperationPanel.qml
// MMO Operation Center — consolidated view of poller, auth, sessions, projects, keys
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
            text: "Trung tâm vận hành"
            color: Theme.text
            font.pixelSize: 30
            font.bold: true
            Layout.bottomMargin: 8
        }

        PollerPanel { Layout.fillWidth: true }
        AuthPanel { Layout.fillWidth: true }
        SessionsPanel { Layout.fillWidth: true }
        ProjectsPanel { Layout.fillWidth: true }
        KeysPanel { Layout.fillWidth: true }
    }
}
