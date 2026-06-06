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
from src.services.video_player import VideoPlayer


def main():
    app = QGuiApplication(sys.argv)
    engine = QQmlApplicationEngine()

    bus = get_event_bus()
    print(f"[main] bus id={id(bus)} addr={hex(id(bus))}", flush=True)
    client = get_client()  # spawns Rust backend subprocess
    print(f"[main] client id={id(client)}", flush=True)
    workspace_model = WorkspaceModel()
    channel_model = ChannelModel()
    stats_model = SystemStatsModel()
    video_player = VideoPlayer()

    engine.rootContext().setContextProperty("eventBus", bus)
    engine.rootContext().setContextProperty("workspaceModel", workspace_model)
    engine.rootContext().setContextProperty("channelModel", channel_model)
    engine.rootContext().setContextProperty("statsModel", stats_model)
    engine.rootContext().setContextProperty("player", video_player)

    bus.workspace_updated.connect(lambda d: workspace_model.update_workspace(d.get("id", ""), d))
    bus.render_progress.connect(lambda ws_id, prog: workspace_model.set_progress(ws_id, prog))
    bus.system_stats_updated.connect(lambda d: (
        print(f"[main] system_stats_updated: {d}", flush=True),
        stats_model.update_from_dict(d)
    ))
    bus.new_video_detected.connect(lambda d: workspace_model.add_workspace(d))
    bus.channel_synced.connect(lambda: (
        print("[main] channel_synced", flush=True),
        workspace_model.load_from_backend(client) if client else None,
        channel_model.load_from_backend(client) if client else None,
    ))

    # Periodic system:stats poll — 5s (matches electron/services/system.ts)
    def poll_stats():
        if client:
            client.send_command("system:stats", timeout=2.0)

    stats_timer = QTimer()
    stats_timer.setInterval(5000)
    stats_timer.timeout.connect(poll_stats)
    stats_timer.start()

    qml_dir = "src/ui/qml"

    def on_qml_warnings(warnings):
        for w in warnings:
            sys.stderr.write(f"[QML] {w.toString()}\n")
            sys.stderr.flush()

    engine.warnings.connect(on_qml_warnings)
    # Add QML import path so relative imports in QML work
    engine.addImportPath(os.path.abspath(qml_dir))
    # Load main.qml directly from filesystem
    qml_main = os.path.abspath(os.path.join(qml_dir, "main.qml"))
    engine.load(QUrl.fromLocalFile(qml_main))

    if not engine.rootObjects():
        sys.stderr.write("[main] QML failed to load — no root objects\n")
        sys.stderr.flush()
        return 1

    sys.stderr.write(f"[main] QML loaded — {len(engine.rootObjects())} root object(s)\n")
    sys.stderr.flush()

    exit_code = app.exec()

    if client:
        client.stop()
    return exit_code


if __name__ == "__main__":
    sys.exit(main() or 0)

# --- DEBUG: minimal signal test ---
import os
if os.environ.get("HC_DEBUG") == "1":
    from PySide6.QtCore import QTimer
    def _debug_main():
        app = QGuiApplication(sys.argv)
        from src.backend.events import get_event_bus
        from src.backend.client import get_client
        bus = get_event_bus()
        get_client()
        bus.system_stats_updated.connect(lambda d: print(f"[DEBUG on_stats] {d}", flush=True))
        bus.channel_synced.connect(lambda: print("[DEBUG channel_synced]", flush=True))
        QTimer.singleShot(3000, app.quit)
        sys.exit(app.exec())
    if __name__ == "__main__" and "HC_DEBUG" in os.environ:
        _debug_main()
