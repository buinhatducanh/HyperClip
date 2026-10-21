// src/ui/qml/ToastManager.qml
// Top-level toast host with show(title, message, level) and listen to toastService
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Item {
    id: root
    anchors.fill: parent
    z: 9998

    ColumnLayout {
        id: stack
        anchors.right: parent.right
        anchors.top: parent.top
        anchors.margins: 20
        spacing: 8
    }

    Component {
        id: toastComponent
        ToastNotification {}
    }

    function show(title, message, level) {
        if (stack.children.length >= 5) {
            stack.children[0].dismiss()
        }
        const t = toastComponent.createObject(stack, {
            title: title || "",
            message: message || "",
            level: level || "info"
        })
        if (t) {
            t.show()
        }
    }

    // Connect to Python toast service
    Connections {
        target: typeof toastService !== "undefined" ? toastService : null
        function onToastRequested(title, message, level) {
            root.show(title, message, level)
        }
    }
}
