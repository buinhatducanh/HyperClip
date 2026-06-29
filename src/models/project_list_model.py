"""ProjectListModel — OAuth projects (GCP) used for Data API v3 fallback.

Incremental model: _ids_identical check avoids gratuitous beginResetModel.
"""
import json
from PySide6.QtCore import QAbstractListModel, QModelIndex, Qt, QByteArray, Slot, QObject


class ProjectListModel(QAbstractListModel):
    IdRole = Qt.UserRole + 1
    NameRole = Qt.UserRole + 2
    HealthyRole = Qt.UserRole + 3
    QuotaUsedRole = Qt.UserRole + 4
    QuotaLimitRole = Qt.UserRole + 5
    ErrorRole = Qt.UserRole + 6
    LastRefreshRole = Qt.UserRole + 7

    def __init__(self, parent=None, backend=None):
        super().__init__(parent)
        self._items: list[dict] = []
        self._id_index: dict[str, int] = {}
        self._backend = backend

    def rowCount(self, parent=QModelIndex()):
        if parent.isValid():
            return 0
        return len(self._items)

    def data(self, index, role=Qt.DisplayRole):
        if not index.isValid() or index.row() >= len(self._items):
            return None
        p = self._items[index.row()]
        if role == self.IdRole: return p.get("projectId", "")
        if role == self.NameRole: return p.get("name", "")
        if role == self.HealthyRole: return bool(p.get("healthy", False))
        if role == self.QuotaUsedRole: return int(p.get("quotaUsed", 0))
        if role == self.QuotaLimitRole: return int(p.get("quotaLimit", 10000))
        if role == self.ErrorRole: return p.get("error", "")
        if role == self.LastRefreshRole: return int(p.get("lastRefresh", 0))
        return None

    def roleNames(self):
        return {
            self.IdRole: QByteArray(b"id"),
            self.NameRole: QByteArray(b"name"),
            self.HealthyRole: QByteArray(b"healthy"),
            self.QuotaUsedRole: QByteArray(b"quotaUsed"),
            self.QuotaLimitRole: QByteArray(b"quotaLimit"),
            self.ErrorRole: QByteArray(b"error"),
            self.LastRefreshRole: QByteArray(b"lastRefresh"),
        }

    def _rebuild_index(self):
        self._id_index = {p.get("projectId", ""): i for i, p in enumerate(self._items)}

    def _ids_identical(self, new: list[dict]) -> bool:
        if len(new) != len(self._items):
            return False
        for a, b in zip(self._items, new):
            if a.get("projectId") != b.get("projectId"):
                return False
        return True

    @Slot()
    @Slot(QObject)
    def load_from_backend(self, backend=None):
        backend_to_use = backend or self._backend
        if not backend_to_use:
            return
        try:
            resp = backend_to_use.send_command("project:list")
            projects = resp.get("result", [])
            if not isinstance(projects, list):
                projects = []
            if self._ids_identical(projects):
                for i, p in enumerate(projects):
                    self._items[i] = p
                idx_top = self.index(0)
                idx_bot = self.index(len(self._items) - 1) if self._items else idx_top
                self.dataChanged.emit(idx_top, idx_bot, [])
            else:
                self.beginResetModel()
                self._items = projects
                self._rebuild_index()
                self.endResetModel()
        except Exception as e:
            print(f"[ProjectListModel] load error: {e}")

    @Slot()
    @Slot(QObject)
    def refresh(self, backend=None):
        self.load_from_backend(backend or self._backend)

    @Slot(str)
    @Slot(QObject, str)
    def remove(self, backend_or_id, project_id=None):
        if project_id is None:
            project_id = backend_or_id
            backend_to_use = self._backend
        else:
            backend_to_use = backend_or_id or self._backend

        if not backend_to_use or not project_id: return
        backend_to_use.send_command("project:remove", {"projectId": project_id})
        self.load_from_backend(backend_to_use)

    @Slot(str)
    @Slot(QObject, str)
    def repair(self, backend_or_id, project_id=None):
        if project_id is None:
            project_id = backend_or_id
            backend_to_use = self._backend
        else:
            backend_to_use = backend_or_id or self._backend

        if not backend_to_use or not project_id: return
        backend_to_use.send_command("project:repair", {"projectId": project_id})

    @Slot(str)
    @Slot(QObject, str)
    def reauthorize(self, backend_or_id, project_id=None):
        if project_id is None:
            project_id = backend_or_id
            backend_to_use = self._backend
        else:
            backend_to_use = backend_or_id or self._backend

        if not backend_to_use or not project_id: return
        backend_to_use.send_command("project:reauthorize", {"projectId": project_id})

    @Slot()
    @Slot(QObject)
    def batch_repair(self, backend=None):
        backend_to_use = backend or self._backend
        if not backend_to_use: return
        ids = [p.get("projectId", "") for p in self._items]
        backend_to_use.send_command("project:batchRepair", {"projectIds": ids})

    @Slot()
    @Slot(QObject)
    def test_all(self, backend=None):
        backend_to_use = backend or self._backend
        if not backend_to_use: return
        resp = backend_to_use.send_command("project:testAll")
        if resp and resp.get("ok") is not False:
            projects = resp.get("result", {}).get("projects", [])
            from src.services.toast_service import get_toast_service
            toast = get_toast_service()
            if toast:
                toast.show("Test Projects", f"Đã kiểm tra {len(projects)} projects", "info")
        self.load_from_backend(backend_to_use)

    @Slot(str)
    @Slot(str, QObject)
    def import_from_file(self, file_url: str, backend=None):
        """Import projects from JSON file."""
        backend_to_use = backend or self._backend
        if not backend_to_use: return
        try:
            from PySide6.QtCore import QUrl
            path = QUrl(file_url).toLocalFile()
            with open(path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            projects = data.get("projects", [])
            for p in projects:
                backend_to_use.send_command("project:add", p)
            self.load_from_backend(backend_to_use)
        except Exception as e:
            print(f"[ProjectListModel] import error: {e}")

    def export_to_file(self, file_path: str):
        """Export projects to JSON file."""
        try:
            data = {"projects": self._items}
            with open(file_path, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
        except Exception as e:
            print(f"[ProjectListModel] export error: {e}")

    @Slot(QObject)
    def clear_all(self, backend):
        if not backend: return
        for p in self._items:
            backend.send_command("project:remove", {"projectId": p.get("projectId", "")})
        self.load_from_backend(backend)
