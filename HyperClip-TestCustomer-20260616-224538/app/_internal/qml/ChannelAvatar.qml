// src/ui/qml/ChannelAvatar.qml
// Avatar tròn của một kênh YouTube — MỘT bản dựng dùng chung.
//
// Trước đây mỗi trang tự chép lại khối Image ẩn + OpacityMask (Sidebar,
// ChannelItem), nên thêm avatar cho trang mới là chép lần thứ ba. Gom về đây
// để sửa một chỗ ăn cả app.
//
// Chỉ đặt implicitWidth/implicitHeight, KHÔNG đặt width/height: item nằm
// trong Layout mà set width là "undefined behavior" (Sidebar.qml:399 đang dính
// cảnh báo Quick.layout-positioning). QQuickItem tự lấy width = implicitWidth
// khi không có Layout nào quản, nên dùng được trong cả Row/Flow/anchors.
import QtQuick
import QtQuick.Controls
import Qt5Compat.GraphicalEffects

Rectangle {
    id: root

    property string url: ""
    /// Tên kênh — chỉ dùng để lấy chữ cái đầu làm ảnh dự phòng.
    property string channelName: ""
    /// Màu nhận dạng của kênh (palette bên model). Rỗng thì về màu nhấn.
    property color tint: Theme.accent
    property int diameter: 24

    implicitWidth: diameter
    implicitHeight: diameter
    radius: diameter / 2
    // Ghép chuỗi kiểu `màu + "22"` chỉ đúng khi tint là chuỗi hex; tint ở đây
    // là kiểu color nên phải dựng alpha tử tế.
    color: Qt.rgba(tint.r, tint.g, tint.b, 0.13)
    border.color: Qt.rgba(tint.r, tint.g, tint.b, 0.27)
    border.width: 1

    readonly property bool imageReady: !!root.url && avatarImg.status === Image.Ready

    Image {
        id: avatarImg
        anchors.fill: parent
        source: root.url
        fillMode: Image.PreserveAspectCrop
        visible: false
        asynchronous: true
        // KHÔNG đặt sourceSize: để trống thì mọi trang dùng chung một khóa
        // cache ảnh của Qt → mở trang thứ hai không tải lại ảnh nào.
    }

    Rectangle {
        id: roundMask
        anchors.fill: parent
        radius: root.radius
        visible: false
    }

    OpacityMask {
        anchors.fill: parent
        source: avatarImg
        maskSource: roundMask
        visible: root.imageReady
    }

    Label {
        anchors.centerIn: parent
        visible: !root.imageReady
        text: root.channelName ? root.channelName[0].toUpperCase() : "?"
        color: root.tint
        font.pixelSize: Math.max(8, Math.round(root.diameter * 0.42))
        font.bold: true
    }
}
