// src/ui/qml/AdminPage.qml
// License admin (Basic-auth gate) — list/issue/revoke license keys
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Rectangle {
    id: page
    color: Theme.bg
    property string authUser: ""
    property string authPass: ""
    property bool authenticated: false
    property var licenses: []
    property string newKey: ""
    property string newEmail: ""
    property string newPlan: "basic"

    function refresh() {
        // Stub — admin licenses list would be fetched here
        licenses = []
    }
    function login() {
        if (authUser === "admin" && authPass === "hyperclip") {
            authenticated = true
            refresh()
        }
    }

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 24
        spacing: 12

        Label {
            text: "License Admin"
            color: Theme.text
            font.pixelSize: 22
            font.bold: true
        }

        Loader {
            Layout.fillWidth: true
            Layout.fillHeight: true
            sourceComponent: page.authenticated ? mainComp : loginComp
        }
    }

    Component { id: loginComp
        ColumnLayout {
            spacing: 12
            Label {
                text: "Đăng nhập admin"
                color: Theme.textMuted
                font.pixelSize: 14
            }
            TextField {
                Layout.preferredWidth: 240
                placeholderText: "Username"
                text: page.authUser
                onTextChanged: page.authUser = text
            }
            TextField {
                Layout.preferredWidth: 240
                placeholderText: "Password"
                echoMode: TextInput.Password
                text: page.authPass
                onTextChanged: page.authPass = text
            }
            Button {
                text: "Đăng nhập"
                Layout.preferredWidth: 240
                onClicked: page.login()
            }
        }
    }

    Component { id: mainComp
        ColumnLayout {
            spacing: 12

            // Issue new
            GroupBox {
                Layout.fillWidth: true
                title: "ISSUE NEW LICENSE"
                background: Rectangle {
                    color: Theme.bg; border.color: Theme.border; border.width: 1
                }
                label: Label { text: parent.title; color: Theme.accent; font.pixelSize: 11; font.bold: true }
                GridLayout {
                    anchors.fill: parent
                    columns: 3
                    columnSpacing: 8
                    rowSpacing: 4
                    TextField {
                        Layout.fillWidth: true
                        placeholderText: "License key"
                        text: page.newKey
                        onTextChanged: page.newKey = text
                    }
                    TextField {
                        Layout.fillWidth: true
                        placeholderText: "Email"
                        text: page.newEmail
                        onTextChanged: page.newEmail = text
                    }
                    Button {
                        text: "Issue"
                        onClicked: {
                            page.licenses = page.licenses.concat([{
                                key: page.newKey, email: page.newEmail, plan: page.newPlan,
                                issuedAt: new Date().toISOString()
                            }])
                            page.newKey = ""
                            page.newEmail = ""
                        }
                    }
                }
            }

            // List
            GroupBox {
                Layout.fillWidth: true
                Layout.fillHeight: true
                title: "LICENSES"
                background: Rectangle {
                    color: Theme.bg; border.color: Theme.border; border.width: 1
                }
                label: Label { text: parent.title; color: Theme.accent; font.pixelSize: 11; font.bold: true }
                ListView {
                    anchors.fill: parent
                    model: page.licenses
                    clip: true
                    spacing: 1
                    delegate: Rectangle {
                        width: ListView.view.width
                        height: 36
                        color: index % 2 === 0 ? "#161616" : "#1A1A1A"
                        RowLayout {
                            anchors.fill: parent
                            anchors.margins: 4
                            spacing: 8
                            Label {
                                text: modelData.key
                                color: Theme.text
                                font.pixelSize: 10
                                font.family: "monospace"
                                Layout.preferredWidth: 200
                            }
                            Label {
                                text: modelData.email
                                color: Theme.textMuted
                                font.pixelSize: 10
                                Layout.fillWidth: true
                            }
                            Label {
                                text: modelData.plan
                                color: Theme.accent
                                font.pixelSize: 10
                            }
                            Button {
                                text: "Revoke"
                                onClicked: {
                                    const arr = page.licenses.slice()
                                    arr.splice(index, 1)
                                    page.licenses = arr
                                }
                            }
                        }
                    }
                    Label {
                        anchors.centerIn: parent
                        visible: page.licenses.length === 0
                        text: "Chưa có license nào"
                        color: Theme.textMuted
                        font.pixelSize: 11
                    }
                }
            }
        }
    }
}
