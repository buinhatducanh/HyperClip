// src/ui/qml/Icon.qml
// Single source of truth for UI icons. Uses Unicode glyphs with Segoe UI Symbol
// for consistent, flat, monochrome rendering across the app.
// Avoids multi-color emoji fallback from Windows DirectWrite.
import QtQuick

Text {
    id: root
    property string name: "play"
    property int size: 14
    property color color: Theme.textMuted
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
            // Actions (Flat Monochrome Glyphs)
            case "play":     return "▶"
            case "pause":    return "⏸"
            case "add":      return "+"
            case "close":    return "✕"
            case "delete":   return "✕"
            case "back":     return "←"
            case "forward":  return "→"
            case "refresh":  return "↻"
            case "retry":    return "↻"
            case "check":    return "✓"
            case "check2":   return "✓"
            case "folder":   return "🗀"
            case "download": return "↓"
            case "upload":   return "↑"
            case "render":   return "▶"
            case "search":   return "⌕"
            case "warning":  return "▲"
            case "info":     return "ℹ"
            case "trash":    return "✕"
            case "edit":     return "✎"
            case "archive":  return "▢"
            case "settings": return "⚙"
            case "proxy":    return "◎"
            case "globe":    return "◎"
            case "network":  return "◎"
            case "link":     return "↗"
            // Status
            case "pending":     return "◌"
            case "waiting":     return "⏸"
            case "downloading": return "↓"
            case "ready":       return "✓"
            case "editing":     return "✎"
            case "rendering":   return "▶"
            case "done":        return "✓"
            case "error":       return "✕"
            case "unknown":     return "?"
            // UI controls
            case "bolt":     return "✦"
            case "kebab":    return "⋮"
            case "caret":    return "▾"
            case "caretR":   return "▸"
            case "dot":      return "•"
            case "circle":   return "●"
            case "empty":    return "○"
            case "star":     return "★"
            default:         return "?"
        }
    }
}
