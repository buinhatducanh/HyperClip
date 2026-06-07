"""SettingsModel — exposes 28 AppSettings fields to QML."""
from PySide6.QtCore import QObject, Signal, Slot, Property


class SettingsModel(QObject):
    changed = Signal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self._output_folder: str = "C:/HyperClip-Data"
        self._video_storage_path: str = "C:/HyperClip-Data/videos"
        self._output_path: str = "C:/HyperClip-Data/output"
        self._default_trim_limit: int = 10
        self._default_quality: int = 1080
        self._auto_download_quality: str = "1080"
        self._auto_download_enabled: bool = True
        self._polling_enabled: bool = False
        self._auto_render: bool = True
        self._auto_render_resolution: str = "1080p"
        self._auto_render_fps: int = 30
        self._auto_render_speed: float = 1.0
        self._auto_split_parts: int = 1
        self._auto_split_minutes: int = 0
        self._auto_render_title_template: str = "{title}"
        self._downloads_cleanup_days: int = 7
        self._max_concurrent_renders: int = 2
        self._proxy_enabled: bool = False
        self._proxy_host: str = ""
        self._proxy_port: int = 0
        self._proxy_username: str = ""
        self._proxy_password: str = ""
        self._max_concurrent_downloads: int = 1
        self._video_min_duration_sec: int = 60
        self._video_max_duration_sec: int = 3600
        self._minimize_to_tray: bool = True
        self._quit_on_close: bool = False
        self._poll_interval_ms: int = 5000
        self._onboarding_complete: bool = False
        self._hardware_vram_gb: int = 0
        self._hardware_ram_gb: int = 0

    def load_from_dict(self, d: dict):
        """Load settings from a dict (typically from backend)."""
        m = {
            "outputFolder": ("_output_folder", str),
            "videoStoragePath": ("_video_storage_path", str),
            "outputPath": ("_output_path", str),
            "defaultTrimLimit": ("_default_trim_limit", lambda v: int(v) if v != "full" else 999),
            "defaultQuality": ("_default_quality", int),
            "autoDownloadQuality": ("_auto_download_quality", str),
            "autoDownloadEnabled": ("_auto_download_enabled", bool),
            "pollingEnabled": ("_polling_enabled", bool),
            "autoRender": ("_auto_render", bool),
            "autoRenderResolution": ("_auto_render_resolution", str),
            "autoRenderFPS": ("_auto_render_fps", int),
            "autoRenderSpeed": ("_auto_render_speed", float),
            "autoSplitParts": ("_auto_split_parts", int),
            "autoSplitMinutes": ("_auto_split_minutes", int),
            "autoRenderTitleTemplate": ("_auto_render_title_template", str),
            "downloadsCleanupDays": ("_downloads_cleanup_days", int),
            "maxConcurrentRenders": ("_max_concurrent_renders", int),
            "proxyEnabled": ("_proxy_enabled", bool),
            "proxyHost": ("_proxy_host", str),
            "proxyPort": ("_proxy_port", int),
            "proxyUsername": ("_proxy_username", str),
            "proxyPassword": ("_proxy_password", str),
            "maxConcurrentDownloads": ("_max_concurrent_downloads", int),
            "videoMinDurationSec": ("_video_min_duration_sec", int),
            "videoMaxDurationSec": ("_video_max_duration_sec", int),
            "minimizeToTray": ("_minimize_to_tray", bool),
            "quitOnClose": ("_quit_on_close", bool),
            "pollIntervalMs": ("_poll_interval_ms", int),
            "onboardingComplete": ("_onboarding_complete", bool),
        }
        for k, (attr, cast) in m.items():
            if k in d:
                setattr(self, attr, cast(d[k]))
        if "hardwareProfile" in d and d["hardwareProfile"]:
            p = d["hardwareProfile"]
            self._hardware_vram_gb = int(p.get("vramGB", 0))
            self._hardware_ram_gb = int(p.get("ramGB", 0))
        self.changed.emit()

    def to_dict(self) -> dict:
        return {
            "outputFolder": self._output_folder,
            "videoStoragePath": self._video_storage_path,
            "outputPath": self._output_path,
            "defaultTrimLimit": self._default_trim_limit,
            "defaultQuality": self._default_quality,
            "autoDownloadQuality": self._auto_download_quality,
            "autoDownloadEnabled": self._auto_download_enabled,
            "pollingEnabled": self._polling_enabled,
            "autoRender": self._auto_render,
            "autoRenderResolution": self._auto_render_resolution,
            "autoRenderFPS": self._auto_render_fps,
            "autoRenderSpeed": self._auto_render_speed,
            "autoSplitParts": self._auto_split_parts,
            "autoSplitMinutes": self._auto_split_minutes,
            "autoRenderTitleTemplate": self._auto_render_title_template,
            "downloadsCleanupDays": self._downloads_cleanup_days,
            "maxConcurrentRenders": self._max_concurrent_renders,
            "proxyEnabled": self._proxy_enabled,
            "proxyHost": self._proxy_host,
            "proxyPort": self._proxy_port,
            "proxyUsername": self._proxy_username,
            "proxyPassword": self._proxy_password,
            "maxConcurrentDownloads": self._max_concurrent_downloads,
            "videoMinDurationSec": self._video_min_duration_sec,
            "videoMaxDurationSec": self._video_max_duration_sec,
            "minimizeToTray": self._minimize_to_tray,
            "quitOnClose": self._quit_on_close,
            "pollIntervalMs": self._poll_interval_ms,
            "onboardingComplete": self._onboarding_complete,
            "hardwareProfile": {"vramGB": self._hardware_vram_gb, "ramGB": self._hardware_ram_gb} if self._hardware_vram_gb else None,
        }

    @Slot(result=bool)
    def save_to_backend(self, backend) -> bool:
        if not backend:
            return False
        resp = backend.send_command("settings:update", self.to_dict())
        return resp.get("ok", False)

    @Slot(result=bool)
    def load_from_backend(self, backend) -> bool:
        if not backend:
            return False
        resp = backend.send_command("settings:get")
        result = resp.get("result", {})
        if result:
            self.load_from_dict(result)
            return True
        return False


