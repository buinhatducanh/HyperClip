// src/ui/qml/Icon.qml
// Single source of truth for UI icons. Uses Unicode glyphs with Segoe UI Symbol
// for consistent rendering across the app.
// Usage: Icon { name: "play"; size: 14; color: Theme.text }
import QtQuick

Text {
    id: root
    property string name: "play"
    property int size: 14
    property color color: Theme.text
    property bool filled: true

    font.family: "Segoe UI Symbol, Segoe UI, Arial"
    font.pixelSize: size
    font.bold: filled
    horizontalAlignment: Text.AlignHCenter
    verticalAlignment: Text.AlignVCenter
    renderType: Text.NativeRendering
    width: size
    height: size
    text: {
        switch (name) {
            // Actions
            case "play":     return "▶"   // ▶
            case "pause":    return "⏸"   // ⏸
            case "add":      return "➕"   // ➕
            case "close":    return "×"   // ×
            case "delete":   return "✖"   // ✖
            case "back":     return "←"   // ←
            case "forward":  return "→"   // →
            case "refresh":  return "↻"   // ↻
            case "retry":    return "↻"   // ↻
            case "check":    return "✓"   // ✓
            case "check2":   return "✔"   // ✔
            case "folder":   return "▸"   // ▸ (chevron right, used for files)
            case "download": return "⬇"   // ⬇
            case "upload":   return "⬆"   // ⬆
            case "render":   return "▶"   // ▶
            case "search":   return "⌕"   // ⌕
            case "warning":  return "⚠"   // ⚠
            case "info":     return "ℹ"   // ℹ
            case "trash":    return "🗑"   // 🗑
            case "edit":     return "✎"   // ✎
            case "archive":  return "▢"   // ▢
            case "settings": return "⚙"   // ⚙
            // Status
            case "pending":     return "⏳" // ⏳
            case "waiting":     return "⏸" // ⏸
            case "downloading": return "⬇" // ⬇
            case "ready":       return "✔" // ✔
            case "editing":     return "✎" // ✎
            case "rendering":   return "▶" // ▶
            case "done":        return "✓" // ✓
            case "error":       return "✗" // ✗
            case "unknown":     return "?"
            // UI controls
            case "kebab":    return "⋮"   // ⋮
            case "caret":    return "▾"   // ▾
            case "caretR":   return "▸"   // ▸
            case "dot":      return "•"   // •
            case "circle":   return "●"   // ●
            case "empty":    return "○"   // ○
            default:         return "?"
        }
    }
}
