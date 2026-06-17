import QtQuick
import QtQuick.Window
import QtQuick.Controls
import "."

ApplicationWindow {
    id: win
    width: 1280
    height: 800
    visible: true
    title: "Test"
    color: Theme.bg
    SettingsPage { anchors.fill: parent }
}
