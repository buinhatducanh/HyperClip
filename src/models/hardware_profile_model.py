"""HardwareProfileModel — detected GPU + selectable preset."""
from PySide6.QtCore import QObject, Signal, Slot, Property


class HardwareProfileModel(QObject):
    changed = Signal()

    PRESETS = [
        {"id": "ultra", "label": "Ultra", "vramGB": 16, "ramGB": 64, "sessions": 30, "renderWorkers": 6, "chunkWorkers": 14, "downloadInstances": 6},
        {"id": "high", "label": "High", "vramGB": 12, "ramGB": 48, "sessions": 8, "renderWorkers": 3, "chunkWorkers": 6, "downloadInstances": 2},
        {"id": "medium", "label": "Medium", "vramGB": 8, "ramGB": 32, "sessions": 6, "renderWorkers": 2, "chunkWorkers": 4, "downloadInstances": 2},
        {"id": "low", "label": "Low", "vramGB": 6, "ramGB": 24, "sessions": 4, "renderWorkers": 2, "chunkWorkers": 2, "downloadInstances": 1},
        {"id": "minimal", "label": "Minimal", "vramGB": 4, "ramGB": 16, "sessions": 2, "renderWorkers": 1, "chunkWorkers": 1, "downloadInstances": 1},
    ]

    def __init__(self, parent=None):
        super().__init__(parent)
        self._detected_vram: int = 0
        self._detected_ram: int = 0
        self._detected_gpu: str = "—"
        self._active_id: str = ""
        self._is_busy: bool = False

    def load_from_dict(self, d: dict):
        det = d.get("detected", {})
        self._detected_vram = int(det.get("vramGB", 0))
        self._detected_ram = int(det.get("ramGB", 0))
        self._detected_gpu = det.get("gpuName", "—")
        self._active_id = d.get("active") or ""
        self._is_busy = False
        self.changed.emit()

    def active_preset(self) -> dict | None:
        for p in self.PRESETS:
            if p["id"] == self._active_id:
                return p
        return None

    @Property(int, notify=changed)
    def detectedVramGb(self): return self._detected_vram
    @Property(int, notify=changed)
    def detectedRamGb(self): return self._detected_ram
    @Property(str, notify=changed)
    def detectedGpuName(self): return self._detected_gpu
    @Property(str, notify=changed)
    def activeId(self): return self._active_id
    @Property(str, notify=changed)
    def activeLabel(self):
        for p in self.PRESETS:
            if p["id"] == self._active_id:
                return p["label"]
        return "Auto"
    @Property(bool, notify=changed)
    def isBusy(self): return self._is_busy

    @Slot(result="QVariantList")
    def presets(self):
        return self.PRESETS

    @Slot(QObject, QObject, str, result=bool)
    def select_preset(self, backend, settings_model, preset_id: str):
        if not backend:
            return False
        preset = next((p for p in self.PRESETS if p["id"] == preset_id), None)
        if not preset:
            return False
        self._is_busy = True
        self.changed.emit()
        try:
            profile = {"vramGB": preset["vramGB"], "ramGB": preset["ramGB"]}
            resp = backend.send_command("settings:update", {"hardwareProfile": profile})
            if resp.get("ok"):
                self._active_id = preset_id
                self.changed.emit()
                self.refresh_from_backend(backend)
                if settings_model:
                    settings_model.load_from_backend(backend)
                return True
            return False
        finally:
            self._is_busy = False
            self.changed.emit()

    @Slot(QObject)
    def refresh_from_backend(self, backend):
        if not backend:
            return
        self._is_busy = True
        self.changed.emit()
        try:
            resp = backend.send_command("hardware:profile")
            result = resp.get("result", {})
            if result:
                self.load_from_dict(result)
        finally:
            self._is_busy = False
            self.changed.emit()
