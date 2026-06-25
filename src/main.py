# src/main.py
import sys
import os
os.environ["QT_QUICK_CONTROLS_STYLE"] = "Fusion"
from PySide6.QtCore import QUrl, Qt
from PySide6.QtQml import QQmlApplicationEngine
from PySide6.QtGui import QGuiApplication, QIcon, QPalette, QColor
from src.backend.events import get_event_bus
from src.backend.client import get_client
from src.services.app_controller import AppController



def main():
    # ─── Windows Debug Console Allocation ─────────────────────────
    if "--debug" in sys.argv and sys.platform == 'win32':
        import ctypes
        try:
            ctypes.windll.kernel32.AllocConsole()
            # Redirect standard streams to the new console
            sys.stdout = open("CONOUT$", "w", encoding="utf-8")
            sys.stderr = open("CONOUT$", "w", encoding="utf-8")
            print("[Debug] Console allocated successfully. Logging active.", flush=True)
        except Exception as e:
            sys.stderr.write(f"[main] Failed to allocate console: {e}\n")
            sys.stderr.flush()

    # Set Windows AppUserModelID to ensure taskbar shows the correct icon
    if sys.platform == 'win32':
        import ctypes
        try:
            myappid = 'loopcompany.hyperclip.v1'
            ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID(myappid)
        except Exception as e:
            sys.stderr.write(f"[main] Failed to set AppUserModelID: {e}\n")
            sys.stderr.flush()

    app = QGuiApplication(sys.argv)

    # ─── Apply global dark QPalette for Fusion QML components ─────
    dark_palette = QPalette()
    dark_palette.setColor(QPalette.Window, QColor("#121212"))
    dark_palette.setColor(QPalette.WindowText, QColor("#FFFFFF"))
    dark_palette.setColor(QPalette.Base, QColor("#1E1E1E"))
    dark_palette.setColor(QPalette.AlternateBase, QColor("#1A1A1A"))
    dark_palette.setColor(QPalette.ToolTipBase, QColor("#1E1E1E"))
    dark_palette.setColor(QPalette.ToolTipText, QColor("#FFFFFF"))
    dark_palette.setColor(QPalette.Text, QColor("#FFFFFF"))
    dark_palette.setColor(QPalette.PlaceholderText, QColor("#888888"))
    dark_palette.setColor(QPalette.Button, QColor("#1A1A1A"))
    dark_palette.setColor(QPalette.ButtonText, QColor("#FFFFFF"))
    dark_palette.setColor(QPalette.BrightText, QColor("#FF4444"))
    dark_palette.setColor(QPalette.Highlight, QColor("#00B4FF"))
    dark_palette.setColor(QPalette.HighlightedText, QColor("#FFFFFF"))
    dark_palette.setColor(QPalette.Link, QColor("#00B4FF"))
    dark_palette.setColor(QPalette.LinkVisited, QColor("#00B4FF"))

    # For disabled controls
    dark_palette.setColor(QPalette.Disabled, QPalette.WindowText, QColor("#888888"))
    dark_palette.setColor(QPalette.Disabled, QPalette.Text, QColor("#888888"))
    dark_palette.setColor(QPalette.Disabled, QPalette.ButtonText, QColor("#888888"))

    app.setPalette(dark_palette)

    
    # ─── Set Window Icon (CapCut branding) ─────────────────────────
    if getattr(sys, 'frozen', False):
        icon_path = os.path.join(getattr(sys, '_MEIPASS', os.path.dirname(sys.executable)), "resources", "icon.png")
    else:
        icon_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "resources", "icon.png")
    
    if os.path.exists(icon_path):
        app.setWindowIcon(QIcon(icon_path))
    else:
        app.setWindowIcon(QIcon("resources/icon.png"))

    engine = QQmlApplicationEngine()

    bus = get_event_bus()
    client = get_client()  # spawns Rust backend subprocess

    # Create and initialize AppController
    controller = AppController(client, bus)
    controller.initialize_and_wire()

    # ─── Expose to QML ────────────────────────────────────────────
    ctx = engine.rootContext()
    ctx.setContextProperty("eventBus", bus)
    ctx.setContextProperty("backend", client)  # direct backend access
    ctx.setContextProperty("toastService", controller.toast_service)
    ctx.setContextProperty("workspaceModel", controller.workspace_model)
    ctx.setContextProperty("channelListModel", controller.channel_list_model)
    ctx.setContextProperty("statsModel", controller.stats_model)
    ctx.setContextProperty("settings", controller.settings_model)
    ctx.setContextProperty("activityModel", controller.activity_model)
    ctx.setContextProperty("hwProfile", controller.hw_profile_model)
    ctx.setContextProperty("poller", controller.poller_model)
    ctx.setContextProperty("auth", controller.auth_model)
    ctx.setContextProperty("sessionModel", controller.session_model)
    ctx.setContextProperty("projectModel", controller.project_model)
    ctx.setContextProperty("keyModel", controller.key_model)
    ctx.setContextProperty("renderedModel", controller.rendered_model)
    ctx.setContextProperty("detectionHistory", controller.detection_history_model)
    ctx.setContextProperty("logFilesModel", controller.log_files_model)
    ctx.setContextProperty("logFileModel", controller.log_file_model)
    ctx.setContextProperty("player", controller.video_player)
    ctx.setContextProperty("thumbnailService", controller.thumbnail_service)

    # ─── QML load ──────────────────────────────────────────────────
    if getattr(sys, 'frozen', False):
        qml_dir = os.path.join(getattr(sys, '_MEIPASS', os.path.dirname(sys.executable)), 'qml')
    else:
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
