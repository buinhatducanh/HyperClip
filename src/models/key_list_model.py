"""KeyListModel — Data API v3 keys (30 key pool, fallback)."""
from PySide6.QtCore import QAbstractListModel, QModelIndex, Qt, QByteArray, Slot


class KeyListModel(QAbstractListModel):
    IdRole = Qt.UserRole + 1
    NameRole = Qt.UserRole + 2
    ProjectIdRole = Qt.UserRole + 3
    ValidRole = Qt.UserRole + 4
    QuotaUsedRole = Qt.UserRole + 5
    QuotaLimitRole = Qt.UserRole + 6
    LastErrorRole = Qt.UserRole + 7
    MaskedKeyRole = Qt.UserRole + 8

    def __init__(self, parent=None):
        super().__init__(parent)
        self._items: list[dict] = []

    def rowCount(self, parent=QModelIndex()):
        if parent.isValid():
            return 0
        return len(self._items)

    def data(self, index, role=Qt.DisplayRole):
        if not index.isValid() or index.row() >= len(self._items):
            return None
        k = self._items[index.row()]
        if role == self.IdRole: return k.get("key", "")
        if role == self.NameRole: return k.get("name", "")
        if role == self.ProjectIdRole: return k.get("projectId", "")
        if role == self.ValidRole: return bool(k.get("valid", True))
        if role == self.QuotaUsedRole: return int(k.get("quotaUsed", 0))
        if role == self.QuotaLimitRole: return int(k.get("quotaLimit", 10000))
        if role == self.LastErrorRole: return k.get("lastError", "")
        if role == self.MaskedKeyRole:
            full = k.get("key", "")
            if len(full) > 8:
                return full[:4] + "***" + full[-4:]
            return "***"
        return None

    def roleNames(self):
        return {
            self.IdRole: QByteArray(b"key"),
            self.NameRole: QByteArray(b"name"),
            self.ProjectIdRole: QByteArray(b"projectId"),
            self.ValidRole: QByteArray(b"valid"),
            self.QuotaUsedRole: QByteArray(b"quotaUsed"),
            self.QuotaLimitRole: QByteArray(b"quotaLimit"),
            self.LastErrorRole: QByteArray(b"lastError"),
            self.MaskedKeyRole: QByteArray(b"maskedKey"),
        }

    def load_from_backend(self, backend):
        try:
            resp = backend.send_command("key:list")
            keys = resp.get("result", [])
            if not isinstance(keys, list):
                keys = []
            self.beginResetModel()
            self._items = keys
            self.endResetModel()
        except Exception as e:
            print(f"[KeyListModel] load error: {e}")

    @Slot()
    def refresh(self, backend):
        self.load_from_backend(backend)

    @Slot(str, str, str)
    def add(self, backend, key: str, project_id: str, name: str):
        if not backend: return
        backend.send_command("key:add", {"key": key, "projectId": project_id, "name": name})
        self.load_from_backend(backend)

    @Slot(str)
    def remove(self, backend, key: str):
        if not backend: return
        backend.send_command("key:remove", {"key": key})
        self.load_from_backend(backend)

    @Slot()
    def test_all(self, backend):
        if not backend: return
        backend.send_command("key:testAll")
        self.load_from_backend(backend)

    @Slot()
    def reset(self, backend, key: str = ""):
        if not backend: return
        backend.send_command("key:reset", {"key": key} if key else {})
        self.load_from_backend(backend)
