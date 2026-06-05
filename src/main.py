# src/main.py
import sys
from PySide6.QtCore import QUrl
from PySide6.QtQml import QQmlApplicationEngine
from PySide6.QtGui import QGuiApplication
from src.backend.events import get_event_bus


def main():
    app = QGuiApplication(sys.argv)
    engine = QQmlApplicationEngine()

    bus = get_event_bus()
    engine.rootContext().setContextProperty("eventBus", bus)

    qml_dir = "src/ui/qml"
    engine.loadFromModule(qml_dir, "main")

    if not engine.rootObjects():
        return 1

    return app.exec()


if __name__ == "__main__":
    main()
