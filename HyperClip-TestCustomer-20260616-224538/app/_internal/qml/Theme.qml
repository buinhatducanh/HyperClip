pragma Singleton
import QtQuick

// Token giao diện dùng chung. QUY ƯỚC (2026-08-17): màu/spacing/radius/cỡ chữ
// mới → thêm token ở đây rồi dùng `Theme.x`, KHÔNG viết literal "#xxxxxx" trong
// component (trước đó `#FFD93D` xuất hiện 28 lần/12 file vì thiếu `warning`).
QtObject {
    // ─── Colors ──────────────────────────────────────────────────────
    readonly property color bg: "#121212"
    readonly property color cardBg: "#1A1A1A"
    readonly property color inputBg: "#1E1E1E"
    readonly property color accent: "#00B4FF"
    readonly property color success: "#00FF88"
    /// Vàng cảnh báo — trạng thái "chú ý / đang chờ / thiếu cấu hình".
    readonly property color warning: "#FFD93D"
    /// Cam "đang xử lý" (tải/render/đợi TikTok). Trước đây 6 sắc cam khác nhau.
    readonly property color processing: "#FFA500"
    readonly property color text: "#FFFFFF"
    /// Chữ phụ sáng hơn textMuted (mô tả, phụ đề) — trước là "#CCCCCC" literal.
    readonly property color textSecondary: "#CCCCCC"
    readonly property color textMuted: "#888888"
    readonly property color border: "#2A2A2A"
    readonly property color error: "#FF4444"
    readonly property color hoverBg: "#242424"
    readonly property color rowEven: "#161616"
    readonly property color rowOdd: "#1A1A1A"
    /// Lớp phủ tối lên thumbnail/modal.
    readonly property color overlay: "#000000AA"

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

    // ─── Font Sizes ──────────────────────────────────────────────────
    readonly property int textXs: 9
    readonly property int textSm: 11
    readonly property int textMd: 13
    readonly property int textLg: 16
    readonly property int textXl: 18
}
