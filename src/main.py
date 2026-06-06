# src/main.py
import sys
from PySide6.QtQml import QQmlApplicationEngine
from PySide6.QtGui import QGuiApplication
from src.backend.events import get_event_bus
from src.models.workspace_model import WorkspaceModel
from src.models.channel_model import ChannelModel
from src.models.system_stats_model import SystemStatsModel
from src.services.video_player import VideoPlayer


def main():
    app = QGuiApplication(sys.argv)
    engine = QQmlApplicationEngine()

    bus = get_event_bus()
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
    bus.system_stats_updated.connect(lambda d: stats_model.update_from_dict(d))
    bus.new_video_detected.connect(lambda d: workspace_model.add_workspace(d))

    qml_dir = "src/ui/qml"
    engine.loadFromModule(qml_dir, "main")

    if not engine.rootObjects():
        return 1

    return app.exec()


if __name__ == "__main__":
    main()
