"""KeyListModel — Data API v3 keys (30 key pool, fallback).

Incremental model: _ids_identical check avoids gratuitous beginResetModel.
"""
import json
from PySide6.QtCore import QAbstractListModel, QModelIndex, Qt, QByteArray, Slot, QObject


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
        self._id_index: dict[str, int] = {}

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

    def _rebuild_index(self):
        self._id_index = {k.get("key", ""): i for i, k in enumerate(self._items)}

    def _ids_identical(self, new: list[dict]) -> bool:
        if len(new) != len(self._items):
            return False
        for a, b in zip(self._items, new):
            if a.get("key") != b.get("key"):
                return False
        return True

    def load_from_backend(self, backend):
        if not backend:
            return
        try:
            resp = backend.send_command("key:list")
            keys = resp.get("result", [])
            if not isinstance(keys, list):
                keys = []
            if self._ids_identical(keys):
                for i, k in enumerate(keys):
                    self._items[i] = k
                idx_top = self.index(0)
                idx_bot = self.index(len(self._items) - 1) if self._items else idx_top
                self.dataChanged.emit(idx_top, idx_bot, [])
            else:
                self.beginResetModel()
                self._items = keys
                self._rebuild_index()
                self.endResetModel()
        except Exception as e:
            print(f"[KeyListModel] load error: {e}")

    @Slot(QObject)
    def refresh(self, backend):
        self.load_from_backend(backend)

    @Slot(QObject, str, str, str)
    def add(self, backend, key: str, project_id: str, name: str):
        if not backend: return
        backend.send_command("key:add", {"key": key, "projectId": project_id, "name": name})
        self.load_from_backend(backend)

    @Slot(QObject, str)
    def remove(self, backend, key: str):
        if not backend: return
        backend.send_command("key:remove", {"key": key})
        self.load_from_backend(backend)

    @Slot(QObject)
    def test_all(self, backend):
        if not backend: return
        resp = backend.send_command("key:testAll")
        if resp and resp.get("ok") is not False:
            keys = resp.get("result", {}).get("keys", [])
            from src.services.toast_service import get_toast_service
            toast = get_toast_service()
            if toast:
                toast.show("Test API Keys", f"Đã kiểm tra {len(keys)} keys", "info")
        self.load_from_backend(backend)

    @Slot(QObject, str)
    def reset(self, backend, key: str = ""):
        if not backend: return
        backend.send_command("key:reset", {"key": key} if key else {})
        self.load_from_backend(backend)

    @Slot(str, QObject)
    def import_from_file(self, file_url: str, backend):
        """Import keys from JSON file."""
        if not backend: return
        try:
            from PySide6.QtCore import QUrl
            path = QUrl(file_url).toLocalFile()
            with open(path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            keys = data.get("keys", [])
            for k in keys:
                backend.send_command("key:add", k)
            self.load_from_backend(backend)
        except Exception as e:
            print(f"[KeyListModel] import error: {e}")

    def export_to_file(self, file_path: str):
        """Export keys to JSON file."""
        try:
            data = {"keys": self._items}
            with open(file_path, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
        except Exception as e:
            print(f"[KeyListModel] export error: {e}")

    @Slot(QObject)
    def clear_all(self, backend):
        if not backend: return
        for k in self._items:
            backend.send_command("key:remove", {"key": k.get("key", "")})
        self.load_from_backend(backend)
