// src/ui/qml/GcpWizard.qml
// Pass 56 — Wizard "Thêm project GCP" (2 bước).
//
// Google KHÔNG có API tạo project/API key, nên phần "tạo" bắt buộc là thao tác
// tay trong Cloud Console. Việc của wizard là làm cho thao tác tay đó không thể
// làm sai: mỗi bước một nút mở đúng trang, và bước cuối KIỂM CHỨNG BẰNG CALL
// THẬT rồi dịch lỗi Google sang câu tiếng Việt nói rõ phải sửa ở đâu.
//
// Không nhận Client Secret ở đây: dữ liệu kênh công khai chỉ cần API key, thêm
// OAuth vào chỉ làm khách rối và tăng thứ có thể hỏng.
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Popup {
    id: wizard
    modal: true
    focus: true
    closePolicy: Popup.CloseOnEscape
    anchors.centerIn: Overlay.overlay
    width: 620
    height: Math.min(660, parent ? parent.height - 40 : 660)
    padding: 0

    signal projectAdded()

    property int step: 0
    property string projectId: ""
    property string apiKey: ""
    property string errorText: ""
    property bool busy: false
    /// Chế độ dán hàng loạt — mặc định BẬT vì khách thường đã có sẵn cả danh
    /// sách key; nhập tay từng project chỉ hợp lý cho project đầu tiên.
    property bool bulkMode: true
    property var bulkResults: []
    property string bulkSummary: ""

    function reset() {
        step = 0
        projectId = ""
        apiKey = ""
        errorText = ""
        busy = false
        bulkResults = []
        bulkSummary = ""
        pidField.text = ""
        keyField.text = ""
        bulkField.text = ""
    }

    function runBulk(verifyOnly) {
        wizard.busy = true
        wizard.errorText = ""
        const text = bulkField.text
        Qt.callLater(function() {
            const resp = backend.send_command("project:addBulk",
                                              {"text": text, "verifyOnly": verifyOnly})
            wizard.busy = false
            if (!resp || resp.ok === false) {
                wizard.errorText = (resp && resp.error) || "Không gọi được backend"
                return
            }
            const r = resp.result || {}
            if (!r.success) {
                wizard.errorText = r.error || "Không đọc được nội dung đã dán"
                wizard.bulkResults = []
                return
            }
            wizard.bulkResults = r.results || []
            let s = "Đọc được " + r.parsed + " key"
            if (r.skippedExisting > 0) s += " · " + r.skippedExisting + " đã có sẵn"
            s += " · " + (r.results.filter(function(x){return x.ok}).length) + " dùng được"
            if (r.failed > 0) s += " · " + r.failed + " hỏng"
            if (!verifyOnly && r.added > 0) s += "  →  ĐÃ THÊM " + r.added
            wizard.bulkSummary = s
            if (!verifyOnly && r.added > 0) {
                if (quota) quota.refresh_from_backend(backend)
                wizard.projectAdded()
            }
        })
    }

    onOpened: reset()

    background: Rectangle {
        color: Theme.cardBg
        border.color: Theme.border
        border.width: 1
        radius: Theme.radiusLg
    }

    contentItem: ColumnLayout {
        spacing: 0

        // ─── Header ────────────────────────────────────────────────
        Rectangle {
            Layout.fillWidth: true
            Layout.preferredHeight: 52
            color: Theme.bg
            radius: Theme.radiusLg
            RowLayout {
                anchors.fill: parent
                anchors.leftMargin: 16
                anchors.rightMargin: 12
                spacing: 8
                ColumnLayout {
                    spacing: 0
                    Label {
                        text: "Thêm Google Cloud Project"
                        color: Theme.text
                        font.pixelSize: 16
                        font.bold: true
                    }
                    Label {
                        text: "Mỗi project = 10.000 units/ngày cho việc quét"
                        color: Theme.textMuted
                        font.pixelSize: 11
                    }
                }
                Item { Layout.fillWidth: true }

                // Chuyển giữa dán hàng loạt và nhập tay
                Repeater {
                    model: [
                        {bulk: true,  label: "Dán hàng loạt"},
                        {bulk: false, label: "Nhập từng cái"}
                    ]
                    delegate: Rectangle {
                        Layout.preferredHeight: 24
                        Layout.preferredWidth: tabLbl.implicitWidth + 20
                        radius: 12
                        color: wizard.bulkMode === modelData.bulk ? Theme.accent + "25" : "transparent"
                        border.color: wizard.bulkMode === modelData.bulk ? Theme.accent : Theme.border
                        border.width: 1
                        Label {
                            id: tabLbl
                            anchors.centerIn: parent
                            text: modelData.label
                            color: wizard.bulkMode === modelData.bulk ? Theme.accent : Theme.textMuted
                            font.pixelSize: 11
                            font.bold: wizard.bulkMode === modelData.bulk
                        }
                        MouseArea {
                            anchors.fill: parent
                            cursorShape: Qt.PointingHandCursor
                            enabled: !wizard.busy
                            onClicked: { wizard.bulkMode = modelData.bulk; wizard.step = 0 }
                        }
                    }
                }

                Label {
                    visible: !wizard.bulkMode
                    text: "Bước " + (wizard.step + 1) + "/2"
                    color: Theme.accent
                    font.pixelSize: 12
                    font.bold: true
                }
                IconButton {
                    iconName: "close"
                    iconSize: 12
                    Layout.preferredWidth: 28
                    Layout.preferredHeight: 26
                    onClicked: wizard.close()
                }
            }
        }

        // ─── Thân ──────────────────────────────────────────────────
        ScrollView {
            Layout.fillWidth: true
            Layout.fillHeight: true
            clip: true

            ColumnLayout {
                width: wizard.width - 32
                x: 16
                y: 14
                spacing: 12

                // ── DÁN HÀNG LOẠT ──────────────────────────────────
                ColumnLayout {
                    visible: wizard.bulkMode
                    Layout.fillWidth: true
                    spacing: 10

                    Label {
                        text: "Dán cả danh sách API key vào đây — mỗi key một dòng. App tự nhận dạng và kiểm chứng từng cái bằng lời gọi thật."
                        color: Theme.textMuted
                        font.pixelSize: 12
                        wrapMode: Text.WordWrap
                        Layout.fillWidth: true
                    }
                    Label {
                        text: "Chấp nhận mọi dạng: chỉ key, hoặc \"project,key\" / \"project | key\" / dán từ Excel / JSON export của app. Dòng trống và ghi chú (#) được bỏ qua."
                        color: Theme.textMuted
                        font.pixelSize: 11
                        wrapMode: Text.WordWrap
                        Layout.fillWidth: true
                        opacity: 0.8
                    }

                    Rectangle {
                        Layout.fillWidth: true
                        Layout.preferredHeight: 170
                        color: Theme.inputBg
                        border.color: bulkField.activeFocus ? Theme.accent : Theme.border
                        border.width: 1
                        radius: Theme.radiusMd
                        clip: true
                        ScrollView {
                            anchors.fill: parent
                            anchors.margins: 6
                            TextArea {
                                id: bulkField
                                placeholderText: "AIzaSy...\nproj-02, AIzaSy...\nproj-03 | AIzaSy..."
                                color: Theme.text
                                font.pixelSize: 12
                                font.family: "monospace"
                                selectByMouse: true
                                enabled: !wizard.busy
                                wrapMode: TextEdit.NoWrap
                                background: null
                                onTextChanged: { wizard.errorText = ""; wizard.bulkSummary = "" }
                            }
                        }
                    }

                    RowLayout {
                        Layout.fillWidth: true
                        spacing: 8
                        Label {
                            text: wizard.bulkSummary
                            color: Theme.text
                            font.pixelSize: 11
                            font.bold: true
                            Layout.fillWidth: true
                            wrapMode: Text.WordWrap
                        }
                        BusyIndicator {
                            running: wizard.busy
                            visible: wizard.busy
                            implicitWidth: 18; implicitHeight: 18
                        }
                    }

                    // Kết quả từng dòng — khách phải biết CÁI NÀO hỏng và vì sao,
                    // không phải một con số tổng.
                    ListView {
                        Layout.fillWidth: true
                        Layout.preferredHeight: Math.min(150, wizard.bulkResults.length * 26)
                        visible: wizard.bulkResults.length > 0
                        model: wizard.bulkResults
                        clip: true
                        spacing: 1
                        boundsBehavior: Flickable.StopAtBounds
                        delegate: Rectangle {
                            width: ListView.view.width
                            height: 25
                            radius: 3
                            color: index % 2 === 0 ? Theme.rowEven : "transparent"
                            RowLayout {
                                anchors.fill: parent
                                anchors.leftMargin: 8
                                anchors.rightMargin: 8
                                spacing: 8
                                Icon {
                                    name: modelData.ok ? "check" : "warning"
                                    size: 11
                                    color: modelData.ok ? Theme.success : Theme.error
                                }
                                Label {
                                    text: modelData.projectId
                                    color: Theme.text
                                    font.pixelSize: 11
                                    Layout.preferredWidth: 150
                                    elide: Text.ElideRight
                                }
                                Label {
                                    text: modelData.maskedKey
                                    color: Theme.textMuted
                                    font.pixelSize: 10
                                    font.family: "monospace"
                                    Layout.preferredWidth: 110
                                }
                                Label {
                                    text: modelData.ok ? "dùng được" : modelData.error
                                    color: modelData.ok ? Theme.success : Theme.error
                                    font.pixelSize: 10
                                    elide: Text.ElideRight
                                    Layout.fillWidth: true
                                }
                            }
                        }
                    }
                }

                // ── BƯỚC 1: làm trên Cloud Console ─────────────────
                ColumnLayout {
                    visible: !wizard.bulkMode && wizard.step === 0
                    Layout.fillWidth: true
                    spacing: 10

                    Label {
                        text: "Làm 4 việc sau trên Google Cloud Console. Bấm từng nút để mở đúng trang."
                        color: Theme.textMuted
                        font.pixelSize: 12
                        wrapMode: Text.WordWrap
                        Layout.fillWidth: true
                    }

                    component StepRow: Rectangle {
                        property int num: 1
                        property string title: ""
                        property string hint: ""
                        property string url: ""
                        Layout.fillWidth: true
                        implicitHeight: rowCol.implicitHeight + 20
                        color: Theme.bg
                        border.color: Theme.border
                        border.width: 1
                        radius: Theme.radiusMd

                        RowLayout {
                            anchors.fill: parent
                            anchors.margins: 10
                            spacing: 10
                            Rectangle {
                                Layout.preferredWidth: 22
                                Layout.preferredHeight: 22
                                Layout.alignment: Qt.AlignTop
                                radius: 11
                                color: Theme.accent + "25"
                                border.color: Theme.accent
                                border.width: 1
                                Label {
                                    anchors.centerIn: parent
                                    text: String(num)
                                    color: Theme.accent
                                    font.pixelSize: 11
                                    font.bold: true
                                }
                            }
                            ColumnLayout {
                                id: rowCol
                                Layout.fillWidth: true
                                spacing: 2
                                Label {
                                    text: title
                                    color: Theme.text
                                    font.pixelSize: 12
                                    font.bold: true
                                    wrapMode: Text.WordWrap
                                    Layout.fillWidth: true
                                }
                                Label {
                                    text: hint
                                    color: Theme.textMuted
                                    font.pixelSize: 11
                                    wrapMode: Text.WordWrap
                                    Layout.fillWidth: true
                                }
                            }
                            IconButton {
                                iconName: "forward"
                                label: "Mở"
                                iconSize: 11
                                Layout.preferredHeight: 26
                                Layout.alignment: Qt.AlignVCenter
                                onClicked: backend.send_command_async("system:openUrl", {"url": url})
                            }
                        }
                    }

                    StepRow {
                        num: 1
                        title: "Tạo project mới"
                        hint: "Đặt tên gì cũng được, ví dụ hyperclip-01. Ghi lại Project ID (chuỗi thật, không phải tên hiển thị)."
                        url: "https://console.cloud.google.com/projectcreate"
                    }
                    StepRow {
                        num: 2
                        title: "Bật YouTube Data API v3"
                        hint: "Chọn đúng project vừa tạo ở góc trên rồi bấm ENABLE. Bỏ qua bước này là nguyên nhân lỗi hay gặp nhất."
                        url: "https://console.cloud.google.com/apis/library/youtube.googleapis.com"
                    }
                    StepRow {
                        num: 3
                        title: "Tạo API key"
                        hint: "Credentials → CREATE CREDENTIALS → API key. Copy chuỗi bắt đầu bằng AIza..."
                        url: "https://console.cloud.google.com/apis/credentials"
                    }
                    StepRow {
                        num: 4
                        title: "Bỏ giới hạn cho key (nếu có)"
                        hint: "Mở key vừa tạo → Application restrictions để \"None\". Đặt giới hạn theo website sẽ chặn luôn app này."
                        url: "https://console.cloud.google.com/apis/credentials"
                    }

                    Rectangle {
                        Layout.fillWidth: true
                        implicitHeight: tipLabel.implicitHeight + 20
                        color: Theme.accent + "12"
                        border.color: Theme.accent + "50"
                        border.width: 1
                        radius: Theme.radiusMd
                        Label {
                            id: tipLabel
                            anchors.fill: parent
                            anchors.margins: 10
                            text: "Một tài khoản Google tạo được nhiều project (mặc định 12). Mỗi project có 10.000 units/ngày riêng, nên thêm project là cách trực tiếp nhất để quét nhanh hơn."
                            color: Theme.textMuted
                            font.pixelSize: 11
                            wrapMode: Text.WordWrap
                        }
                    }
                }

                // ── BƯỚC 2: nhập + kiểm chứng ──────────────────────
                ColumnLayout {
                    visible: !wizard.bulkMode && wizard.step === 1
                    Layout.fillWidth: true
                    spacing: 12

                    Label {
                        text: "Dán hai giá trị vừa lấy được. App sẽ gọi thử YouTube API để chắc chắn nó dùng được trước khi lưu."
                        color: Theme.textMuted
                        font.pixelSize: 12
                        wrapMode: Text.WordWrap
                        Layout.fillWidth: true
                    }

                    ColumnLayout {
                        Layout.fillWidth: true
                        spacing: 4
                        Label { text: "Project ID"; color: Theme.textMuted; font.pixelSize: 11 }
                        TextField {
                            id: pidField
                            Layout.fillWidth: true
                            placeholderText: "ví dụ: hyperclip-01-473210"
                            color: Theme.text
                            font.pixelSize: 13
                            font.family: "monospace"
                            enabled: !wizard.busy
                            background: Rectangle {
                                color: Theme.inputBg
                                border.color: pidField.activeFocus ? Theme.accent : Theme.border
                                border.width: 1
                                radius: Theme.radiusMd
                            }
                            onTextChanged: { wizard.projectId = text.trim(); wizard.errorText = "" }
                        }
                    }

                    ColumnLayout {
                        Layout.fillWidth: true
                        spacing: 4
                        Label { text: "API key"; color: Theme.textMuted; font.pixelSize: 11 }
                        TextField {
                            id: keyField
                            Layout.fillWidth: true
                            placeholderText: "AIza..."
                            color: Theme.text
                            font.pixelSize: 13
                            font.family: "monospace"
                            enabled: !wizard.busy
                            background: Rectangle {
                                color: Theme.inputBg
                                border.color: keyField.activeFocus ? Theme.accent : Theme.border
                                border.width: 1
                                radius: Theme.radiusMd
                            }
                            onTextChanged: { wizard.apiKey = text.trim(); wizard.errorText = "" }
                        }
                    }

                    Rectangle {
                        Layout.fillWidth: true
                        visible: wizard.errorText !== ""
                        implicitHeight: errLabel.implicitHeight + 20
                        color: Theme.error + "15"
                        border.color: Theme.error
                        border.width: 1
                        radius: Theme.radiusMd
                        RowLayout {
                            anchors.fill: parent
                            anchors.margins: 10
                            spacing: 8
                            Icon { name: "warning"; size: 14; color: Theme.error; Layout.alignment: Qt.AlignTop }
                            Label {
                                id: errLabel
                                text: wizard.errorText
                                color: Theme.error
                                font.pixelSize: 11
                                wrapMode: Text.WordWrap
                                Layout.fillWidth: true
                            }
                        }
                    }

                    RowLayout {
                        visible: wizard.busy
                        spacing: 8
                        BusyIndicator { running: wizard.busy; implicitWidth: 20; implicitHeight: 20 }
                        Label {
                            text: "Đang gọi thử YouTube API…"
                            color: Theme.textMuted
                            font.pixelSize: 11
                        }
                    }
                }
            }
        }

        // ─── Footer ────────────────────────────────────────────────
        Rectangle {
            Layout.fillWidth: true
            Layout.preferredHeight: 52
            color: Theme.bg
            RowLayout {
                anchors.fill: parent
                anchors.leftMargin: 16
                anchors.rightMargin: 16
                spacing: 8

                IconButton {
                    visible: !wizard.bulkMode && wizard.step > 0
                    iconName: "back"
                    label: "Quay lại"
                    iconSize: 11
                    Layout.preferredHeight: 30
                    enabled: !wizard.busy
                    onClicked: wizard.step = 0
                }
                // Kiểm tra trước khi lưu: dán nhầm danh sách của máy khác thì
                // biết ngay, không làm bẩn pool.
                IconButton {
                    visible: wizard.bulkMode
                    iconName: "search"
                    label: "Chỉ kiểm tra"
                    iconSize: 11
                    Layout.preferredHeight: 30
                    enabled: !wizard.busy && bulkField.text.trim() !== ""
                    onClicked: wizard.runBulk(true)
                }
                Item { Layout.fillWidth: true }
                IconButton {
                    iconName: "close"
                    label: "Đóng"
                    iconSize: 11
                    Layout.preferredHeight: 30
                    enabled: !wizard.busy
                    onClicked: wizard.close()
                }
                IconButton {
                    visible: wizard.bulkMode
                    iconName: "check"
                    label: "Kiểm chứng & thêm hết"
                    iconSize: 11
                    Layout.preferredHeight: 30
                    Layout.minimumWidth: 160
                    colorIdle: Theme.accent + "25"
                    colorHover: Theme.accent + "45"
                    border.color: Theme.accent
                    enabled: !wizard.busy && bulkField.text.trim() !== ""
                    onClicked: wizard.runBulk(false)
                }
                IconButton {
                    visible: !wizard.bulkMode
                    iconName: wizard.step === 0 ? "forward" : "check"
                    label: wizard.step === 0 ? "Tôi đã làm xong" : "Kiểm chứng & lưu"
                    iconSize: 11
                    Layout.preferredHeight: 30
                    Layout.minimumWidth: 130
                    colorIdle: Theme.accent + "25"
                    colorHover: Theme.accent + "45"
                    border.color: Theme.accent
                    enabled: !wizard.busy
                             && (wizard.step === 0
                                 || (wizard.projectId !== "" && wizard.apiKey !== ""))
                    onClicked: {
                        if (wizard.step === 0) {
                            wizard.step = 1
                            return
                        }
                        wizard.busy = true
                        wizard.errorText = ""
                        // Hoãn ra khỏi stack click: send_command quay vòng lặp
                        // lồng nhau, gọi thẳng trong onClicked là hủy delegate
                        // giữa lúc chuột đang được xử lý (crash 18/07).
                        Qt.callLater(function() {
                            const resp = backend.send_command("project:addFull", {
                                "projectId": wizard.projectId,
                                "apiKey": wizard.apiKey,
                                "name": wizard.projectId
                            })
                            wizard.busy = false
                            if (!resp || resp.ok === false) {
                                wizard.errorText = (resp && resp.error) || "Không gọi được backend"
                                return
                            }
                            const r = resp.result || {}
                            if (r.success) {
                                if (quota) quota.refresh_from_backend(backend)
                                wizard.projectAdded()
                                wizard.close()
                            } else {
                                wizard.errorText = r.error || "Kiểm chứng thất bại"
                            }
                        })
                    }
                }
            }
        }
    }
}
