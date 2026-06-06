// src/ui/qml/Settings.qml
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Rectangle {
    color: Theme.bg

    ScrollView {
        anchors.fill: parent
        anchors.margins: 16
        clip: true

        ColumnLayout {
            width: parent.width
            spacing: 16

            Label {
                text: "Settings"
                color: Theme.accent
                font.pixelSize: 18
                font.bold: true
            }

            // OAuth Credentials
            Rectangle {
                Layout.fillWidth: true
                Layout.preferredHeight: oauthCol.implicitHeight + 24
                color: Theme.bg
                border.color: Theme.border
                border.width: 1

                ColumnLayout {
                    id: oauthCol
                    anchors.fill: parent
                    anchors.margins: 12
                    spacing: 8

                    Label {
                        text: "OAuth Credentials"
                        color: Theme.text
                        font.pixelSize: 14
                        font.bold: true
                    }

                    Label { text: "Client ID:"; color: Theme.textMuted }
                    TextField {
                        id: clientId
                        placeholderText: "xxxxx.apps.googleusercontent.com"
                        Layout.fillWidth: true
                        color: Theme.text
                    }

                    Label { text: "Client Secret:"; color: Theme.textMuted }
                    TextField {
                        id: clientSecret
                        placeholderText: "GOCSPX-..."
                        Layout.fillWidth: true
                        color: Theme.text
                        echoMode: TextField.Password
                    }

                    Label { text: "API Key:"; color: Theme.textMuted }
                    TextField {
                        id: apiKey
                        placeholderText: "AIza..."
                        Layout.fillWidth: true
                        color: Theme.text
                    }

                    Button {
                        text: "Save OAuth"
                        highlighted: true
                    }
                }
            }

            // Channels
            Rectangle {
                Layout.fillWidth: true
                Layout.preferredHeight: channelCol.implicitHeight + 24
                color: Theme.bg
                border.color: Theme.border
                border.width: 1

                ColumnLayout {
                    id: channelCol
                    anchors.fill: parent
                    anchors.margins: 12
                    spacing: 8

                    Label {
                        text: "Channels"
                        color: Theme.text
                        font.pixelSize: 14
                        font.bold: true
                    }

                    RowLayout {
                        Layout.fillWidth: true
                        TextField {
                            id: channelUrl
                            placeholderText: "https://youtube.com/@channel"
                            Layout.fillWidth: true
                            color: Theme.text
                        }
                        Button {
                            text: "+ Add"
                            highlighted: true
                        }
                    }

                    Label {
                        text: channelModel.rowCount + " channels"
                        color: Theme.textMuted
                        font.pixelSize: 11
                    }
                }
            }

            // Chrome Sessions
            Rectangle {
                Layout.fillWidth: true
                Layout.preferredHeight: 380
                color: Theme.bg
                border.color: Theme.border
                border.width: 1

                ColumnLayout {
                    anchors.fill: parent
                    anchors.margins: 12
                    spacing: 4

                    Label {
                        text: "Chrome Sessions (30)"
                        color: Theme.text
                        font.pixelSize: 14
                        font.bold: true
                    }

                    Label {
                        text: "Session status loaded from Chrome profiles"
                        color: Theme.textMuted
                        font.pixelSize: 11
                    }

                    Repeater {
                        model: 30
                        delegate: Rectangle {
                            Layout.fillWidth: true
                            Layout.preferredHeight: 20
                            color: Theme.bg
                            border.color: Theme.border
                            border.width: 1

                            RowLayout {
                                anchors.fill: parent
                                anchors.margins: 4
                                Label {
                                    text: "Profile " + (index + 1)
                                    color: Theme.text
                                    font.pixelSize: 10
                                }
                                Item { Layout.fillWidth: true }
                                Label {
                                    text: "✓"
                                    color: Theme.success
                                    font.pixelSize: 10
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
