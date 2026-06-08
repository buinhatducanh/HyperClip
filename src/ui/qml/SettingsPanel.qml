// src/ui/qml/SettingsPanel.qml
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
            text: "Cài đặt"
            color: Theme.text
            font.pixelSize: 20
            font.bold: true
            Layout.bottomMargin: 8
        }

        HardwareProfileCard { Layout.fillWidth: true }
        AutoRenderCard { Layout.fillWidth: true }
        DownloadCard { Layout.fillWidth: true }
        StorageCard { Layout.fillWidth: true }
        DetectionCard { Layout.fillWidth: true }
        SystemCard { Layout.fillWidth: true }

        Rectangle {
            Layout.fillWidth: true
            Layout.preferredHeight: 60
            color: Theme.bg
            border.color: Theme.border
            border.width: 1
            RowLayout {
                anchors.fill: parent
                anchors.margins: 12
                Button {
                    text: "Lưu"
                    onClicked: settings.save_to_backend(backend)
                }
                Button {
                    text: "Tải lại"
                    onClicked: settings.load_from_backend(backend)
                }
                Item { Layout.fillWidth: true }
                Label {
                    text: "GPU: " + statsModel.gpu_name
                    color: Theme.textMuted
                    font.pixelSize: 10
                }
            }
        }
    }
}
