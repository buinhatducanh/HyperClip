# HyperClip — UI Overhaul: Click-to-Detail, Storage View, Sidebar/Card Cleanup

**Date:** 2026-06-10
**Author:** Claude (via brainstorming)

---

## Scope

This spec covers 4 interconnected UI problems discovered in the QML frontend:

1. **Click-to-detail flow broken** — `WorkspaceCard.onClicked` references undefined `window`
2. **`update_field` Slot missing** — Python method not exposed to QML
3. **Card/Sidebar visual noise** — 9:16 badge, icon font rendering, text overlap
4. **Storage/detail view placeholder** — `RenderedVideoDetail` has no real data population

All 4 will be fixed in a single pass. No unrelated refactoring.

---

## Section 1: Click → Detail Data Flow

### Current (broken)

```
WorkspaceCard.onClicked
  → detailEditor.loadWorkspace(id)        // OK — QML dynamic scope finds it
  → window.centerView = "workspace"       // BROKEN — `window` is undefined
```

`loadWorkspace()` copies <10 fields from the ListView model (`id`, `title`, `channel_name`, `progress`, `quality`, `speed`, `trimStart`, `trimEnd`, `thumbnail`, `thumbnail_local`, `durationSec`, `video_id`). These are stale snapshots and omit metrics like `fileSize`, `downloadSpeed`, `source`, `renderFps`, `renderPreset`, etc.

### Target

```
WorkspaceCard.onClicked
  → emit workspaceClicked(ws_id)
    → WorkspaceQueue connects via signal → openWorkspace(ws_id)
      → main.qml handler:
          1. IPC: "workspace:get" { id: ws_id } → full workspace data
          2. detailEditor.loadFromIPC(data)     // all fields populated
          3. root.centerView = "workspace"      // uses actual id `root`
```

### Changes required

| File | Change |
|------|--------|
| WorkspaceCard.qml | Replace `window.centerView` with `root.workspaceClicked(id)` signal |
| WorkspaceQueue.qml | Add `signal openWorkspace(string id)`; connect delegate's signal |
| main.qml | Remove `window` reference; handle `openWorkspace`; call IPC `workspace:get` |
| DetailEditor.qml | New method `loadFromIPC(data)` — accepts full JSON blob, not model snapshot |

**`workspace:get` IPC handler** (Rust side) already exists? Let me check — `commands.rs` has `workspace:update`, `workspace:list`, `workspace:delete`. `workspace:get` needs to be added or we can reuse `workspace:list` filtered server-side. **Add `workspace:get`** returning the full workspace dict (all fields including `fileSize`, `downloadSpeed`, `downloadTime`, `source`, `renderFps`, `renderWorkers`, `renderPreset`, `renderCodec`, `outputPath`, `trimStart`, `trimEnd`, `speed`).

---

## Section 2: `update_field` Slot

### Problem

`WorkspaceModel.update_field()` has no `@Slot` decorator → QML gets "is not a function".

### Fix

Add explicit `@Slot(str, str, str, object)` decorator to `update_field`. The fourth parameter is `client` (Python object). This is the correct slot signature matching the QML call sites:

```python
@Slot(str, str, str, object)
def update_field(self, workspace_id: str, field: str, value, client=None):
```

---

## Section 3: Card & Sidebar Visual Cleanup

### 3a. Remove 9:16 badge

**WorkspaceCardDisplay.qml:83-91** — Delete the `isShort` overlay rectangle entirely. Short-form detection is already conveyed by:
- Thumbnail width difference (`36px` vs `64px`)
- Aspect ratio in the thumbnail crop

No replacement badge needed.

### 3b. Icon font robustness

**Icon.qml** uses `Segoe UI Symbol` which may fall back to different glyphs on non-US systems, producing "strange symbols". Add a fallback font chain:

```qml
font.family: "Segoe UI Symbol, Segoe UI, Arial"
```

Also replace problematic Unicode glyphs with simpler equivalents:
- `↻` (refresh) → `⟳` or keep, it's usually stable
- `⚲` (search) → problematic on some systems → replace with `⌕` or simplify to text label on hover

### 3c. Sidebar text overlap

