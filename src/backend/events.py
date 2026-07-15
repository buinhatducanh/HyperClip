# src/backend/events.py
from PySide6.QtCore import QObject, Signal
from typing import Optional

class EventBus(QObject):
    workspace_updated = Signal(dict)
    render_progress = Signal(str, float)
    system_stats_updated = Signal(dict)
    notification = Signal(str, str)
    new_video_detected = Signal(dict)
    premiere_scheduled = Signal(dict)
    poller_status_changed = Signal(dict)
    channel_synced = Signal()
    download_progress = Signal(str, float, float, float)  # workspace_id, percent, speed_mbps, eta_sec

_event_bus: Optional[EventBus] = None
_keepalive_refs: list = []


def get_event_bus() -> EventBus:
    global _event_bus
    if _event_bus is None:
        _event_bus = EventBus()
        # Pin to module-level list to prevent Python GC from collecting C++ object
        _keepalive_refs.append(_event_bus)
    return _event_bus
