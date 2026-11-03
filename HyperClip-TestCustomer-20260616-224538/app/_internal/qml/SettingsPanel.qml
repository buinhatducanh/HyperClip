// src/ui/qml/SettingsPanel.qml
// General settings: hardware, download, auto-render, storage.
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

ScrollView {
    id: root
    clip: true

    ColumnLayout {
        width: root.width - Theme.spacingLg * 2
        spacing: Theme.spacingMd
        x: Theme.spacingLg
        y: Theme.spacingLg

        Label {
            text: "Cài đặt"
            color: Theme.text
            font.pixelSize: Theme.textXl
            font.bold: true
            Layout.fillWidth: true
            Layout.bottomMargin: Theme.spacingXs
        }

        HardwareProfileCard { Layout.fillWidth: true }

        RowLayout {
            Layout.fillWidth: true
            spacing: Theme.spacingMd
            DownloadCard { Layout.fillWidth: true; Layout.preferredWidth: 1; Layout.fillHeight: true }
            AutoRenderCard { Layout.fillWidth: true; Layout.preferredWidth: 1; Layout.fillHeight: true }
        }

        StorageCard { Layout.fillWidth: true; Layout.preferredHeight: 200 }

        // Action bar
        Rectangle {
            Layout.fillWidth: true
            Layout.topMargin: Theme.spacingSm
            Layout.preferredHeight: 48
            color: Theme.cardBg
            border.color: Theme.border
            border.width: 1
            radius: Theme.radiusLg

            RowLayout {
                anchors.fill: parent
                anchors.leftMargin: Theme.spacingLg
                anchors.rightMargin: Theme.spacingLg
                spacing: Theme.spacingSm

                Button {
                    text: "Lưu"
                    highlighted: true
                    onClicked: {
                        if (settings.save_to_backend(backend)) {
                            toastService.show("Đã lưu", "Cài đặt đã được lưu thành công", "success")
                        } else {
                            toastService.show("Lỗi", "Không thể lưu cài đặt", "error")
                        }
                    }
                }
                Button {
                    text: "Tải lại"
                    onClicked: {
                        settings.load_from_backend(backend)
                        toastService.show("Đã tải lại", "Đã khôi phục cài đặt gần nhất", "info")
                    }
                }
                Item { Layout.fillWidth: true }
            }
        }
    }
}