**Sidebar.qml:263-270** — Channel name label has `elide: Text.ElideRight` which should prevent overlap. However, the hover action buttons (`RowLayout` containing pause/delete at line 297-347) are conditionally visible on hover. When they appear, the channel name elides — but if the action buttons have no fixed width constraint, they can push the label.

Fix: Give the action button row `Layout.preferredWidth: 44` (18px + 4 spacing + 18px + margins) so the elide math is correct.

### 3d. Meta line crowding

**WorkspaceCardDisplay.qml:172-179** — The channel_name + ageLabel + fileSize + duration line concatenates with `·` separators. When multiple meta items exist, the line gets crowded.

Fix: Keep single-line but ensure `elide: Text.ElideRight` is active. If the label overflows, it truncates at the right side (duration is least important). Acceptable for 320px card width.

---

## Section 4: Storage / Detail View Revamp

### 4a. RenderedVideoDetail data population

**Current:** `loadRendered(id)` sets only `currentRenderedId` and switches view to `"rendered"`. `currentRenderedData` stays `{}`.

**Fix:** In the `"rendered"` view component in main.qml, call IPC `rendered:get` (or filter `rendered:list` results) to populate `currentRenderedData` with full details (outputPath, fileSize, duration, quality, renderedAt, thumbnail).

### 4b. No `rendered:get` IPC handler

Check if it exists — if not, add a handler in `commands.rs` that looks up a single rendered video by ID and returns its full dict. The Rust `store.rs` likely iterates over rendered items — add a lookup method.

### 4c. Thumbnail in storage view

**RenderedVideoDetail.qml** already shows a 300px black preview area. Replace with:
- `Image` element loading `videoData.thumbnail` (if available)
- Fallback: large icon with video ID text

### 4d. RenderedMini list

The mini list in the right panel (main.qml:166-222) currently shows only title + size. Thumbnails at 22px row height are impractical, but we can add a small color indicator (status dot-like) for archived state, and make titles more readable with proper spacing.

---

## Rust Changes

### `commands.rs` — Two new IPC handlers

| Command | Params | Returns |
|---------|--------|---------|
| `workspace:get` | `{ id: string }` | Full workspace object (all fields below) |
| `rendered:get` | `{ id: string }` | Full rendered video object |

**Workspace fields surfaced:** `id`, `title`, `status`, `progress`, `channel_name`, `thumbnail`, `isShort`, `durationSec`, `fileSize`, `quality`, `speed`, `downloadSpeed`, `downloadTime`, `source`, `renderFps`, `renderWorkers`, `renderPreset`, `renderCodec`, `outputPath`, `trimStart`, `trimEnd`, `video_id`, `thumbnail_local`, `created_at`.

**Rendered fields surfaced:** `id`, `title`, `channelName`, `outputPath`, `fileSize`, `duration`, `renderedAt`, `quality`, `archived`, `thumbnail`.

### `store.rs`

- `get_workspace(id: &str) -> Option<&Workspace>` — lookup by id
- `get_rendered(id: &str) -> Option<&RenderedVideo>` — lookup by id

If these don't exist, add them. The workspace list is already cached; a linear scan by id is O(n) and fine for ~1000 items.

---

## No-Go Areas

- **Do NOT** rename `id: root` to `id: window` in main.qml — too many internal references break
- **Do NOT** refactor Python model inheritance or QML component hierarchy
- **Do NOT** touch styling outside the files listed above
- **Do NOT** add 9:16 badge replacement — remove only

---

## Test Plan

| Test | How |
|------|-----|
| Click workspace card → detail panel opens | Manual: click card in queue, verify center pane shows detail |
| Detail panel shows full metrics | Manual: verify download/render/system sections populated |
| Edit title/speed/trim → persists | Manual: change field, verify `workspace:update` fires |
| Sidebar long channel name → no overlap | Manual: add channel with 50-char name, verify elide + action buttons |
| Rendered detail shows thumbnail + metadata | Manual: click rendered item, verify populated |
| `cargo test -p hyperclip-ipc` | Existing tests still pass |
| `cargo clippy -p hyperclip-ipc` | No new warnings |
| App launches without QML errors | Terminal output check for "TypeError" or "ReferenceError" |
