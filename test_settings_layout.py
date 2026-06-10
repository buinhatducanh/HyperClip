"""Render SettingsPage to PNG using offscreen Qt Quick rendering."""
import sys
import os
os.environ["QT_QUICK_CONTROLS_STYLE"] = "Fusion"
os.environ["QT_QPA_PLATFORM"] = "offscreen"
sys.path.insert(0, r"d:\LOOP_COMPANY\HyperClip")

from PySide6.QtCore import QUrl, QTimer
from PySide6.QtQml import QQmlApplicationEngine
from PySide6.QtGui import QGuiApplication
from PySide6.QtQuick import QQuickWindow

from src.models.settings_model import SettingsModel
from src.models.hardware_profile_model import HardwareProfileModel

app = QGuiApplication(sys.argv)
engine = QQmlApplicationEngine()

settings = SettingsModel()
hw = HardwareProfileModel()
hw.load_from_dict({
    "detected": {"gpuName": "NVIDIA GeForce RTX 4050 Laptop GPU", "vramGB": 6, "ramGB": 16},
    "active": "medium",
})

ctx = engine.rootContext()
ctx.setContextProperty("settings", settings)
ctx.setContextProperty("hwProfile", hw)
ctx.setContextProperty("backend", None)
ctx.setContextProperty("activityModel", None)
ctx.setContextProperty("toastService", None)
ctx.setContextProperty("statsModel", None)

qml_dir = r"d:\LOOP_COMPANY\HyperClip\src\ui\qml"
engine.addImportPath(qml_dir)

# Write a wrapper that renders just SettingsPage
test_qml = os.path.join(qml_dir, "_test_settings.qml")
with open(test_qml, "w") as f:
    f.write('''import QtQuick
import QtQuick.Window
import QtQuick.Controls
import "."

ApplicationWindow {
    id: win
    width: 1280
    height: 800
    visible: true
    title: "Test"
    color: Theme.bg
    SettingsPage { anchors.fill: parent }
}
''')

engine.load(QUrl.fromLocalFile(test_qml))
if not engine.rootObjects():
    print("FAILED to load QML")
    sys.exit(1)

win = engine.rootObjects()[0]
assert isinstance(win, QQuickWindow), f"Got {type(win)}"

def grab():
    try:
        img = win.grabWindow()
        if img.isNull():
            print("Image is null")
        else:
            path = r"d:\LOOP_COMPANY\HyperClip\test_settings.png"
            ok = img.save(path, "PNG")
            print(f"Saved: {path} ok={ok} size={img.width()}x{img.height()}")
    except Exception as e:
        print(f"Grab error: {e}")
    app.quit()

# Wait for window to render
QTimer.singleShot(2000, grab)
sys.exit(app.exec())
