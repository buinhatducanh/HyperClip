// src/ui/qml/DetailEditor.qml
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Rectangle {
    id: detailRoot

    color: Theme.bg
    border.color: Theme.border
    border.width: 1

    property string currentVideoPath: ""
    property string currentTitle: "Select a workspace"

    function loadWorkspace(ws_id) {
        currentTitle = ws_id
        currentVideoPath = ""
    }

    ColumnLayout {
        anchors.fill: parent
        spacing: 0

        // Video preview placeholder (QtMultimedia via Python service)
        Rectangle {
            Layout.fillWidth: true
            Layout.preferredHeight: 300
            color: "black"

            Label {
                anchors.centerIn: parent
                text: detailRoot.currentVideoPath ? "▶ " + detailRoot.currentTitle
                      : detailRoot.currentTitle
                color: Theme.textMuted
                font.pixelSize: 14
            }
        }

        // Timeline
        RowLayout {
            id: timeline
            Layout.fillWidth: true
            Layout.leftMargin: 8
            Layout.rightMargin: 8
            Layout.topMargin: 4
            height: 32

            Label {
                text: formatTime(player.position)
                color: Theme.textMuted
                font.pixelSize: 11
            }

            Slider {
                id: scrubber
                Layout.fillWidth: true
                from: 0
                to: Math.max(player.duration, 1)
                value: player.position
                onMoved: player.seek(value)
            }

            Label {
                text: formatTime(player.duration)
                color: Theme.textMuted
                font.pixelSize: 11
            }
        }

        // Controls
        RowLayout {
            Layout.fillWidth: true
            Layout.leftMargin: 8
            Layout.rightMargin: 8
            Layout.bottomMargin: 8
            height: 40

            Button {
                text: player.isPlaying ? "⏸" : "▶"
                flat: true
                onClicked: {
                    if (player.isPlaying) player.pause()
                    else player.play()
                }
            }

            Label {
                text: "← → ±5s  Space ⏯"
                color: Theme.textMuted
                font.pixelSize: 10
                Layout.fillWidth: true
            }

            Button {
                text: "Render"
                flat: true
                highlighted: true
            }
        }
    }

    Keys.onPressed: {
        if (event.key === Qt.Key_Space) {
            event.accepted = true
            if (player.isPlaying) player.pause()
            else player.play()
        }
        if (event.key === Qt.Key_Left) {
            event.accepted = true
            player.seekRelative(event.modifiers & Qt.ShiftModifier ? -1 : -5)
        }
        if (event.key === Qt.Key_Right) {
            event.accepted = true
            player.seekRelative(event.modifiers & Qt.ShiftModifier ? 1 : 5)
        }
    }

    function formatTime(seconds) {
        const m = Math.floor(seconds / 60)
        const s = Math.floor(seconds % 60)
        return m + ":" + (s < 10 ? "0" : "") + s
    }
}
