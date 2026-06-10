"""SettingsModel — exposes AppSettings fields to QML via explicit Properties."""
from PySide6.QtCore import QObject, Signal, Slot, Property
from src.data_dir import get_data_dir


class SettingsModel(QObject):
    changed = Signal()

    def __init__(self, parent=None):
        super().__init__(parent)
        base = get_data_dir()
        self._output_folder: str = base
        self._video_storage_path: str = base
        self._output_path: str = base
        self._default_trim_limit: int = 10
        self._default_quality: int = 1080
        self._auto_download_quality: str = "1080"
        self._auto_download_max_age_minutes: int = 1440
        self._auto_download_enabled: bool = True
        self._polling_enabled: bool = True
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

    # ─── Explicit Properties (PySide6 requires class-level descriptor) ──
    outputFolder = Property(str, lambda s: s._output_folder, lambda s, v: s._set("_output_folder", str, v), notify=changed)
    videoStoragePath = Property(str, lambda s: s._video_storage_path, lambda s, v: s._set("_video_storage_path", str, v), notify=changed)
    outputPath = Property(str, lambda s: s._output_path, lambda s, v: s._set("_output_path", str, v), notify=changed)
    defaultTrimLimit = Property(int, lambda s: s._default_trim_limit, lambda s, v: s._set("_default_trim_limit", int, v), notify=changed)
    defaultQuality = Property(int, lambda s: s._default_quality, lambda s, v: s._set("_default_quality", int, v), notify=changed)
    autoDownloadQuality = Property(str, lambda s: s._auto_download_quality, lambda s, v: s._set("_auto_download_quality", str, v), notify=changed)
    autoDownloadMaxAgeMinutes = Property(int, lambda s: s._auto_download_max_age_minutes, lambda s, v: s._set("_auto_download_max_age_minutes", int, v), notify=changed)
    autoDownloadEnabled = Property(bool, lambda s: s._auto_download_enabled, lambda s, v: s._set("_auto_download_enabled", bool, v), notify=changed)
    pollingEnabled = Property(bool, lambda s: s._polling_enabled, lambda s, v: s._set("_polling_enabled", bool, v), notify=changed)
    autoRender = Property(bool, lambda s: s._auto_render, lambda s, v: s._set("_auto_render", bool, v), notify=changed)
    autoRenderResolution = Property(str, lambda s: s._auto_render_resolution, lambda s, v: s._set("_auto_render_resolution", str, v), notify=changed)
    autoRenderFPS = Property(int, lambda s: s._auto_render_fps, lambda s, v: s._set("_auto_render_fps", int, v), notify=changed)
    autoRenderSpeed = Property(float, lambda s: s._auto_render_speed, lambda s, v: s._set("_auto_render_speed", float, v), notify=changed)
    autoSplitParts = Property(int, lambda s: s._auto_split_parts, lambda s, v: s._set("_auto_split_parts", int, v), notify=changed)
    autoSplitMinutes = Property(int, lambda s: s._auto_split_minutes, lambda s, v: s._set("_auto_split_minutes", int, v), notify=changed)
    autoRenderTitleTemplate = Property(str, lambda s: s._auto_render_title_template, lambda s, v: s._set("_auto_render_title_template", str, v), notify=changed)
    downloadsCleanupDays = Property(int, lambda s: s._downloads_cleanup_days, lambda s, v: s._set("_downloads_cleanup_days", int, v), notify=changed)
    maxConcurrentRenders = Property(int, lambda s: s._max_concurrent_renders, lambda s, v: s._set("_max_concurrent_renders", int, v), notify=changed)
    proxyEnabled = Property(bool, lambda s: s._proxy_enabled, lambda s, v: s._set("_proxy_enabled", bool, v), notify=changed)
    proxyHost = Property(str, lambda s: s._proxy_host, lambda s, v: s._set("_proxy_host", str, v), notify=changed)
    proxyPort = Property(int, lambda s: s._proxy_port, lambda s, v: s._set("_proxy_port", int, v), notify=changed)
    proxyUsername = Property(str, lambda s: s._proxy_username, lambda s, v: s._set("_proxy_username", str, v), notify=changed)
    proxyPassword = Property(str, lambda s: s._proxy_password, lambda s, v: s._set("_proxy_password", str, v), notify=changed)
    maxConcurrentDownloads = Property(int, lambda s: s._max_concurrent_downloads, lambda s, v: s._set("_max_concurrent_downloads", int, v), notify=changed)
    videoMinDurationSec = Property(int, lambda s: s._video_min_duration_sec, lambda s, v: s._set("_video_min_duration_sec", int, v), notify=changed)
    videoMaxDurationSec = Property(int, lambda s: s._video_max_duration_sec, lambda s, v: s._set("_video_max_duration_sec", int, v), notify=changed)
    minimizeToTray = Property(bool, lambda s: s._minimize_to_tray, lambda s, v: s._set("_minimize_to_tray", bool, v), notify=changed)
    quitOnClose = Property(bool, lambda s: s._quit_on_close, lambda s, v: s._set("_quit_on_close", bool, v), notify=changed)
    pollIntervalMs = Property(int, lambda s: s._poll_interval_ms, lambda s, v: s._set("_poll_interval_ms", int, v), notify=changed)
    onboardingComplete = Property(bool, lambda s: s._onboarding_complete, lambda s, v: s._set("_onboarding_complete", bool, v), notify=changed)
    hardwareVramGb = Property(int, lambda s: s._hardware_vram_gb, lambda s, v: s._set("_hardware_vram_gb", int, v), notify=changed)
    hardwareRamGb = Property(int, lambda s: s._hardware_ram_gb, lambda s, v: s._set("_hardware_ram_gb", int, v), notify=changed)

    # ─── Helpers ────────────────────────────────────────────────────────
    def _set(self, attr, cast, value):
        if getattr(self, attr) != cast(value):
            setattr(self, attr, cast(value))
            self.changed.emit()

    def load_from_dict(self, d: dict):
        """Load settings from a dict (typically from backend)."""
        m = {
            "outputFolder": "_output_folder",
            "videoStoragePath": "_video_storage_path",
            "outputPath": "_output_path",
            "defaultTrimLimit": "_default_trim_limit",
            "defaultQuality": "_default_quality",
            "autoDownloadQuality": "_auto_download_quality",
            "autoDownloadMaxAgeMinutes": "_auto_download_max_age_minutes",
            "autoDownloadEnabled": "_auto_download_enabled",
            "pollingEnabled": "_polling_enabled",
            "autoRender": "_auto_render",
            "autoRenderResolution": "_auto_render_resolution",
            "autoRenderFPS": "_auto_render_fps",
            "autoRenderSpeed": "_auto_render_speed",
            "autoSplitParts": "_auto_split_parts",
            "autoSplitMinutes": "_auto_split_minutes",
            "autoRenderTitleTemplate": "_auto_render_title_template",
            "downloadsCleanupDays": "_downloads_cleanup_days",
            "maxConcurrentRenders": "_max_concurrent_renders",
            "proxyEnabled": "_proxy_enabled",
            "proxyHost": "_proxy_host",
            "proxyPort": "_proxy_port",
            "proxyUsername": "_proxy_username",
            "proxyPassword": "_proxy_password",
            "maxConcurrentDownloads": "_max_concurrent_downloads",
            "videoMinDurationSec": "_video_min_duration_sec",
            "videoMaxDurationSec": "_video_max_duration_sec",
            "minimizeToTray": "_minimize_to_tray",
            "quitOnClose": "_quit_on_close",
            "pollIntervalMs": "_poll_interval_ms",
            "onboardingComplete": "_onboarding_complete",
        }
        for k, attr in m.items():
            if k in d:
                setattr(self, attr, d[k])
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
            "autoDownloadMaxAgeMinutes": self._auto_download_max_age_minutes,
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
