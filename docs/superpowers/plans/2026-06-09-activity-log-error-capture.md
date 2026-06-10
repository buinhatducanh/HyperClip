# Activity Log Error Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-capture all Rust IPC errors into ActivityLog + Toast, bump log to 1000 lines with batch trim.

**Architecture:** RustClient intercepts `ok: false` IPC responses → emits `errorReceived` signal → EventBus relays → ActivityLogModel logs + ToastService shows warnings/errors. ActivityLogModel trims in batch when hitting 1000 entries.

**Tech Stack:** Python (PySide6), Rust IPC, QML, EventBus

---

### Task 1: EventBus — add error_occurred signal

**Files:**
- Modify: `src/backend/events.py`

- [ ] **Step 1: Add `error_occurred` signal to EventBus**

```python
# src/backend/events.py
class EventBus(QObject):
    workspace_updated = Signal(dict)
    render_progress = Signal(str, float)
    system_stats_updated = Signal(dict)
    notification = Signal(str, str)
    new_video_detected = Signal(dict)
    poller_status_changed = Signal(dict)
    channel_synced = Signal()
    download_progress = Signal(str, float, float, int)
    error_occurred = Signal(str, str, str)  # source, message, level
```

- [ ] **Step 2: Quick sanity — verify file loads**

Run: `python -c "from src.backend.events import get_event_bus; b = get_event_bus(); print(type(b.error_occurred))"`
Expected: `<class 'PySide6.QtCore.Signal'>`

- [ ] **Step 3: Commit**

```bash
git add src/backend/events.py
git commit -m "feat(eventbus): add error_occurred signal"
```

---

### Task 2: RustClient — auto-intercept IPC errors

**Files:**
- Modify: `src/backend/client.py`

Currently `_pending` maps `int → list[cell]`. Change to `int → tuple(cell, cmd_name)` so we know which command failed when emitting the error.

- [ ] **Step 1: Add `errorReceived` signal + change `_pending` to store cmd_name**

```python
class RustClient(QObject):

    eventReceived = Signal(object)
    errorReceived = Signal(str, str, str)  # cmd, error_msg, level

    def __init__(self, binary_path, parent=None):
        super().__init__(parent)
        ...
        self._pending: dict[int, tuple] = {}  # req_id → (cell, cmd_name)
        ...

        self.eventReceived.connect(self._on_event_signal, Qt.QueuedConnection)
        self.errorReceived.connect(self._on_error_signal, Qt.QueuedConnection)
        self._start()
```

- [ ] **Step 2: Store cmd_name when sending**

```python
def send_command_async(self, cmd, params=None, callback=None) -> int:
    ...
    cell = [None, callback]
    with self._pending_lock:
        self._pending[req_id] = (cell, cmd)  # store tuple instead of cell
    ...
```

- [ ] **Step 3: Extract cmd_name + emit error when `ok: false`**

In `_read_stdout`, change the response handler:

```python
if "id" in msg:
    req_id = msg["id"]
    entry = None
    with self._pending_lock:
        if req_id in self._pending:
            entry = self._pending.pop(req_id)
    if entry:
        cell, cmd_name = entry  # unpack tuple
        cell[0] = msg
        if cell[1]:
            self._invoke_callback_async(cell[1], msg)
        # Auto-detect errors — emit for all ok: false responses
        if not msg.get("ok", True):
            err_text = msg.get("error", "Unknown error")
            self.errorReceived.emit(cmd_name or "unknown", err_text, "error")
```

Also fix the `BrokenPipeError` handler — emit error signal there too:

```python
except (BrokenPipeError, OSError) as e:
    with self._pending_lock:
        self._pending.pop(req_id, None)
    err = {"ok": False, "error": str(e)}
    if callback:
        self._invoke_callback_async(callback, err)
    self.errorReceived.emit(cmd, str(e), "error")
```

- [ ] **Step 4: Add `_on_error_signal` handler**

```python
def _on_error_signal(self, cmd: str, msg: str, level: str):
    """Dispatched on main thread via queued connection."""
    try:
        from src.backend.events import get_event_bus
        bus = get_event_bus()
        bus.error_occurred.emit(cmd, msg, level)
    except Exception as e:
        sys.stderr.write(f"[RustClient] error dispatch: {e}\n")
```

- [ ] **Step 5: Test — verify signals work**

Run: `python -c "from src.backend.client import RustClient; print('ok')"` — ensures no syntax error.
Then run `cargo build -p hyperclip-tauri` and do a quick UI test with `python src/main.py` — verify app launches.

- [ ] **Step 6: Commit**

```bash
git add src/backend/client.py
git commit -m "feat(rustclient): auto-intercept IPC errors and emit errorReceived signal"
```

---

### Task 3: ActivityLogModel — bump to 1000 + batch trim

