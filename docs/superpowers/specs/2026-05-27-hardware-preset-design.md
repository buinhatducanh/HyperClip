# Hardware Preset System — Design Spec

**Date:** 2026-05-27
**Status:** Approved for implementation

---

## 1. Overview

Replace auto-detection-based `MachineTier` with a user-selectable **Hardware Preset** system.
Users pick a preset from a list; the backend scales performance parameters accordingly.
Auto-detection still runs — it only **validates** which presets are available.

---

## 2. Preset Definitions

| Preset  | VRAM | RAM | Download Instances | Render Workers | Chunk Workers | Chrome Sessions |
|---------|------|-----|-------------------|----------------|---------------|-----------------|
| Ultra   | 16GB | 64GB| 3                 | 4              | 8             | 10              |
| High    | 12GB | 48GB| 2                 | 3              | 6             | 8               |
| Medium  | 8GB  | 32GB| 2                 | 2              | 4             | 6               |
| Low     | 6GB  | 24GB| 1                 | 2              | 2             | 4               |
| Minimal | 4GB  | 16GB| 1                 | 1              | 1             | 2               |

---

## 3. Validation Rules

A preset is **available** if:
- `preset.vramGB <= detectedGPU.memory`
- `preset.ramGB <= detectedRAM.GB`

Unavailable presets are shown as **disabled pills** with tooltip: `"Máy bạn có XGB VRAM, preset này cần YGB"`.

---

## 4. Backend Changes

### 4.1 Settings

`AppSettings.hardwareProfile`:
```typescript
interface HardwareProfile {
  vramGB: number   // e.g. 16
  ramGB: number    // e.g. 64
}
```

### 4.2 `electron/services/system.ts`

- `getEffectiveWorkers()` → reads from settings if `hardwareProfile` set, else auto-detect
- `getDownloadParams()` → same
- Keep `detectGPUOnce()` and `os.totalmem()` for validation (available presets)

### 4.3 IPC Handler: `system:getHardwareProfile`

Returns:
```typescript
{
  detected: { vramGB: number; ramGB: number; gpuName: string },
  presets: Array<{
    id: string           // 'ultra' | 'high' | 'medium' | 'low' | 'minimal'
    label: string       // 'Ultra'
    vramGB: number
    ramGB: number
    downloadInstances: number
    renderWorkers: number
    chunkWorkers: number
    sessions: number
    available: boolean   // validated against detected hardware
  }>
  active: string | null // preset id from settings
}
```

---

## 5. Frontend: HardwareProfileCard

**Location:** New card inside `SettingsPanel.tsx`

```
┌─────────────────────────────────────────┐
│ HARDWARE PROFILE                        │
│                                         │
│ Detected: RTX 5080 · 16GB VRAM · 64GB  │
│                                         │
│ [Ultra 16/64] [High 12/48] [Med 8/32]  │
│  ● 8 workers · 3 dl · 10 sessions      │
│                                         │
│ [Low 6/24] [Minimal 4/16]              │
│  ● 2 workers · 1 dl · 4 sessions       │
└─────────────────────────────────────────┘
```

- **Pill buttons**: 36px height, 28px font — large click targets
- **Selected**: accent background + border
- **Disabled**: grayed out, strikethrough, tooltip on hover
- Card padding: 12px, margin: 4px 6px 2px (matches other cards)

---

## 6. Files to Change

| File | Changes |
|------|---------|
| `src/app/types.ts` | Add `HardwarePreset` type |
| `src/app/lib/store.ts` | Add `hardwareProfile: HardwareProfile` to `AppSettings` |
| `electron/services/system.ts` | `getEffectiveWorkers()` / `getDownloadParams()` read preset from settings |
| `electron/ipc/handlers/system.ts` | Add `system:getHardwareProfile` handler |
| `src/app/components/SettingsPanel.tsx` | Add `HardwareProfileCard` component |
| `src/app/components/TopBar.tsx` | Show preset label instead of raw worker counts |

---

## 7. Fallback Behavior

If `hardwareProfile` is not set in settings, the system falls back to auto-detection (current behavior). The preset is set once user saves a choice.
