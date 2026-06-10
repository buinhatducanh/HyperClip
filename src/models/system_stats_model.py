# src/models/system_stats_model.py
from PySide6.QtCore import QObject, Signal, Slot, Property


class SystemStatsModel(QObject):
    statsChanged = Signal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self._gpu_name: str = "—"
        self._gpu_tier: str = "software"
        self._gpu_temp: int = 0
        self._gpu_usage: int = 0
        self._ram_used: int = 0
        self._ram_total: int = 0
        self._max_workers: int = 0
        self._active_workers: int = 0
        self._is_online: bool = True
        self._network_ip: str = "127.0.0.1"
        self._vram_total_gb: int = 0

    def update_from_dict(self, d: dict):
        if "gpu_name" in d: self._gpu_name = d["gpu_name"]
        if "gpu_tier" in d: self._gpu_tier = d["gpu_tier"]
        if "gpu_temp" in d: self._gpu_temp = int(d["gpu_temp"])
        if "gpu_usage" in d: self._gpu_usage = int(d["gpu_usage"])
        if "ram_used" in d: self._ram_used = int(d["ram_used"])
        if "ram_total" in d: self._ram_total = int(d["ram_total"])
        if "max_workers" in d: self._max_workers = int(d["max_workers"])
        if "active_workers" in d: self._active_workers = int(d["active_workers"])
        if "is_online" in d: self._is_online = bool(d["is_online"])
        if "network_ip" in d: self._network_ip = d["network_ip"]
        if "vram_total_gb" in d: self._vram_total_gb = int(d["vram_total_gb"])
        self.statsChanged.emit()

    @Property(str, notify=statsChanged)
    def gpu_name(self) -> str: return self._gpu_name

    @Property(str, notify=statsChanged)
    def gpu_tier(self) -> str: return self._gpu_tier

    @Property(int, notify=statsChanged)
    def gpu_temp(self) -> int: return self._gpu_temp

    @Property(int, notify=statsChanged)
    def gpu_usage(self) -> int: return self._gpu_usage

    @Property(int, notify=statsChanged)
    def ram_used(self) -> int: return self._ram_used

    @Property(int, notify=statsChanged)
    def ram_total(self) -> int: return self._ram_total

    @Property(int, notify=statsChanged)
    def max_workers(self) -> int: return self._max_workers

    @Property(int, notify=statsChanged)
    def active_workers(self) -> int: return self._active_workers

    @Property(bool, notify=statsChanged)
    def is_online(self) -> bool: return self._is_online

    @Property(str, notify=statsChanged)
    def network_ip(self) -> str: return self._network_ip

    @Property(int, notify=statsChanged)
    def vram_total_gb(self) -> int: return self._vram_total_gb

    @Property(str, notify=statsChanged)
    def ram_label(self) -> str:
        if not self._ram_total:
            return "—"
        used = round(self._ram_used / 1024 / 1024 / 1024)
        total = round(self._ram_total / 1024 / 1024 / 1024)
        return f"{used}GB / {total}GB"
