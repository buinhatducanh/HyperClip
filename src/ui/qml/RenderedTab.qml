// RenderedTab.qml
// RENDERED tab — list of completed outputs w/ filter, open-folder
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

ColumnLayout {
    id: tab
    spacing: 4
    Layout.fillWidth: true
    Layout.fillHeight: true

    property string searchQuery: ""

    ListView {
        Layout.fillWidth: true
        Layout.fillHeight: true
        Layout.margins: 6
        model: renderedModel
        clip: true
        spacing: 1
        delegate: Rectangle {
            width: ListView.view.width
            height: 56
            visible: {
                if (!tab.searchQuery) return true
                const title = (model.title || "").toLowerCase()
                return title.includes(tab.searchQuery.toLowerCase())
            }
            color: index % 2 === 0 ? Theme.rowEven : Theme.rowOdd
            RowLayout {
                anchors.fill: parent
                anchors.margins: 6
                spacing: 8

                MouseArea {
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    cursorShape: Qt.PointingHandCursor
                    onClicked: detailEditor.loadRendered(model.id)

                    RowLayout {
                        anchors.fill: parent
                        spacing: 8
                        Rectangle {
                            Layout.preferredWidth: 32
                            Layout.preferredHeight: 32
                            color: Theme.bg
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
                    }
                }
                Button {
                    text: "\U0001F4C2"
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
