// Tauri-based IPC shim — replaces the Electron `window.electronAPI` surface.
// Function names and return shapes match the old contract; the implementation
// is a thin wrapper around `@tauri-apps/api/core::invoke` and `event::listen`.
//
// M0 only exposes `getWorkspaces`. The rest of the IPC surface will be
// added incrementally per milestone (see docs/superpowers/specs/2026-06-03-rust-migration-design.md).

import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

// ─── M0 commands ────────────────────────────────────────────────────────────

export const ipc = {
  async getWorkspaces(): Promise<unknown[]> {
    if (!isTauri) return []
    return (await invoke('workspace_list_cmd')) as unknown[]
  },
}

// ─── Tauri event subscriptions (placeholders — filled in by later milestones) ─

export const tauriEvents = {
  onSystemStats(_cb: (stats: object) => void): () => void {
    if (!isTauri) return () => {}
    let unlisten: () => void = () => {}
    listen('system:stats-update', e => _cb(e.payload as object)).then(u => {
      unlisten = u
    })
    return () => unlisten()
  },
}
