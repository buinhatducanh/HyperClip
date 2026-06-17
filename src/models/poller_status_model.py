"""PollerStatusModel — active state + last poll + error + detection metrics."""
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
        self._last_detection_latency_ms: int = 0
        self._detections_today: int = 0
        self._average_latency_ms: float = 0.0
        self._sla_percent: float = 100.0

    def load_from_dict(self, d: dict):
        self._active = bool(d.get("active", False))
        self._poll_interval_ms = int(d.get("pollIntervalMs", 5000))
        self._last_poll_at = int(d.get("lastPollAt") or 0)
        self._new_video_count = int(d.get("newVideoCount", 0))
        self._last_error = d.get("lastError") or ""
        self._innertube_degraded = bool(d.get("innertubeDegraded", False))
        self._last_detection_latency_ms = int(d.get("lastDetectionLatencyMs", 0))
        self._detections_today = int(d.get("detectionsToday", 0))
        self._average_latency_ms = float(d.get("averageLatencyMs", 0.0))
        self._sla_percent = float(d.get("slaPercent", 100.0))
        self.changed.emit()

    @Slot('QVariant')
    def refresh_from_backend(self, backend):
        if not backend:
            return
        resp = backend.send_command("poller:status")
        result = resp.get("result", {})
        if result:
            self.load_from_dict(result)

    @Slot('QVariant')
    def resume(self, backend):
        if not backend:
            return
        backend.send_command("poller:resume")

    @Slot('QVariant')
    def pause(self, backend):
        if not backend:
            return
        backend.send_command("poller:stop")

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

    # --- Detection latency ---
    @Property(int, notify=changed)
    def lastDetectionLatencyMs(self): return self._last_detection_latency_ms

    @Property(str, notify=changed)
    def lastDetectionLatencyStr(self):
        ms = self._last_detection_latency_ms
        if ms <= 0:
            return "—"
        if ms < 1000:
            return f"~{ms}ms"
        return f"~{ms / 1000:.1f}s"

    @Property(int, notify=changed)
    def detectionsToday(self): return self._detections_today

    @Property(float, notify=changed)
    def averageLatencyMs(self): return self._average_latency_ms

    @Property(str, notify=changed)
    def averageLatencyStr(self):
        ms = self._average_latency_ms
        if ms <= 0:
            return "—"
        if ms < 1000:
            return f"~{ms:.0f}ms"
        return f"~{ms / 1000:.1f}s"

    @Property(float, notify=changed)
    def slaPercent(self): return self._sla_percent

    @Property(str, notify=changed)
    def slaColor(self):
        pct = self._sla_percent
        if pct >= 95:
            return "#00FF88"
        if pct >= 80:
            return "#FFD93D"
        return "#FF4444"

    @Property(str, notify=changed)
    def latencyColor(self):
        ms = self._last_detection_latency_ms
        if ms <= 0 or ms < 5000:
            return "#00FF88"
        if ms < 10000:
            return "#FFD93D"
        return "#FF4444"

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
