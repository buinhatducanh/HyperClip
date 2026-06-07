# src/main.py
import sys
import os
from PySide6.QtCore import QTimer, QUrl
from PySide6.QtQml import QQmlApplicationEngine
from PySide6.QtGui import QGuiApplication
from src.backend.events import get_event_bus
from src.backend.client import get_client
from src.models.workspace_model import WorkspaceModel
from src.models.channel_model import ChannelModel
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
from src.services.video_player import VideoPlayer


def main():
    app = QGuiApplication(sys.argv)
    engine = QQmlApplicationEngine()

    bus = get_event_bus()
    client = get_client()  # spawns Rust backend subprocess

    # ─── Models ───────────────────────────────────────────────────
    workspace_model = WorkspaceModel()
    channel_model = ChannelModel()
    channel_list_model = ChannelListModel()
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
    video_player = VideoPlayer()

    # ─── Expose to QML ────────────────────────────────────────────
    ctx = engine.rootContext()
    ctx.setContextProperty("eventBus", bus)
    ctx.setContextProperty("backend", client)  # direct backend access
    ctx.setContextProperty("workspaceModel", workspace_model)
    ctx.setContextProperty("channelModel", channel_model)
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
    ctx.setContextProperty("player", video_player)

    # ─── Event bus wiring ─────────────────────────────────────────
    bus.workspace_updated.connect(lambda d: workspace_model.update_workspace(d.get("id", ""), d))
    bus.render_progress.connect(lambda ws_id, prog: workspace_model.set_progress(ws_id, prog))
    bus.system_stats_updated.connect(lambda d: stats_model.update_from_dict(d))
    bus.new_video_detected.connect(lambda d: (
        workspace_model.add_workspace(d),
        activity_model.add_entry("auto", f"New video: {d.get('title', '?')}", "info"),
    ))
    bus.channel_synced.connect(lambda: (
        workspace_model.load_from_backend(client),
        channel_model.load_from_backend(client),
        channel_list_model.load_from_backend(client),
        settings_model.load_from_backend(client),
        hw_profile_model.refresh_from_backend(client),
        poller_model.refresh_from_backend(client),
        auth_model.refresh_from_backend(client),
        rendered_model.load_from_backend(client),
    ))

    # Periodic system:stats poll — 5s
    def poll_stats():
        if client:
            client.send_command("system:stats", timeout=2.0)

    stats_timer = QTimer()
    stats_timer.setInterval(5000)
    stats_timer.timeout.connect(poll_stats)
    stats_timer.start()

    # Periodic poller status refresh — 15s
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

