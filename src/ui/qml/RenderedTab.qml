// src/ui/qml/RenderedTab.qml
// RENDERED tab — list of completed outputs w/ archive/remove/open-folder actions
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

ColumnLayout {
    spacing: 4
    Layout.fillWidth: true
    Layout.fillHeight: true

    SearchBar {
        placeholderText: "Tìm rendered..."
    }

    ListView {
        Layout.fillWidth: true
        Layout.fillHeight: true
        model: renderedModel
        clip: true
        spacing: 1
        delegate: Rectangle {
            width: ListView.view.width
            height: 56
            color: index % 2 === 0 ? "#161616" : "#1A1A1A"
            RowLayout {
                anchors.fill: parent
                anchors.margins: 6
                spacing: 8
                Rectangle {
                    Layout.preferredWidth: 32
                    Layout.preferredHeight: 32
                    color: "#0A0A0A"
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
                        text: (model.channelName || "—") + " · " + model.quality + " · " + (model.fileSize/1048576).toFixed(1) + "MB"
                        color: Theme.textMuted
                        font.pixelSize: 9
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
            text: "Chưa render video nào"
            color: Theme.textMuted
            font.pixelSize: 11
        }
    }
}
