# src/main.py
import sys
import os
os.environ["QT_QUICK_CONTROLS_STYLE"] = "Fusion"
from PySide6.QtCore import QTimer, QUrl
from PySide6.QtQml import QQmlApplicationEngine
from PySide6.QtGui import QGuiApplication
from src.backend.events import get_event_bus
from src.backend.client import get_client
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


def main():
    app = QGuiApplication(sys.argv)
    engine = QQmlApplicationEngine()

    bus = get_event_bus()
    client = get_client()  # spawns Rust backend subprocess

    # ─── Load channels immediately (channel:synced fired before bus connected) ───
    channel_list_model = ChannelListModel()
    channel_list_model.load_from_backend(client)

    # ─── Models ───────────────────────────────────────────────────
    workspace_model = WorkspaceModel()
    stats_model = SystemStatsModel()
    settings_model = SettingsModel()
    activity_model = ActivityLogModel()
    hw_profile_model = HardwareProfileModel()
    poller_model = PollerStatusModel()
    auth_model = AuthStatusModel()
    session_model = SessionListModel()
    project_model = ProjectListModel()
    key_model = KeyListModel()
    rendered_model = RenderedVideoListModel()
    detection_history_model = DetectionHistoryModel()
    log_files_model = LogFilesListModel(backend=client)
    log_file_model = LogFileModel(backend=client)
    video_player = VideoPlayer()
    thumbnail_service = ThumbnailService()
    toast_service = get_toast_service()

    # ─── Expose to QML ────────────────────────────────────────────
    ctx = engine.rootContext()
    ctx.setContextProperty("eventBus", bus)
    ctx.setContextProperty("backend", client)  # direct backend access
    ctx.setContextProperty("toastService", toast_service)
    ctx.setContextProperty("workspaceModel", workspace_model)
    ctx.setContextProperty("channelListModel", channel_list_model)
    ctx.setContextProperty("statsModel", stats_model)
    ctx.setContextProperty("settings", settings_model)
    ctx.setContextProperty("activityModel", activity_model)
    ctx.setContextProperty("hwProfile", hw_profile_model)
    ctx.setContextProperty("poller", poller_model)
    ctx.setContextProperty("auth", auth_model)
    ctx.setContextProperty("sessionModel", session_model)
    ctx.setContextProperty("projectModel", project_model)
    ctx.setContextProperty("keyModel", key_model)
    ctx.setContextProperty("renderedModel", rendered_model)
    ctx.setContextProperty("detectionHistory", detection_history_model)
    ctx.setContextProperty("logFilesModel", log_files_model)
    ctx.setContextProperty("logFileModel", log_file_model)
    ctx.setContextProperty("player", video_player)
    ctx.setContextProperty("thumbnailService", thumbnail_service)

    # ─── Event bus wiring ─────────────────────────────────────────
    bus.workspace_updated.connect(lambda d: (
        workspace_model.update_field(
            d.get("id", ""), d.get("field", ""), d.get("value"),
            client=None,  # avoid echo loop
        ) if d.get("field") else workspace_model.update_workspace(d.get("id", ""), d)
    ))
    # Track download status changes for detection history
    bus.workspace_updated.connect(lambda d: (
        detection_history_model.update_download_status(d.get("id", ""), d.get("status", "")),
    ) if not d.get("field") else None)
    # Track download completion results (size, resolution)
    bus.workspace_updated.connect(lambda d: (
        detection_history_model.update_download_result(
            d.get("id", ""), d.get("downloadedSize", 0),
            d.get("width", 0), d.get("height", 0),
        ),
    ) if not d.get("field") and d.get("status") == "ready" and d.get("downloadedSize") else None)

    # Auto-split after download if enabled
    def _maybe_auto_split(d):
        if d.get("field") or d.get("status") != "ready":
            return
        ws_id = d.get("id", "")
        if not ws_id:
            return
        if settings_model.autoSplitParts <= 1 and not (settings_model.autoSplitMinutes > 0 and d.get("durationSec", 0) > settings_model.autoSplitMinutes * 60):
            return
        settings_model.load_from_backend(client)
        parts = settings_model.autoSplitParts
        minutes = settings_model.autoSplitMinutes
        duration = d.get("durationSec", 600)
        if minutes > 0:
            part_sec = minutes * 60
            parts = max(1, int(duration / part_sec))
        part_sec = duration / parts
        split_parts = []
        for i in range(parts):
            start = i * part_sec
            end = min((i + 1) * part_sec, duration)
            split_parts.append({"start": start, "end": end})
        client.send_command("workspace:split", {"id": ws_id, "autoRender": False, "parts": split_parts})

    bus.workspace_updated.connect(_maybe_auto_split)
    bus.render_progress.connect(lambda ws_id, prog: workspace_model.set_progress(ws_id, prog))
    bus.system_stats_updated.connect(lambda d: stats_model.update_from_dict(d))
    bus.new_video_detected.connect(lambda d: (
        workspace_model.add_workspace({
            "id": d.get("id", ""),
            "status": d.get("status", "waiting"),
            "title": d.get("title", ""),
            "progress": 0.0,
            "channel_name": d.get("channelName", "") or d.get("channel_id", ""),
            "thumbnail": d.get("thumbnailUrl", "") or d.get("thumbnail", ""),
            "created_at": d.get("detectedAt", 0) or d.get("detected_at", 0),
            "published_at": d.get("publishedAt", 0) or d.get("published_at", 0),
            "durationSec": d.get("durationSec", 0) or d.get("duration_sec", 0),
            "quality": 360,  # default for auto-download
            "speed": 1.0,
            "isShort": True,
        }),
        activity_model.add_entry("auto", f"New video: {d.get('title', '?')}", "info"),
        detection_history_model.add_detection(
            d.get("id", ""),
            d.get("videoId", ""),
            d.get("title", ""),
            d.get("channelName", ""),
            d.get("publishedAt", 0),
            d.get("detectedAt", 0),
            d.get("durationSec", 0.0),
            d.get("status", "waiting"),
        ),
    ))
    bus.channel_synced.connect(lambda: (
        workspace_model.load_from_backend(client),
        channel_list_model.load_from_backend(client),
        settings_model.load_from_backend(client),
        hw_profile_model.refresh_from_backend(client),
        poller_model.refresh_from_backend(client),
        auth_model.refresh_from_backend(client),
        rendered_model.load_from_backend(client),
    ))

    # Wire notification signal → activity log
    bus.notification.connect(lambda title, message: (
        activity_model.add_entry("system", f"{title}: {message}", "info"),
    ))

    # Wire download progress → workspace model + activity log
    bus.download_progress.connect(lambda ws_id, percent, speed_mbps, eta_sec: (
        workspace_model.set_progress(ws_id, percent),
        activity_model.add_entry("download", f"Downloading {ws_id}: {percent:.0f}% @ {speed_mbps:.1f} MB/s", "info"),
    ))

    # Periodic system:stats poll — 5s via send_command_async (non-blocking)
    def poll_stats():
        if client:
            client.send_command_async("system:stats")

    stats_timer = QTimer()
    stats_timer.setInterval(5000)
    stats_timer.timeout.connect(poll_stats)
    stats_timer.start()

    # Auto-start poller once after UI is ready (respect pollingEnabled setting)
    def start_poller():
        if client:
            # Check pollingEnabled from settings model
            if settings_model.pollingEnabled:
                client.send_command_async("poller:start")
                sys.stderr.write("[main] Poller auto-started\n")
            else:
                sys.stderr.write("[main] Polling disabled in settings, skipping auto-start\n")
            # Refresh auth once poller is initialized (backend state is stable)
            # This avoids the 15s wait for LoginScreen to dismiss
            QTimer.singleShot(500, lambda: auth_model.refresh_from_backend(client))

    QTimer.singleShot(1000, start_poller)

    # Periodic poller status refresh — 15s via send_command_async
    def poll_poller():
        if client:
            poller_model.refresh_from_backend(client)
            auth_model.refresh_from_backend(client)

    poller_timer = QTimer()
    poller_timer.setInterval(15000)
    poller_timer.timeout.connect(poll_poller)
    poller_timer.start()

    # ─── QML load ──────────────────────────────────────────────────
    qml_dir = "src/ui/qml"

    def on_qml_warnings(warnings):
        for w in warnings:
            sys.stderr.write(f"[QML] {w.toString()}\n")
            sys.stderr.flush()

    engine.warnings.connect(on_qml_warnings)
    engine.addImportPath(os.path.abspath(qml_dir))
    qml_main = os.path.abspath(os.path.join(qml_dir, "main.qml"))
    engine.load(QUrl.fromLocalFile(qml_main))

    if not engine.rootObjects():
        sys.stderr.write("[main] QML failed to load\n")
        sys.stderr.flush()
        return 1

    sys.stderr.write(f"[main] QML loaded\n")
    sys.stderr.flush()

    exit_code = app.exec()

    if client:
        client.stop()
    return exit_code


if __name__ == "__main__":
    sys.exit(main() or 0)
