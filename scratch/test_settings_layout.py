import sys
import os
os.environ["QT_QUICK_CONTROLS_STYLE"] = "Fusion"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from PySide6.QtCore import QUrl, QTimer, QObject, Property, Slot
from PySide6.QtQml import QQmlApplicationEngine
from PySide6.QtGui import QGuiApplication
from PySide6.QtQuick import QQuickWindow

# Mock settings model
class MockSettings(QObject):
    # Detection
    @Property(bool)
    def pollingEnabled(self): return True
    @Property(int)
    def pollIntervalMs(self): return 5000
    @Property(int)
    def videoMinDurationSec(self): return 10
    @Property(int)
    def videoMaxDurationSec(self): return 600

    # Download
    @Property(bool)
    def autoDownloadEnabled(self): return True
    @Property(str)
    def autoDownloadQuality(self): return "1080"
    @Property(int)
    def autoDownloadMaxAgeMinutes(self): return 1440
    @Property(int)
    def defaultTrimLimit(self): return 10
    @Property(int)
    def maxConcurrentDownloads(self): return 4

    # Auto Render
    @Property(bool)
    def autoRender(self): return True
    @Property(str)
    def autoRenderResolution(self): return "1080p"
    @Property(int)
    def autoRenderFPS(self): return 60
    @Property(float)
    def autoRenderSpeed(self): return 1.2
    @Property(int)
    def autoSplitParts(self): return 3
    @Property(int)
    def autoSplitMinutes(self): return 0
    @Property(str)
    def autoRenderTitleTemplate(self): return "{title} - Short version"

    # Storage
    @Property(str)
    def videoStoragePath(self): return "D:/HyperClip/Downloads"
    @Property(str)
    def outputPath(self): return "D:/HyperClip/Rendered"
    @Property(int)
    def downloadsCleanupDays(self): return 7
    @Property(int)
    def maxConcurrentRenders(self): return 2

# Mock hardware profile model
class MockHW(QObject):
    @Property(str)
    def detectedGpuName(self): return "NVIDIA GeForce RTX 5080"
    @Property(int)
    def detectedVramGb(self): return 16
    @Property(int)
    def detectedRamGb(self): return 64
    @Property(bool)
    def isBusy(self): return False
    @Property(str)
    def activeId(self): return "ultra"

    # GPU stats (System tab)
    @Property(str)
    def gpuName(self): return "NVIDIA GeForce RTX 5080"
    @Property(str)
    def gpu_name(self): return "NVIDIA GeForce RTX 5080"
    @Property(str)
    def gpu_tier(self): return "high"
    @Property(int)
    def gpu_temp(self): return 55
    @Property(int)
    def active_workers(self): return 2
    @Property(int)
    def max_workers(self): return 8
    @Property(str)
    def ram_label(self): return "16.2 / 64.0 GB"
    @Property(str)
    def network_ip(self): return "192.168.1.100"
    @Property(bool)
    def is_online(self): return True

    @Slot(result="QVariantList")
    def presets(self):
        return [
            {"id": "ultra", "label": "Ultra", "vramGB": 16, "ramGB": 64, "sessions": 30, "renderWorkers": 6, "chunkWorkers": 14, "downloadInstances": 6},
            {"id": "high", "label": "High", "vramGB": 12, "ramGB": 48, "sessions": 8, "renderWorkers": 3, "chunkWorkers": 6, "downloadInstances": 2},
            {"id": "medium", "label": "Medium", "vramGB": 8, "ramGB": 32, "sessions": 6, "renderWorkers": 2, "chunkWorkers": 4, "downloadInstances": 2},
            {"id": "low", "label": "Low", "vramGB": 6, "ramGB": 24, "sessions": 4, "renderWorkers": 2, "chunkWorkers": 2, "downloadInstances": 1},
            {"id": "minimal", "label": "Minimal", "vramGB": 4, "ramGB": 16, "sessions": 2, "renderWorkers": 1, "chunkWorkers": 1, "downloadInstances": 1},
        ]

# Mock poller
class MockPoller(QObject):
    @Property(bool)
    def active(self): return True
    @Property(str)
    def lastError(self): return ""

app = QGuiApplication(sys.argv)
engine = QQmlApplicationEngine()

settings = MockSettings()
hw = MockHW()
poller = MockPoller()

ctx = engine.rootContext()
ctx.setContextProperty("settings", settings)
ctx.setContextProperty("hwProfile", hw)
ctx.setContextProperty("statsModel", hw)
ctx.setContextProperty("poller", poller)
ctx.setContextProperty("backend", None)
ctx.setContextProperty("activityModel", None)
ctx.setContextProperty("toastService", None)
ctx.setContextProperty("sessionModel", None)
ctx.setContextProperty("projectModel", None)
ctx.setContextProperty("keyModel", None)
ctx.setContextProperty("renderedModel", None)
ctx.setContextProperty("detectionHistory", None)
ctx.setContextProperty("logFilesModel", None)
ctx.setContextProperty("logFileModel", None)

project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
qml_dir = os.path.join(project_root, "src", "ui", "qml")
engine.addImportPath(qml_dir)

test_qml = os.path.join(qml_dir, "_test_settings_grab.qml")
with open(test_qml, "w", encoding="utf-8") as f:
    f.write('''import QtQuick
import QtQuick.Window
import QtQuick.Controls
import "."

ApplicationWindow {
    id: win
    width: 1280
    height: 800
    visible: true
    title: "Test Settings"
    color: Theme.bg
    SettingsPage {
        anchors.fill: parent
    }
}
''')

engine.load(QUrl.fromLocalFile(test_qml))
if not engine.rootObjects():
    print("FAILED to load QML")
    sys.exit(1)

win = engine.rootObjects()[0]

def grab():
    try:
        img = win.grabWindow()
        if img.isNull():
            print("Image is null")
        else:
            path = os.path.join(project_root, "scratch", "settings_current.png")
            os.makedirs(os.path.dirname(path), exist_ok=True)
            ok = img.save(path, "PNG")
            print(f"Saved: {path} ok={ok} size={img.width()}x{img.height()}")
    except Exception as e:
        print(f"Grab error: {e}")
    finally:
        try:
            os.remove(test_qml)
        except:
            pass
        app.quit()

QTimer.singleShot(1000, grab)
sys.exit(app.exec())
