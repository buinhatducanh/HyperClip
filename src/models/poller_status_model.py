"""PollerStatusModel — active state + last poll + error."""
from PySide6.QtCore import QObject, Signal, Slot, Property
import time


class PollerStatusModel(QObject):
    changed = Signal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self._active: bool = False
        self._poll_interval_ms: int = 5000
        self._last_poll_at: int = 0
        self._new_video_count: int = 0
        self._last_error: str = ""
        self._innertube_degraded: bool = False

    def load_from_dict(self, d: dict):
        self._active = bool(d.get("active", False))
        self._poll_interval_ms = int(d.get("pollIntervalMs", 5000))
        self._last_poll_at = int(d.get("lastPollAt") or 0)
        self._new_video_count = int(d.get("newVideoCount", 0))
        self._last_error = d.get("lastError") or ""
        self._innertube_degraded = bool(d.get("innertubeDegraded", False))
        self.changed.emit()

    @Slot()
    def refresh_from_backend(self, backend):
        if not backend:
            return
        resp = backend.send_command("poller:status")
        result = resp.get("result", {})
        if result:
            self.load_from_dict(result)

    @Slot()
    def resume(self, backend):
        if not backend:
            return
        backend.send_command("poller:resume")

    @Property(bool, notify=changed)
    def active(self): return self._active
    @Property(int, notify=changed)
    def pollIntervalMs(self): return self._poll_interval_ms
    @Property(int, notify=changed)
    def newVideoCount(self): return self._new_video_count
    @Property(str, notify=changed)
    def lastError(self): return self._last_error
    @Property(bool, notify=changed)
    def innertubeDegraded(self): return self._innertube_degraded

    @Property(str, notify=changed)
    def lastPollLabel(self):
        if not self._last_poll_at:
            return "Never"
        diff = int(time.time()) - (self._last_poll_at // 1000)
        if diff < 60:
            return f"{diff}s ago"
        if diff < 3600:
            return f"{diff // 60}m ago"
        return f"{diff // 3600}h ago"
