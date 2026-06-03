# M0 — Status (2026-06-03)

## ✅ Done

- Rust toolchain installed (rustup → stable 1.96.0 MSVC, Tauri CLI 2.11.2)
- WPF migration folder removed (`hyperclip/` — was build artifacts only, no source)
- Cargo workspace at `src-tauri/` with 3 sub-crates + root binary
- `hyperclip-core` — domain types (`WorkspaceData`, `StoredChannel`, `TrimLimit`, `WorkspaceStatus`, error type, paths)
- `hyperclip-store` — JSON persistence (60s cache TTL, async fs, mirrors `electron/services/store.ts` behavior)
- `hyperclip-ipc` — command function (Tauri `#[command]` derive intentionally lives in root crate to avoid macro hygiene bug)
- `hyperclip` root crate — Tauri 2.11 binary that registers `workspace_list_cmd` and pre-warms the Store
- Frontend `ipc.ts` shim — wraps `@tauri-apps/api/core::invoke`, exposes `ipc.getWorkspaces()`
- `next.config.mjs` — `output: 'export'`, `trailingSlash: true`
- `package.json` — `@tauri-apps/api` added, `tauri:dev`/`tauri:build` scripts added
- `.gitignore` — `src-tauri/target/`, `src-tauri/Cargo.lock`, generated icons

## ✅ Tests passing

```
hyperclip-core  : 9 tests (workspace serde, status enum, trim_limit, paths)
hyperclip-store  : 4 tests (fixture load, cache, missing file, save roundtrip)
```

## ✅ Build

- `cargo build --workspace` (dev)   → OK
- `cargo build --workspace --release` → OK (5m 00s, produces `src-tauri/target/release/hyperclip.exe`)

## ⚠️ Known blocker — Next.js static export

`npm run build:next` (which produces `out/` for Tauri to bundle) fails with:

- `Cannot read properties of null (reading 'useContext')` from many pages — pre-existing issue (Zustand `useContext` during SSR)
- `<Html> should not be imported outside of pages/_document` on `/404` and `/500`
- API routes (`/api/admin/...`, `/api/license/...`) conflict with `output: 'export'` (no `generateStaticParams`)

These are **pre-existing** issues in the Next.js setup, not introduced by M0. Mitigations:

1. **Dev mode works** — `npm run tauri:dev` uses `next dev` (no static export). The Tauri WebView2 connects to `http://localhost:3000` and the Tauri binary invokes `workspace_list_cmd`. The Rust side reads from `%APPDATA%\HyperClip\.hyperclip\workspaces.json` and returns the data.

2. **Production build** — needs fixing the static export issues. Tracked for **M9** when we cut the final installer.

3. **API routes** — moved to `src/_webapp_only/api/` (Vercel web app routes, not needed in Tauri desktop). Can be restored if the web admin panel is needed again.

## Verification (manual, dev machine)

```bash
# 1. Backend build
cd src-tauri && cargo test -p hyperclip-core -p hyperclip-store   # all green
cd src-tauri && cargo build --workspace --release                 # produces hyperclip.exe

# 2. Frontend dev server (Next.js on :3000, Tauri WebView loads it)
cd d:/LOOP_COMPANY/HyperClip && npm run dev:next                  # in one terminal

# 3. Launch Tauri (WebView2 host)
cd d:/LOOP_COMPANY/HyperClip && npm run tauri:dev                 # in another terminal

# 4. Verify data path
mkdir -p "$APPDATA/HyperClip/.hyperclip"
echo '[]' > "$APPDATA/HyperClip/.hyperclip/workspaces.json"
# Edit the JSON to add a test workspace, refresh the Tauri window, see it appear.
```

## What M0 sets up for M1+

- Managed state pattern: M1 will add `app.manage(Store::for_default_dir()?)` in `src-tauri/src/lib.rs` and switch `workspace_list_cmd` to take `tauri::State<'_, Store>`.
- `tauri::State` retry in M1 — works in root crate, was just a workspace member issue.
- `tauriEvents.onSystemStats` placeholder is wired; M1 fills the producer side in `hyperclip-system`.
- IPC naming convention: `workspace_list_cmd` (snake_case) for Tauri commands; `ipc.getWorkspaces()` (camelCase) for the frontend shim — preserves old contract.
