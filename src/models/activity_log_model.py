"""ActivityLogModel — list of recent activity entries."""
from PySide6.QtCore import QAbstractListModel, QModelIndex, Qt, QByteArray, Slot
from datetime import datetime


class ActivityLogModel(QAbstractListModel):
    TimeRole = Qt.UserRole + 1
    TypeRole = Qt.UserRole + 2
    MessageRole = Qt.UserRole + 3
    LevelRole = Qt.UserRole + 4

    def __init__(self, parent=None, max_entries: int = 200):
        super().__init__(parent)
        self._entries: list[dict] = []
        self._max = max_entries

    def rowCount(self, parent=QModelIndex()):
        if parent.isValid():
            return 0
        return len(self._entries)

    def data(self, index, role=Qt.DisplayRole):
        if not index.isValid() or index.row() >= len(self._entries):
            return None
        e = self._entries[index.row()]
        if role == self.TimeRole:
            return e.get("time", "")
        if role == self.TypeRole:
            return e.get("type", "info")
        if role == self.MessageRole:
            return e.get("message", "")
        if role == self.LevelRole:
            return e.get("level", "info")
        return None

    def roleNames(self):
        return {
            self.TimeRole: QByteArray(b"time"),
            self.TypeRole: QByteArray(b"type"),
            self.MessageRole: QByteArray(b"message"),
            self.LevelRole: QByteArray(b"level"),
        }

    @Slot(str, str, str)
    def add_entry(self, type_: str, message: str, level: str = "info"):
        ts = datetime.now().strftime("%H:%M:%S")
        self.beginInsertRows(QModelIndex(), len(self._entries), len(self._entries))
        self._entries.append({"time": ts, "type": type_, "message": message, "level": level})
        if len(self._entries) > self._max:
            self.beginRemoveRows(QModelIndex(), 0, 0)
            self._entries.pop(0)
            self.endRemoveRows()
        self.endInsertRows()

    @Slot()
    def clear(self):
        if not self._entries:
            return
        self.beginResetModel()
        self._entries.clear()
        self.endResetModel()
