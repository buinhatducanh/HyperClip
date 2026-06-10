# src/models/workspace_model.py
from PySide6.QtCore import QAbstractListModel, QModelIndex, Qt, QByteArray, Slot


class WorkspaceModel(QAbstractListModel):
    IdRole = Qt.UserRole + 1
    StatusRole = Qt.UserRole + 2
    TitleRole = Qt.UserRole + 3
    ProgressRole = Qt.UserRole + 4
    ChannelRole = Qt.UserRole + 5
    CreatedAtRole = Qt.UserRole + 6
    ThumbnailRole = Qt.UserRole + 7
    RenderedRole = Qt.UserRole + 8
    IsShortRole = Qt.UserRole + 9

    def __init__(self, parent=None):
        super().__init__(parent)
        self._workspaces: list[dict] = []
        self._id_index: dict[str, int] = {}   # ws_id → row
        self._progress_map: dict[str, float] = {}

    def rowCount(self, parent=QModelIndex()):
        if parent.isValid():
            return 0
        return len(self._workspaces)

    def data(self, index, role=Qt.DisplayRole):
        if not index.isValid() or index.row() >= len(self._workspaces):
            return None
        ws = self._workspaces[index.row()]
        ws_id = ws.get("id", "")
        if role == self.IdRole:
            return ws_id
        if role == self.StatusRole:
            return ws.get("status", "pending")
        if role == self.TitleRole:
            return ws.get("title", "")
        if role == self.ProgressRole:
            return self._progress_map.get(ws_id, ws.get("progress", 0.0))
        if role == self.ChannelRole:
            return ws.get("channel_name") or ws.get("channelId", "")
        if role == self.CreatedAtRole:
            return ws.get("created_at", 0)
        if role == self.ThumbnailRole:
            return ws.get("thumbnailLocal") or ws.get("thumbnail") or ws.get("thumbnailUrl") or ""
        if role == self.RenderedRole:
            return ws.get("renderedPath", "")
        if role == self.IsShortRole:
            return ws.get("isShort", True)
        return None

    def roleNames(self):
        return {
            self.IdRole: QByteArray(b"id"),
            self.StatusRole: QByteArray(b"status"),
            self.TitleRole: QByteArray(b"title"),
            self.ProgressRole: QByteArray(b"progress"),
            self.ChannelRole: QByteArray(b"channel_name"),
            self.CreatedAtRole: QByteArray(b"created_at"),
            self.ThumbnailRole: QByteArray(b"thumbnail"),
            self.RenderedRole: QByteArray(b"renderedPath"),
            self.IsShortRole: QByteArray(b"isShort"),
        }

    # ── Index maintenance ──────────────────────────────────────────
    def _rebuild_index(self):
        self._id_index = {ws.get("id", ""): i for i, ws in enumerate(self._workspaces)}

    # ── Incremental load (replaces beginResetModel pattern) ────────
    def load_from_backend(self, backend):
        try:
            resp = backend.send_command("workspace:list")
            workspaces = resp.get("result", {}).get("workspaces", [])
            # Check if it's the same set — fast-path: no-op
            if self._is_identical_set(workspaces):
                return
            self.beginResetModel()
            self._workspaces = workspaces
            self._rebuild_index()
            self.endResetModel()
        except Exception as e:
            print(f"[WorkspaceModel] load error: {e}")

    def _is_identical_set(self, new: list[dict]) -> bool:
        """Return True if new list is same IDs in same order — skip full reset."""
        if len(new) != len(self._workspaces):
            return False
        for old_item, new_item in zip(self._workspaces, new):
            if old_item.get("id") != new_item.get("id"):
                return False
        return True

    def update_workspace(self, ws_id: str, data: dict):
        row = self._id_index.get(ws_id)
        if row is not None and row < len(self._workspaces):
            self._workspaces[row].update(data)
            idx = self.index(row)
            self.dataChanged.emit(idx, idx, [self.StatusRole, self.ProgressRole])
            return
        # Not found — add
        self.add_workspace({"id": ws_id, **data})

    def add_workspace(self, ws: dict):
        ws_id = ws.get("id", "")
        if ws_id in self._id_index:
            # Update in-place instead of duplicate
            self.update_workspace(ws_id, ws)
            return
        self.beginInsertRows(QModelIndex(), len(self._workspaces), len(self._workspaces))
        self._workspaces.append(ws)
        self._id_index[ws_id] = len(self._workspaces) - 1
        self.endInsertRows()

    def set_progress(self, ws_id: str, progress: float):
        self._progress_map[ws_id] = progress
        row = self._id_index.get(ws_id)
        if row is not None and row < len(self._workspaces):
            idx = self.index(row)
            self.dataChanged.emit(idx, idx, [self.ProgressRole])

    @Slot(str, str, str, object)
    def update_field(self, workspace_id: str, field: str, value, client=None):
        field_map = {
            "title": "title",
            "speed": "speed",
            "trimStart": "trim_start",
            "trimEnd": "trim_end",
            "thumbnail": "thumbnail_local",
        }
        local_key = field_map.get(field)
        if local_key is None:
            return

        row = self._id_index.get(workspace_id)
        if row is None:
            return

        idx = self.index(row)
        if field == "speed":
            self._workspaces[row][local_key] = float(value)
        elif field in ("trimStart", "trimEnd"):
            self._workspaces[row][local_key] = float(value)
        else:
            self._workspaces[row][local_key] = value
        self.dataChanged.emit(idx, idx, [])

        if client:
            response = client.send_command(
                "workspace:update",
                {"id": workspace_id, "field": field, "value": value},
                timeout=5.0,
            )
            if response and response.get("warning"):
                from src.models.activity_log_model import ActivityLogModel
                if hasattr(ActivityLogModel, 'add_entry'):
                    ActivityLogModel.add_entry("edit", response["warning"], "warning")
