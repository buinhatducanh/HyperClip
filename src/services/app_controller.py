# src/services/app_controller.py
import sys
from PySide6.QtCore import QObject, QTimer

from src.models.workspace_model import WorkspaceModel
from src.models.system_stats_model import SystemStatsModel
from src.models.settings_model import SettingsModel
from src.models.activity_log_model import ActivityLogModel
from src.models.hardware_profile_model import HardwareProfileModel
from src.models.poller_status_model import PollerStatusModel
from src.models.auth_status_model import AuthStatusModel
from src.models.channel_list_model import ChannelListModel
from src.models.session_list_model import SessionListModel
from src.models.project_list_model import ProjectListModel
from src.models.key_list_model import KeyListModel
from src.models.rendered_video_list_model import RenderedVideoListModel
from src.models.detection_history_model import DetectionHistoryModel
from src.models.log_file_model import LogFileModel, LogFilesListModel
from src.services.video_player import VideoPlayer
from src.services.thumbnail_qobject import ThumbnailService
from src.services.toast_service import get_toast_service
from src.services.sound_service import SoundService


class AppController(QObject):
    def __init__(self, client, bus, parent=None):
        super().__init__(parent)
        self.client = client
        self.bus = bus

        # Instantiate models
        self.channel_list_model = ChannelListModel()
        self.workspace_model = WorkspaceModel()
        self.stats_model = SystemStatsModel()
        self.settings_model = SettingsModel()
        self.activity_model = ActivityLogModel()
        self.hw_profile_model = HardwareProfileModel()
        self.poller_model = PollerStatusModel()
        self.auth_model = AuthStatusModel()
        self.session_model = SessionListModel()
        self.project_model = ProjectListModel()
        self.key_model = KeyListModel()
        self.rendered_model = RenderedVideoListModel()
        self.detection_history_model = DetectionHistoryModel()
        self.log_files_model = LogFilesListModel(backend=client)
        self.log_file_model = LogFileModel(backend=client)
        self.video_player = VideoPlayer()
        self.thumbnail_service = ThumbnailService()
        self.toast_service = get_toast_service()
        self.sound_service = SoundService(self)

        # Timers
        self.stats_timer = None
        self.poller_timer = None

    def initialize_and_wire(self):
        # 1. Load channels immediately (channel:synced fired before bus connected)
        self.channel_list_model.load_from_backend(self.client)

        # 2. Event bus wiring
        self.bus.workspace_updated.connect(self._on_workspace_updated)
        self.bus.render_progress.connect(self._on_render_progress)
        self.bus.download_progress.connect(self._on_download_progress)
        self.bus.system_stats_updated.connect(self._on_system_stats_updated)
        self.bus.new_video_detected.connect(self._on_new_video_detected)
        self.bus.channel_synced.connect(self._on_channel_synced)
        self.bus.notification.connect(self._on_notification)
        self.settings_model.saved.connect(self._on_settings_saved)

        # 3. Setup and start timers
        self.stats_timer = QTimer(self)
        self.stats_timer.setInterval(5000)
        self.stats_timer.timeout.connect(self._poll_stats)
        self.stats_timer.start()

        self.poller_timer = QTimer(self)
        self.poller_timer.setInterval(15000)
        self.poller_timer.timeout.connect(self._poll_poller)
        self.poller_timer.start()

        # 4. Auto-start poller check (single-shot after 1s)
        QTimer.singleShot(1000, self._auto_start_poller)

    def _on_workspace_updated(self, d):
        # Update field or workspace
        if d.get("field"):
            self.workspace_model.update_field(
                d.get("id", ""), d.get("field", ""), d.get("value"),
                client=None,  # avoid echo loop
            )
        else:
            self.workspace_model.update_workspace(d.get("id", ""), d)

        # Track download status changes for detection history
        if not d.get("field"):
            ws_id = d.get("id", "")
            status = d.get("status", "")
            title = d.get("title", "") or ws_id

            if not hasattr(self, "_last_logged_ws_status"):
                self._last_logged_ws_status = {}

            last_status = self._last_logged_ws_status.get(ws_id)
            if status and status != last_status:
                self._last_logged_ws_status[ws_id] = status
                if "-part" in ws_id and status in ("downloading", "ready"):
                    pass
                else:
                    if status == "downloading":
                        self.activity_model.add_entry("download", f"Bắt đầu tải video: {title}", "info")
                    elif status == "ready":
                        self.activity_model.add_entry("download", f"Đã tải xong video: {title}", "info")
                        self.sound_service.play("success")
                    elif status == "rendering":
                        self.activity_model.add_entry("render", f"Bắt đầu render video: {title}", "info")
                    elif status == "done":
                        self.activity_model.add_entry("render", f"Đã render xong video: {title}", "info")
                        self.sound_service.play("success")
                    elif status == "error":
                        self.activity_model.add_entry("system", f"Lỗi xử lý video {title}: {d.get('error', 'Lỗi không xác định')}", "error")
                        self.sound_service.play("error")

            self.detection_history_model.update_download_status(ws_id, status)
            
            # Track download completion results
            if status == "ready" and d.get("downloadedSize"):
                self.detection_history_model.update_download_result(
                    ws_id, d.get("downloadedSize", 0),
                    d.get("width", 0), d.get("height", 0),
                )
            
            # Auto-split after download if enabled
            self._maybe_auto_split(d)

    def _maybe_auto_split(self, d):
        if d.get("field") or d.get("status") != "ready":
            return
        ws_id = d.get("id", "")
        if not ws_id or "-part" in ws_id:
            return

        self.settings_model.load_from_backend(self.client)
        if not self.settings_model.autoSplitEnabled:
            return

        mode = self.settings_model.autoSplitMode
        parts = self.settings_model.autoSplitParts
        minutes = self.settings_model.autoSplitMinutes
        duration = d.get("durationSec", 600)

        should_split = False
        if mode == "parts" and parts > 1:
            should_split = True
        elif mode == "minutes" and minutes > 0 and duration > (minutes * 60):
            should_split = True

        if not should_split:
            return

        auto_render = self.settings_model.autoRender
        render_res = self.settings_model.autoRenderResolution
        render_fps = self.settings_model.autoRenderFPS
        render_speed = self.settings_model.autoRenderSpeed

        split_parts = []
        if mode == "minutes":
            # Split into segments of fixed length (minutes * 60), last one holds the remainder
            part_sec = minutes * 60
            start = 0.0
            while start < duration:
                end = min(start + part_sec, duration)
                split_parts.append({"start": start, "end": end})
                start = end
        else:
            # Split into equal parts
            part_sec = duration / parts
            for i in range(parts):
                start = i * part_sec
                end = min((i + 1) * part_sec, duration)
                split_parts.append({"start": start, "end": end})

        self.client.send_command("workspace:split", {
            "id": ws_id,
            "autoRender": auto_render,
            "renderResolution": render_res,
            "renderFPS": render_fps,
            "renderSpeed": render_speed,
            "parts": split_parts
        })

    def _on_render_progress(self, ws_id, prog):
        self.workspace_model.set_progress(ws_id, prog * 100.0)

    def _on_download_progress(self, ws_id, pct, speed, eta):
        # Convert pct from 0.0-1.0 range to 0.0-100.0 range
        pct_percent = pct * 100.0

        # Update progress with speed and eta for visual loading bar
        self.workspace_model.set_download_progress(ws_id, pct_percent, speed, eta)

    def _on_system_stats_updated(self, d):
        self.stats_model.update_from_dict(d)

    def _on_new_video_detected(self, d):
        self.workspace_model.add_workspace({
            "id": d.get("id", ""),
            "status": d.get("status", "waiting"),
            "title": d.get("title", ""),
            "progress": 0.0,
            "channelId": d.get("channelId", "") or d.get("channel_id", ""),
            "channel_name": d.get("channelName", "") or d.get("channel_id", ""),
            "thumbnail": d.get("thumbnailUrl", "") or d.get("thumbnail", ""),
            "created_at": d.get("detectedAt", 0) or d.get("detected_at", 0),
            "published_at": d.get("publishedAt", 0) or d.get("published_at", 0),
            "durationSec": d.get("durationSec", 0) or d.get("duration_sec", 0),
            "quality": 360,
            "speed": 1.0,
            "isShort": True,
        })
        self.activity_model.add_entry("auto", f"New video: {d.get('title', '?')}", "info")
        self.detection_history_model.add_detection(
            d.get("id", ""),
            d.get("videoId", ""),
            d.get("title", ""),
            d.get("channelName", ""),
            d.get("publishedAt", 0),
            d.get("detectedAt", 0),
            d.get("durationSec", 0.0),
            d.get("status", "waiting"),
        )
        self.sound_service.play("info")

    def _on_channel_synced(self):
        self.workspace_model.load_from_backend(self.client)
        self.channel_list_model.load_from_backend(self.client)
        self.settings_model.load_from_backend(self.client)
        self.hw_profile_model.refresh_from_backend(self.client)
        self.poller_model.refresh_from_backend(self.client)
        self.auth_model.refresh_from_backend(self.client)
        self.rendered_model.load_from_backend(self.client)
        self.session_model.load_from_backend(self.client)
        self.project_model.load_from_backend(self.client)
        self.key_model.load_from_backend(self.client)

    def _on_notification(self, title, message):
        self.activity_model.add_entry("system", f"{title}: {message}", "info")
        # Display visual toast notification
        level = "error" if "error" in title.lower() or "fail" in title.lower() else "info"
        self.toast_service.show(title, message, level)
        self.sound_service.play(level)

    def _poll_stats(self):
        if self.client:
            self.client.send_command_async("system:stats")

    def _poll_poller(self):
        if self.client:
            self.poller_model.refresh_from_backend(self.client)
            self.auth_model.refresh_from_backend(self.client)

    def _on_settings_saved(self):
        if self.client:
            self.poller_model.refresh_from_backend(self.client)
            self.auth_model.refresh_from_backend(self.client)

    def _auto_start_poller(self):
        if self.client:
            self.settings_model.load_from_backend(self.client)
            self.workspace_model.load_from_backend(self.client)
            self.channel_list_model.load_from_backend(self.client)
            self.hw_profile_model.refresh_from_backend(self.client)
            self.session_model.load_from_backend(self.client)
            self.project_model.load_from_backend(self.client)
            self.key_model.load_from_backend(self.client)
            self.detection_history_model.load_from_disk(self.workspace_model)

            if self.settings_model.pollingEnabled:
                self.client.send_command_async("poller:start")
                sys.stderr.write("[main] Poller auto-started\n")
            else:
                sys.stderr.write("[main] Polling disabled in settings, skipping auto-start\n")
            sys.stderr.flush()

            QTimer.singleShot(500, lambda: self.poller_model.refresh_from_backend(self.client))
            QTimer.singleShot(500, lambda: self.auth_model.refresh_from_backend(self.client))
