# src/models/workspace_model.py
from PySide6.QtCore import QAbstractListModel, Signal, QModelIndex, Qt, QByteArray


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
            return ws.get("thumbnail", "")
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

    def load_from_backend(self, backend):
        try:
            resp = backend.send_command("workspace:list")
            workspaces = resp.get("result", {}).get("workspaces", [])
            self.beginResetModel()
            self._workspaces = workspaces
            self.endResetModel()
        except Exception as e:
            print(f"[WorkspaceModel] load error: {e}")

    def update_workspace(self, ws_id: str, data: dict):
        for i, ws in enumerate(self._workspaces):
            if ws.get("id") == ws_id:
                ws.update(data)
                idx = self.index(i)
                self.dataChanged.emit(idx, idx, [self.StatusRole, self.ProgressRole])
                return
        # Not found — add
        self.add_workspace({"id": ws_id, **data})

    def add_workspace(self, ws: dict):
        self.beginInsertRows(QModelIndex(), len(self._workspaces), len(self._workspaces))
        self._workspaces.append(ws)
        self.endInsertRows()

    def set_progress(self, ws_id: str, progress: float):
        self._progress_map[ws_id] = progress
        for i, ws in enumerate(self._workspaces):
            if ws.get("id") == ws_id:
                idx = self.index(i)
                self.dataChanged.emit(idx, idx, [self.ProgressRole])
                return
