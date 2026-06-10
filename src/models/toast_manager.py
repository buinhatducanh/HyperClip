"""ToastManager — exposes showToast() slot to QML, hooked to EventBus."""
from PySide6.QtCore import QObject, Signal, Slot, Property
from datetime import datetime
from typing import Optional


class ToastManager(QObject):
    toastRequested = Signal(str, str, str)  # title, message, level

    def __init__(self, parent=None):
        super().__init__(parent)
        self._sound_enabled: bool = True
        self._last_sound_at: float = 0.0  # throttle same-level sounds

    @Slot(str, str, str)
    def showToast(self, title: str, message: str, level: str = "info"):
        self.toastRequested.emit(title, message, level or "info")

    @Slot(str, str, str, result=bool)
    def notifyFromAction(self, type_: str, message: str, level: str = "info") -> bool:
        """Map action type to friendly toast title."""
        title_map = {
            "channel": "Kênh",
            "ws": "Video",
            "download": "Tải xuống",
            "render": "Render",
            "storage": "Bộ nhớ",
            "system": "Hệ thống",
            "auto": "Tự động",
            "edit": "Chỉnh sửa",
            "session": "Session",
            "key": "API key",
        }
        title = title_map.get(type_, "HyperClip")
        self.toastRequested.emit(title, message, level or "info")
        return True

    @Property(bool, notify=toastRequested)
    def soundEnabled(self): return self._sound_enabled

    @soundEnabled.setter
    def soundEnabled(self, v: bool): self._sound_enabled = bool(v)