**Files:**
- Modify: `src/models/activity_log_model.py`

- [ ] **Step 1: Change default max to 1000, add batch trim**

```python
class ActivityLogModel(QAbstractListModel):
    ...

    def __init__(self, parent=None, max_entries: int = 1000):
        super().__init__(parent)
        self._entries: list[dict] = []
        self._max = max_entries
```

Replace the single-entry pop with batch trim (remove excess in bulk to avoid O(n) per add):

```python
    @Slot(str, str, str)
    def add_entry(self, type_: str, message: str, level: str = "info"):
        ts = datetime.now().strftime("%H:%M:%S")
        self.beginInsertRows(QModelIndex(), len(self._entries), len(self._entries))
        self._entries.append({"time": ts, "type": type_, "message": message, "level": level})
        overflow = len(self._entries) - self._max
        if overflow > 0:
            # Batch-trim in chunks of 200 to avoid QML flicker on large deletes
            trim = min(overflow + 200, len(self._entries))
            self.beginRemoveRows(QModelIndex(), 0, trim - 1)
            self._entries = self._entries[trim:]
            self.endRemoveRows()
        self.endInsertRows()
```

This keeps 800 entries after overflow (trim 200), so trim operations are infrequent — ~1 trim per 200 new entries after the first 1000.

- [ ] **Step 2: Test trim boundary**

Run: `python -c "
from src.models.activity_log_model import ActivityLogModel
m = ActivityLogModel(max_entries=10)
for i in range(15):
    m.add_entry('test', f'entry {i}', 'info')
print(f'After 15 adds: {m.rowCount()} entries (expected ~8-10)')
assert 6 <= m.rowCount() <= 10, 'trim broken'
print('PASS')
"` Expected: trim to ~8 entries (10-2).

- [ ] **Step 3: Commit**

```bash
git add src/models/activity_log_model.py
git commit -m "feat(activity-log): bump max entries to 1000 with batch trim"
```

---

### Task 4: main.py — wire error routing

**Files:**
- Modify: `src/main.py`

Wire the full chain: Rust IPC errors → EventBus → ActivityLog + Toast.

- [ ] **Step 1: Wire Rust IPC errors to EventBus**

After the existing event bus wiring block:

```python
    # ─── Error routing ──────────────────────────────────────────────
    # Rust IPC errors → EventBus → ActivityLog + Toast
    client.errorReceived.connect(
        lambda cmd, msg, level: bus.error_occurred.emit(cmd, msg, level)
    )
```

- [ ] **Step 2: Wire EventBus → ActivityLog + Toast**

```python
    # Log all errors to activity log
    bus.error_occurred.connect(lambda source, msg, level: (
        activity_model.add_entry("system", f"[{source}] {msg}", level),
    ))

    # Show toast for errors and warnings
    bus.error_occurred.connect(lambda source, msg, level: (
        toast_service.show("Lỗi hệ thống" if level == "error" else "Cảnh báo",
                           f"[{source}] {msg}", level),
    ) if level in ("error", "warn") else None)
```

- [ ] **Step 3: Also wire existing notification bus to show toasts for critical messages**

```python
    # Wire notification → toast for non-info levels (existing bus.notification only logs)
    bus.notification.connect(lambda title, message: (
        toast_service.show("Thông báo", f"{title}: {message}", "info"),
    ))
```

(This upgrades existing `bus.notification` to also show toasts — currently it only logs.)

- [ ] **Step 4: Verify app still starts**

Run: `python src/main.py` — verify UI loads, ActivityLog card renders, no errors on stderr.

- [ ] **Step 5: Commit**

```bash
git add src/main.py
git commit -m "feat(main): wire Rust IPC errors → ActivityLog + Toast"
```

---

### Task 5: Rust error push events — wire notification → error_occurred

**Files:**
- Modify: `src/backend/client.py`

Some Rust components push error events via the `notification` method. Make sure these also follow the error_occurred path when level is error/warn.

- [ ] **Step 1: Route error-level notifications from Rust push events**

In `_on_event_signal`, after dispatching `notification`:

```python
    elif method == "notification":
        title = params.get("title", "")
        message = params.get("message", "")
        level = params.get("level", "info")
        bus.notification.emit(title, message)
        # Route errors/warnings through the error pipeline too
        if level in ("error", "warn"):
            bus.error_occurred.emit(title, message, level)
```

- [ ] **Step 2: Commit**

```bash
git add src/backend/client.py
git commit -m "feat(rustclient): route Rust error-level push events through error pipeline"
```

---

### Task 6: Final integration verification

- [ ] **Step 1: Run full test suite**

```bash
cargo test -p hyperclip-ipc
python -m pytest tests/ -v 2>&1 | head -50
```

- [ ] **Step 2: Manual smoke test**

```bash
python src/main.py
```

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix: post-integration fixes"
```
