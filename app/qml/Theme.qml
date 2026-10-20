pragma Singleton
import QtQuick

QtObject {
    // ─── Colors ──────────────────────────────────────────────────────
    readonly property color bg: "#121212"
    readonly property color cardBg: "#1A1A1A"
    readonly property color inputBg: "#1E1E1E"
    readonly property color surface: "#181B22"
    readonly property color surfaceHover: "#222733"
    readonly property color cardBorder: "#282E3B"
    readonly property color accent: "#00B4FF"
    readonly property color accentHover: "#26C6FF"
    readonly property color accentGlow: "#2000B4FF"
    readonly property color success: "#00FF88"
    readonly property color warning: "#FFB800"
    readonly property color text: "#FFFFFF"
    readonly property color textMuted: "#888888"
    readonly property color border: "#2A2A2A"
    readonly property color cardBorderHover: "#3E3E3E"
    readonly property color error: "#FF4444"
    readonly property color hoverBg: "#242424"
    readonly property color rowHover: "#242424"
    readonly property color rowEven: "#161616"
    readonly property color rowOdd: "#1A1A1A"

    // ─── Queue Unified Status Colors ─────────────────────────────────
    readonly property color statusWaiting: "#8A99AD"     // Chờ xử lý (Xám bạc)
    readonly property color statusDownloading: "#FF9800" // Đang tải (Cam hổ phách)
    readonly property color statusRendering: "#00B4FF"   // Đang render (Cyan)
    readonly property color statusReady: "#00E676"       // Hoàn thành (Xanh lục ngọc)
    readonly property color statusError: "#FF5252"       // Thất bại / Lỗi (Đỏ)

    // ─── Spacing ─────────────────────────────────────────────────────
    readonly property int spacingXs: 4
    readonly property int spacingSm: 8
    readonly property int spacingMd: 12
    readonly property int spacingLg: 16
    readonly property int spacingXl: 24

    // ─── Border Radius ───────────────────────────────────────────────
    readonly property int radiusSm: 2
    readonly property int radiusMd: 4
    readonly property int radiusLg: 8
    readonly property int radiusXl: 12

    // ─── Button Standards ────────────────────────────────────────────
    readonly property int btnHeightSm: 28
    readonly property int btnHeightMd: 34
    readonly property int btnHeightLg: 40

    // ─── Font Sizes ──────────────────────────────────────────────────
    readonly property int textXs: 9
    readonly property int textSm: 11
    readonly property int textMd: 13
    readonly property int textLg: 16
    readonly property int textXl: 18

    // â”€â”€â”€ Missing properties referenced across QML components â”€â”€â”€â”€â”€â”€â”€â”€â”€
    readonly property color overlay: "#B0000000"
    readonly property bool isLight: false
    readonly property int animFast: 150
    readonly property color cardElevatedBg: "#222222"
    readonly property color highlight: "#00B4FF"
}
