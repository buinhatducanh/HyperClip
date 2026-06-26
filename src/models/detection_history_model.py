"""DetectionHistoryModel — structured log of detected videos + download outcomes."""
from PySide6.QtCore import QAbstractListModel, QModelIndex, Qt, QByteArray, Property, Signal, Slot
import time
import json
import os


from src.data_dir import get_data_dir


class DetectionHistoryModel(QAbstractListModel):
    changed = Signal()

    VideoIdRole = Qt.UserRole + 1
    WorkspaceIdRole = Qt.UserRole + 2
    TitleRole = Qt.UserRole + 3
    ChannelNameRole = Qt.UserRole + 4
    DetectedAtRole = Qt.UserRole + 5
    PublishedAtRole = Qt.UserRole + 6
    LatencyMsRole = Qt.UserRole + 7
    DurationSecRole = Qt.UserRole + 8
    StatusRole = Qt.UserRole + 9
    DownloadStartAtRole = Qt.UserRole + 10
    DownloadCompleteAtRole = Qt.UserRole + 11
    DownloadTimeSecRole = Qt.UserRole + 12
    DownloadSizeRole = Qt.UserRole + 13
    WidthRole = Qt.UserRole + 14
    HeightRole = Qt.UserRole + 15
    DetectedTimeStrRole = Qt.UserRole + 16
    LatencyStrRole = Qt.UserRole + 17
    AgeAtDetectionRole = Qt.UserRole + 18
    PublishedDateStrRole = Qt.UserRole + 19
    DetectedDateStrRole = Qt.UserRole + 20

    def __init__(self, parent=None, max_entries: int = 50):
        super().__init__(parent)
        self._entries: list[dict] = []
        self._max = max_entries
        # Track download completion data keyed by workspace id
        self._download_data: dict[str, dict] = {}
        # Counters
        self._today_count: int = 0
        self._today_date: str = ""
        self._history_file = os.path.abspath(os.path.join(get_data_dir(), "history.json"))
        # DO NOT auto load here to avoid blocking UI thread; load from main.py

    def load_from_disk(self, workspace_model=None):
        if not os.path.exists(self._history_file):
            return
        try:
            with open(self._history_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
                self.beginResetModel()
                self._entries = data.get("entries", [])
                self._download_data = data.get("download_data", {})

                # Sync download_data status with actual workspace status if workspace_model is provided
                if workspace_model:
                    ws_map = {ws.get("id"): ws for ws in workspace_model._workspaces if ws.get("id")}
                    for ws_id, dl in self._download_data.items():
                        if ws_id in ws_map:
                            ws_status = ws_map[ws_id].get("status")
                            if ws_status:
                                dl["status"] = ws_status
                                if ws_map[ws_id].get("error"):
                                    dl["error"] = ws_map[ws_id].get("error")

                self._today_count = self._count_today()
                self.endResetModel()
                self.changed.emit()
        except Exception as e:
            print(f"[DetectionHistory] Failed to load history: {e}")

    def save_to_disk(self):
        try:
            os.makedirs(os.path.dirname(self._history_file), exist_ok=True)
            with open(self._history_file, 'w', encoding='utf-8') as f:
                json.dump({
                    "entries": self._entries,
                    "download_data": self._download_data
                }, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f"[DetectionHistory] Failed to save history: {e}")

    def rowCount(self, parent=QModelIndex()):
        if parent.isValid():
            return 0
        return len(self._entries)

    def data(self, index, role=Qt.DisplayRole):
        if not index.isValid() or index.row() >= len(self._entries):
            return None
        e = self._entries[index.row()]
        ws_id = e.get("wsId", "")
        dl = self._download_data.get(ws_id, {})
        now_ms = int(time.time() * 1000)

        if role == self.VideoIdRole:
            return e.get("videoId", "")
        if role == self.WorkspaceIdRole:
            return ws_id
        if role == self.TitleRole:
            return e.get("title", "")
        if role == self.ChannelNameRole:
            return e.get("channelName", "")
        if role == self.DetectedAtRole:
            return e.get("detectedAt", 0)
        if role == self.PublishedAtRole:
            return e.get("publishedAt", 0)
        if role == self.LatencyMsRole:
            lat = e.get("latencyMs", 0)
            return lat
        if role == self.DurationSecRole:
            return e.get("durationSec", 0)
        if role == self.StatusRole:
            # Override with download status if available
            return dl.get("status", e.get("status", "waiting"))
        if role == self.DownloadStartAtRole:
            return dl.get("downloadStartAt", 0)
        if role == self.DownloadCompleteAtRole:
            return dl.get("downloadCompleteAt", 0)
        if role == self.DownloadTimeSecRole:
            start = dl.get("downloadStartAt", 0)
            complete = dl.get("downloadCompleteAt", 0)
            if start and complete:
                return (complete - start) / 1000
            return 0
        if role == self.DownloadSizeRole:
            return dl.get("downloadedSize", 0)
        if role == self.WidthRole:
            return dl.get("width", 0)
        if role == self.HeightRole:
            return dl.get("height", 0)
        if role == self.DetectedTimeStrRole:
            detected = e.get("detectedAt", 0)
            if not detected:
                return ""
            detected_sec = detected // 1000
            lt = time.localtime(detected_sec)
            return f"{lt.tm_hour:02d}:{lt.tm_min:02d}:{lt.tm_sec:02d}"
        if role == self.LatencyStrRole:
            lat = e.get("latencyMs", 0)
            if lat < 1000:
                return f"~{lat}ms"
            return f"~{lat / 1000:.1f}s"
        if role == self.AgeAtDetectionRole:
            lat = e.get("latencyMs", 0)
            age_sec = lat / 1000.0
            if age_sec < 60:
                return f"{age_sec:.1f}s"
            if age_sec < 3600:
                return f"{age_sec / 60.0:.1f}p"
            if age_sec < 86400:
                return f"{age_sec / 3600.0:.1f}g"
            return f"{age_sec / 86400.0:.1f}n trước"
        if role == self.PublishedDateStrRole:
            pub = e.get("publishedAt", 0)
            if not pub:
                return "—"
            pub_sec = pub // 1000
            lt = time.localtime(pub_sec)
            return f"{lt.tm_mday:02d}/{lt.tm_mon:02d}/{lt.tm_year}"
        if role == self.DetectedDateStrRole:
            detected = e.get("detectedAt", 0)
            if not detected:
                return "—"
            detected_sec = detected // 1000
            lt = time.localtime(detected_sec)
            return f"{lt.tm_mday:02d}/{lt.tm_mon:02d}/{lt.tm_year}"
        return None

    def roleNames(self):
        return {
            self.VideoIdRole: QByteArray(b"videoId"),
            self.WorkspaceIdRole: QByteArray(b"wsId"),
            self.TitleRole: QByteArray(b"title"),
            self.ChannelNameRole: QByteArray(b"channelName"),
            self.DetectedAtRole: QByteArray(b"detectedAt"),
            self.PublishedAtRole: QByteArray(b"publishedAt"),
            self.LatencyMsRole: QByteArray(b"latencyMs"),
            self.DurationSecRole: QByteArray(b"durationSec"),
            self.StatusRole: QByteArray(b"status"),
            self.DownloadStartAtRole: QByteArray(b"downloadStartAt"),
            self.DownloadCompleteAtRole: QByteArray(b"downloadCompleteAt"),
            self.DownloadTimeSecRole: QByteArray(b"downloadTimeSec"),
            self.DownloadSizeRole: QByteArray(b"downloadedSize"),
            self.WidthRole: QByteArray(b"width"),
            self.HeightRole: QByteArray(b"height"),
            self.DetectedTimeStrRole: QByteArray(b"detectedTimeStr"),
            self.LatencyStrRole: QByteArray(b"latencyStr"),
            self.AgeAtDetectionRole: QByteArray(b"ageAtDetection"),
            self.PublishedDateStrRole: QByteArray(b"publishedDateStr"),
            self.DetectedDateStrRole: QByteArray(b"detectedDateStr"),
        }

    @Slot(str, str, str, str, int, int, float, str)
    def add_detection(self, ws_id: str, video_id: str, title: str, channel_name: str,
                      published_at: int, detected_at: int, duration_sec: float, status: str):
        latency = detected_at - published_at
        now_ts = int(time.time())
        now_date = time.strftime("%Y-%m-%d", time.localtime(now_ts))

        # Reset today counter if date changed
        if now_date != self._today_date:
            self._today_count = 0
            self._today_date = now_date

        entry = {
            "wsId": ws_id,
            "videoId": video_id,
            "title": title,
            "channelName": channel_name,
            "publishedAt": published_at,
            "detectedAt": detected_at,
            "latencyMs": max(0, latency),
            "durationSec": duration_sec,
            "status": status,
        }

        self.beginInsertRows(QModelIndex(), 0, 0)
        self._entries.insert(0, entry)
        if len(self._entries) > self._max:
            self.beginRemoveRows(QModelIndex(), self._max, len(self._entries) - 1)
            self._entries = self._entries[:self._max]
            self.endRemoveRows()
        self.endInsertRows()

        self._today_count += 1
        self.changed.emit()
        self.save_to_disk()

    @Slot(str, str)
    def update_download_status(self, ws_id: str, status: str):
        """Called when workspace:update events arrive with download progress."""
        now_ms = int(time.time() * 1000)
        if ws_id not in self._download_data:
            self._download_data[ws_id] = {}

        data = self._download_data[ws_id]
        old_status = data.get("status", "")

        if status == "downloading" and old_status != "downloading":
            data["downloadStartAt"] = now_ms
        elif status == "ready" and old_status != "ready":
            data["downloadCompleteAt"] = now_ms

        data["status"] = status
        self._today_count = max(self._today_count, self._count_today())
        
        row = self._find_row(ws_id)
        if row >= 0:
            idx = self.index(row, 0)
            self.dataChanged.emit(idx, idx)
            
        self.changed.emit()
        self.save_to_disk()

    @Slot(str, int, int, int)
    def update_download_result(self, ws_id: str, file_size: int, width: int, height: int):
        """Called when download completes with file info."""
        if ws_id not in self._download_data:
            self._download_data[ws_id] = {}
        self._download_data[ws_id].update({
            "downloadedSize": file_size,
            "width": width,
            "height": height,
        })
        row = self._find_row(ws_id)
        if row >= 0:
            idx = self.index(row, 0)
            self.dataChanged.emit(idx, idx)
        self.save_to_disk()

    def _find_row(self, ws_id: str) -> int:
        for i, e in enumerate(self._entries):
            if e.get("wsId") == ws_id:
                return i
        return -1

    def _count_today(self) -> int:
        now_ts = int(time.time())
        today = time.strftime("%Y-%m-%d", time.localtime(now_ts))
        count = 0
        for e in self._entries:
            dt = e.get("detectedAt", 0)
            if dt:
                day = time.strftime("%Y-%m-%d", time.localtime(dt // 1000))
                if day == today:
                    count += 1
        return count

    @Property(int, notify=changed)
    def detectionCount(self):
        return self._today_count

    @Property(float, notify=changed)
    def averageLatencyMs(self):
        if not self._entries:
            return 0.0
        total = sum(max(0, e.get("latencyMs", 0)) for e in self._entries)
        return total / len(self._entries)

    @Property(float, notify=changed)
    def slaPercent(self):
        """Percentage of detections under 5 seconds."""
        if not self._entries:
            return 100.0
        under_5s = sum(1 for e in self._entries if 0 < e.get("latencyMs", 0) < 5000)
        return (under_5s / len(self._entries)) * 100.0

    @Property(str, notify=changed)
    def latestLatencyStr(self):
        if not self._entries:
            return "—"
        lat = self._entries[0].get("latencyMs", 0)
        if lat < 1000:
            return f"~{lat}ms"
        return f"~{lat / 1000:.1f}s"

    @Slot()
    def clear(self):
        if not self._entries:
            return
        self.beginResetModel()
        self._entries.clear()
        self._download_data.clear()
        self._today_count = 0
        self.endResetModel()
        self.changed.emit()
        self.save_to_disk()
