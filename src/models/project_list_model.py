"""ProjectListModel — OAuth projects (GCP) used for Data API v3 fallback.

Incremental model: _ids_identical check avoids gratuitous beginResetModel.
"""
from PySide6.QtCore import QAbstractListModel, QModelIndex, Qt, QByteArray, Slot


class ProjectListModel(QAbstractListModel):
    IdRole = Qt.UserRole + 1
    NameRole = Qt.UserRole + 2
    HealthyRole = Qt.UserRole + 3
    QuotaUsedRole = Qt.UserRole + 4
    QuotaLimitRole = Qt.UserRole + 5
    ErrorRole = Qt.UserRole + 6
    LastRefreshRole = Qt.UserRole + 7

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

    def load_from_backend(self, backend):
        try:
            resp = backend.send_command("project:list")
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
    def refresh(self, backend):
        self.load_from_backend(backend)

    @Slot(str)
    def remove(self, backend, project_id: str):
        if not backend: return
        backend.send_command("project:remove", {"projectId": project_id})
        self.load_from_backend(backend)

    @Slot(str)
    def repair(self, backend, project_id: str):
        if not backend: return
        backend.send_command("project:repair", {"projectId": project_id})

    @Slot(str)
    def reauthorize(self, backend, project_id: str):
        if not backend: return
        backend.send_command("project:reauthorize", {"projectId": project_id})

    @Slot()
    def batch_repair(self, backend):
        if not backend: return
        ids = [p.get("projectId", "") for p in self._items]
        backend.send_command("project:batchRepair", {"projectIds": ids})

    @Slot()
    def test_all(self, backend):
        if not backend: return
        backend.send_command("project:testAll")
        self.load_from_backend(backend)
