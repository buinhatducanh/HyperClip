pragma Singleton
import QtQuick

QtObject {
    // ─── Pro Dark Theme Colors ──────────────────────────────────────────
    readonly property color bg: "#0B0E14"
    readonly property color cardBg: "#11141D"
    readonly property color inputBg: "#161A26"
    readonly property color surface: "#141824"
    readonly property color surfaceHover: "#1E2435"
    readonly property color cardBorder: "#1E2435"
    readonly property color cardBorderHover: "#2E374D"
    readonly property color border: "#1A202E"

    // ─── Elegant Restrained Accents ─────────────────────────────────────
    readonly property color accent: "#38BDF8"       // Cyber Ice / Sky 400
    readonly property color accentHover: "#60A5FA"  // Sky 300
    readonly property color accentGlow: "#1538BDF8"

    // ─── Semantic Status Colors (Soft & Balanced) ───────────────────────
    readonly property color success: "#10B981"      // Emerald 500
    readonly property color warning: "#F59E0B"      // Amber 500
    readonly property color error: "#F43F5E"        // Rose 500

    // ─── Typography & Contrast ──────────────────────────────────────────
    readonly property color text: "#F8FAFC"         // Slate 50 (Crisp Off-white)
    readonly property color textMuted: "#8A99AD"    // Slate 400 (Readable Neutral)

    readonly property color hoverBg: "#181D2A"
    readonly property color rowHover: "#181D2A"
    readonly property color rowEven: "#0E1118"
    readonly property color rowOdd: "#11141D"

    // ─── Queue Unified Status Colors ─────────────────────────────────────
    readonly property color statusWaiting: "#8A99AD"     // Chờ xử lý (Xám bạc)
    readonly property color statusDownloading: "#38BDF8" // Đang tải (Ice Blue)
    readonly property color statusRendering: "#818CF8"   // Đang render (Indigo dịu)
    readonly property color statusReady: "#10B981"       // Hoàn thành (Emerald)
    readonly property color statusError: "#F43F5E"       // Thất bại / Lỗi (Rose)

    // ─── Spacing ─────────────────────────────────────────────────────────
    readonly property int spacingXs: 4
    readonly property int spacingSm: 8
    readonly property int spacingMd: 12
    readonly property int spacingLg: 16
    readonly property int spacingXl: 24

    // ─── Border Radius ───────────────────────────────────────────────────
    readonly property int radiusSm: 2
    readonly property int radiusMd: 4
    readonly property int radiusLg: 8
    readonly property int radiusXl: 12

    // ─── Button Standards ────────────────────────────────────────────────
    readonly property int btnHeightSm: 28
    readonly property int btnHeightMd: 34
    readonly property int btnHeightLg: 40

    // ─── Font Sizes ──────────────────────────────────────────────────────
    readonly property int textXs: 9
    readonly property int textSm: 11
    readonly property int textMd: 13
    readonly property int textLg: 16
    readonly property int textXl: 18
}
