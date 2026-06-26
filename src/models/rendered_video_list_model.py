"""RenderedVideoListModel — completed rendered outputs, incremental model."""
from PySide6.QtCore import QAbstractListModel, QModelIndex, Qt, QByteArray, Slot, QObject


class RenderedVideoListModel(QAbstractListModel):
    IdRole = Qt.UserRole + 1
    TitleRole = Qt.UserRole + 2
    ChannelRole = Qt.UserRole + 3
    PathRole = Qt.UserRole + 4
    SizeRole = Qt.UserRole + 5
    DurationRole = Qt.UserRole + 6
    RenderedAtRole = Qt.UserRole + 7
    QualityRole = Qt.UserRole + 8
    ArchivedRole = Qt.UserRole + 9
    ThumbnailRole = Qt.UserRole + 10

    def __init__(self, parent=None):
        super().__init__(parent)
        self._items: list[dict] = []
        self._id_index: dict[str, int] = {}

    def rowCount(self, parent=QModelIndex()):
        if parent.isValid():
            return 0
        return len(self._items)

    def data(self, index, role=Qt.DisplayRole):
        if not index.isValid() or index.row() >= len(self._items):
            return None
        v = self._items[index.row()]
        if role == self.IdRole: return v.get("id", "")
        if role == self.TitleRole: return v.get("title", "")
        if role == self.ChannelRole: return v.get("channelName", "")
        if role == self.PathRole: return v.get("outputPath", "")
        if role == self.SizeRole: return int(v.get("fileSize", 0))
        if role == self.DurationRole: return float(v.get("duration", 0))
        if role == self.RenderedAtRole: return int(v.get("renderedAt", 0))
        if role == self.QualityRole: return v.get("quality", "1080p")
        if role == self.ArchivedRole: return bool(v.get("archived", False))
        if role == self.ThumbnailRole: return v.get("thumbnail", "")
        return None

    def roleNames(self):
        return {
            self.IdRole: QByteArray(b"id"),
            self.TitleRole: QByteArray(b"title"),
            self.ChannelRole: QByteArray(b"channelName"),
            self.PathRole: QByteArray(b"outputPath"),
            self.SizeRole: QByteArray(b"fileSize"),
            self.DurationRole: QByteArray(b"duration"),
            self.RenderedAtRole: QByteArray(b"renderedAt"),
            self.QualityRole: QByteArray(b"quality"),
            self.ArchivedRole: QByteArray(b"archived"),
            self.ThumbnailRole: QByteArray(b"thumbnail"),
        }

    def _rebuild_index(self):
        self._id_index = {v.get("id", ""): i for i, v in enumerate(self._items)}

    def _ids_identical(self, new: list[dict]) -> bool:
        if len(new) != len(self._items):
            return False
        for a, b in zip(self._items, new):
            if a.get("id") != b.get("id"):
                return False
        return True

    def load_from_backend(self, backend):
        try:
            resp = backend.send_command("rendered:list")
            if not resp or not resp.get("ok"):
                return
            items = resp.get("result", [])
            if not isinstance(items, list):
                items = []
            if self._ids_identical(items):
                for i, v in enumerate(items):
                    self._items[i] = v
                idx_top = self.index(0)
                idx_bot = self.index(len(self._items) - 1) if self._items else idx_top
                self.dataChanged.emit(idx_top, idx_bot, [])
            else:
                self.beginResetModel()
                self._items = items
                self._rebuild_index()
                self.endResetModel()
        except Exception as e:
            print(f"[RenderedVideoListModel] load error: {e}")

    @Slot(QObject)
    def refresh(self, backend):
        self.load_from_backend(backend)

    @Slot(QObject, str)
    def archive(self, backend, video_id: str):
        if not backend: return
        backend.send_command("rendered:archive", {"id": video_id})
        self.load_from_backend(backend)

    @Slot(QObject, str)
    def remove(self, backend, video_id: str):
        if not backend: return
        backend.send_command("rendered:remove", {"id": video_id})
        self.load_from_backend(backend)

    @Slot(QObject, str)
    def open_folder(self, backend, video_id: str = ""):
        if not backend: return
        backend.send_command("rendered:openFolder", {"id": video_id} if video_id else {})