# ─── Property bindings — added after class definition ──────────────────────
def _prop(name, cast):
    # Map camelCase property name to snake_case private attribute.
    private = "_" + name[0].lower() + "".join(c if c.islower() else "_" + c.lower() for c in name[1:])
    def getter(self):
        return getattr(self, private)
    def setter(self, v):
        if getattr(self, private) != cast(v):
            setattr(self, private, cast(v))
            self.changed.emit()
    return Property(cast, getter, setter, notify=SettingsModel.changed)


_FIELDS = [
    ("outputFolder", str), ("videoStoragePath", str), ("outputPath", str),
    ("defaultTrimLimit", int), ("defaultQuality", int), ("autoDownloadQuality", str),
    ("autoDownloadEnabled", bool), ("pollingEnabled", bool), ("autoRender", bool),
    ("autoRenderResolution", str), ("autoRenderFPS", int), ("autoRenderSpeed", float),
    ("autoSplitParts", int), ("autoSplitMinutes", int), ("autoRenderTitleTemplate", str),
    ("downloadsCleanupDays", int), ("maxConcurrentRenders", int),
    ("proxyEnabled", bool), ("proxyHost", str), ("proxyPort", int),
    ("proxyUsername", str), ("proxyPassword", str),
    ("maxConcurrentDownloads", int), ("videoMinDurationSec", int), ("videoMaxDurationSec", int),
    ("minimizeToTray", bool), ("quitOnClose", bool),
    ("pollIntervalMs", int), ("onboardingComplete", bool),
    ("hardwareVramGb", int), ("hardwareRamGb", int),
]

for _name, _cast in _FIELDS:
    if not hasattr(SettingsModel, _name):
        setattr(SettingsModel, _name, _prop(_name, _cast))
