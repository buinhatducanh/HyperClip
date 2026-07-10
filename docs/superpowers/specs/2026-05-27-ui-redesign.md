# HyperClip Full Redesign — Design Spec

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Redesign HyperClip UI với design system hoàn chỉnh — color tokens, spacing scale, typography, component library. Layout 3-column refined, activity log terminal style.

**Architecture:** Build `src/app/design-system/` với CSS variables + utility components (Card, Badge, Button, Section, TimelineLog). Rewrite Sidebar, TopBar, page.tsx layout để dùng design system. WorkspaceQueue và ActivityLogPanel làm đẹp.

**Tech Stack:** Tailwind CSS v3 (ưu tiên utility classes qua inline styles). CSS custom properties cho design tokens. React components (không thư viện UI bên ngoài).

---

## Design Tokens

### Colors

| Token | Value | Usage |
|-------|-------|-------|
| `--bg` | #F5F5F5 | Page background |
| `--surface` | #FFFFFF | Card, panel, elevated surfaces |
| `--surface-hover` | #F8F8F8 | Card hover state |
| `--border` | #E0E0E0 | Borders, dividers |
| `--border-light` | #EAEAEA | Subtle borders |
| `--border-hover` | #D0D0D0 | Hover borders |
| `--text` | #1A1A1A | Primary text |
| `--text-secondary` | #888888 | Secondary/muted text |
| `--text-tertiary` | #AAAAAA | Placeholder, disabled |
| `--accent` | #3B82F6 | Info, link, primary action |
| `--success` | #10B981 | Success, ready, done |
| `--warning` | #F59E0B | Warning, downloading |
| `--error` | #EF4444 | Error, rendering |
| `--sidebar-bg` | #FFFFFF | Sidebar background |
| `--terminal-bg` | #1A1A1A | Activity log terminal bg |

### Spacing (4px base)

| Token | px | rem |
|-------|----|-----|
| xs | 4px | 0.25rem |
| sm | 8px | 0.5rem |
| md | 12px | 0.75rem |
| lg | 16px | 1rem |
| xl | 24px | 1.5rem |
| 2xl | 32px | 2rem |

### Typography

| Token | Size | Weight | Usage |
|-------|------|--------|-------|
| xs | 10px | 600 | Labels, timestamps, badges |
| sm | 12px | 400/500 | Body, card titles, log messages |
| md | 14px | 600 | Section headings |
| lg | 16px | 600 | Panel titles, channel names |
| mono | — | 400 | Terminal log, progress numbers |

---

## Component Architecture

```
src/app/
├── design-system/
│   ├── tokens.ts          // All design constants
│   ├── Card.tsx            // Surface container (elevation, border, padding)
│   ├── Badge.tsx           // Status badge with dot + color
│   ├── Button.tsx          // Unified button (primary, secondary, ghost, danger)
│   ├── TimelineLog.tsx     // Terminal-style activity entry
│   └── Section.tsx         // Section header + collapsible content
├── components/
│   ├── Sidebar.tsx         // Rewrite — icon nav, channels, detection bar
│   ├── TopBar.tsx          // Rewrite — system stats, hardware profile
│   ├── ActivityLogPanel.tsx // Terminal style rewrite
│   ├── WorkspaceQueue.tsx  // Styling cleanup
│   └── ...                 // Giữ nguyên các component khác, chỉ đổi color tokens
├── page.tsx                // Layout cleanup
└── types.ts                // (unchanged)
```

### tokens.ts

Single source of truth for colors, spacing, typography. Export constants used by both inline styles and Tailwind classes.

```typescript
export const colors = {
  bg: '#F5F5F5',
  surface: '#FFFFFF',
  surfaceHover: '#F8F8F8',
  border: '#E0E0E0',
  borderLight: '#EAEAEA',
  borderHover: '#D0D0D0',
  text: '#1A1A1A',
  textSecondary: '#888888',
  textTertiary: '#AAAAAA',
  accent: '#3B82F6',
  success: '#10B981',
  warning: '#F59E0B',
  error: '#EF4444',
  sidebarBg: '#FFFFFF',
  terminalBg: '#1A1A1A',
}
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 }
export const fontSize = { xs: 10, sm: 12, md: 14, lg: 16 }
```

### Card.tsx

Container surface component thay thế toàn bộ div với style inline lặp lại.

```typescript
interface CardProps {
  children: React.ReactNode
  padding?: keyof typeof spacing | number
  border?: boolean
  hover?: boolean
  className?: string
  style?: React.CSSProperties
}
```

### Badge.tsx

Status badge với dot + label + color.

```typescript
interface BadgeProps {
  label: string
  color: string
  dot?: boolean
  pulse?: boolean
  size?: 'sm' | 'md'
}
```

### TimelineLog.tsx

Terminal-style log entry — dark background, monospace, timestamp + status tag + message.

```typescript
interface LogEntry {
  id: string
  timestamp: number
  type: 'detected' | 'downloading' | 'downloaded' | 'rendering' | 'done' | 'error'
  message: string
  detail?: string
}
```

Renders as:
```
[12:30:01] ● DET  Phát hiện: Cách làm bánh flan
[12:30:05] ▼ DL   Đang tải: 10 phút làm bánh
[12:31:20] ✓ OK  Hoàn tất: Review sản phẩm
[12:32:00] ✗ ERR Không tải được: private video
```

### Section.tsx

Section header + content, collapsible.

```typescript
interface SectionProps {
  label: string
  color?: string
  children: React.ReactNode
  defaultOpen?: boolean
}
```

---

## Page Layout

### Sidebar (rewrite)

- Icon nav bar: collapsed (60px) → show labels on hover
- Channel list: avatar + name + new-count badge
- DetectionStatusBar ở bottom (compact hơn)

### Center panel

- TopBar: sticky header, system stats + hardware profile + auto-download toggle
- DetailPanel / SettingsPanel thay phiên nhau (giống hiện tại)

### Right panel (280px — tăng lên 300px)

- WorkspaceQueue với search + filter tabs
- ActivityLogPanel dạng terminal ở bottom (300px height)

---

## Phases

### Phase 1: Design System
1. Create `tokens.ts` with all design constants (colors, spacing, fontSize)
2. Create `Card.tsx`, `Badge.tsx`, `Button.tsx`, `Section.tsx`, `TimelineLog.tsx`
3. **Migrate color constants** in ALL component files: replace hardcoded `#00B4FF` → `colors.accent`, `#00FF88` → `colors.success`, `#FF4444` → `colors.error`, `#F5F5F5` → `colors.bg`, `#FFFFFF` → `colors.surface`, `#E0E0E0` → `colors.border`. Tone down to #10B981/#3B82F6/#EF4444.
4. **Do NOT** change component logic or structure — chỉ replace color values và dùng Card/Section components ở chỗ rõ ràng.

### Phase 2: Layout Rewrite
1. Rewrite Sidebar (icon nav + channels)
2. Rewrite TopBar (stats, toggle)
3. Clean up page.tsx layout structure

### Phase 3: Queue + Activity Log
1. Style cleanup WorkspaceQueue (search, filters, groups)
2. Rewrite ActivityLogPanel → terminal style
3. WorkspaceCard styling refinement

### Phase 4: Detail/Editor Panel
1. VideoDetailPanel design cleanup
2. SettingsPanel design cleanup
