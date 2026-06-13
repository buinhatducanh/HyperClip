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
    DurationRole = Qt.UserRole + 10
    QualityRole = Qt.UserRole + 11
    SpeedRole = Qt.UserRole + 12
    FileSizeRole = Qt.UserRole + 13
    AgeLabelRole = Qt.UserRole + 14

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
            return int(ws.get("created_at", 0))
        if role == self.ThumbnailRole:
            t = ws.get("thumbnailLocal") or ws.get("thumbnail") or ws.get("thumbnailUrl") or ""
            if t and not (t.startswith("http") or t.startswith("file://") or t.startswith("qrc:")):
                import os
                if os.path.exists(t):
                    return "file:///" + t.replace("\\", "/")
                else:
                    video_id = ws.get("video_id") or ws.get("videoId")
                    if video_id:
                        return f"https://img.youtube.com/vi/{video_id}/mqdefault.jpg"
                    return ""
            return t
        if role == self.RenderedRole:
            t = ws.get("renderedPath", "")
            if t and not (t.startswith("http") or t.startswith("file://") or t.startswith("qrc:")):
                return "file:///" + t.replace("\\", "/")
            return t
        if role == self.IsShortRole:
            return bool(ws.get("isShort", True))
        if role == self.DurationRole:
            return int(ws.get("durationSec") or ws.get("duration_sec", 0))
        if role == self.QualityRole:
            return int(ws.get("quality", 1080))
        if role == self.SpeedRole:
            return float(ws.get("speed", 1.0))
        if role == self.FileSizeRole:
            size = ws.get("downloadedSize") or ws.get("fileSize") or ws.get("file_size", 0)
            if size > 1024 * 1024:
                return f"{size / (1024 * 1024):.1f}MB"
            elif size > 1024:
                return f"{size / 1024:.1f}KB"
            return f"{size}B"
        if role == self.AgeLabelRole:
            # Calculate age from detectedAt or createdAt
            detected = ws.get("detectedAt") or ws.get("detected_at") or ws.get("created_at", 0)
            if detected > 0:
                from time import time
                age_sec = int(time() * 1000 - detected)
                if age_sec < 60000:
                    return f"{age_sec // 1000}s"
                elif age_sec < 3600000:
                    return f"{age_sec // 60000}m"
                elif age_sec < 86400000:
                    return f"{age_sec // 3600000}h"
                else:
                    return f"{age_sec // 86400000}d"
            return ""
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
            self.DurationRole: QByteArray(b"durationSec"),
            self.QualityRole: QByteArray(b"quality"),
            self.SpeedRole: QByteArray(b"speed"),
            self.FileSizeRole: QByteArray(b"fileSize"),
            self.AgeLabelRole: QByteArray(b"ageLabel"),
        }

    # ── Index maintenance ──────────────────────────────────────────
    def _rebuild_index(self):
        self._id_index = {ws.get("id", ""): i for i, ws in enumerate(self._workspaces)}

    # ── Incremental load (replaces beginResetModel pattern) ────────
    def load_from_backend(self, backend):
        try:
            resp = backend.send_command("workspace:list")
            workspaces = resp.get("result", {}).get("workspaces", [])
            # Normalize fields from Rust format (camelCase) to model format
            normalized_workspaces = []
            for ws in workspaces:
                normalized = {
                    "id": ws.get("id", ""),
                    "status": ws.get("status", "pending"),
                    "title": ws.get("title", ""),
                    "progress": ws.get("progress"),
                    "channel_name": ws.get("channelName", ""),
                    "thumbnail": ws.get("thumbnailLocal", "") or ws.get("thumbnail", "") or ws.get("thumbnailUrl", ""),
                    "created_at": ws.get("createdAt", 0),
                    "published_at": ws.get("publishedAt", 0),
                    "durationSec": ws.get("durationSec", 0),
                    "quality": ws.get("quality", 1080),
                    "speed": ws.get("videoSpeed") if ws.get("videoSpeed") is not None else ws.get("video_speed", 1.0),
                    "isShort": ws.get("isShort", True),
                    "downloadedPath": ws.get("downloadedPath", ""),
                    "downloadedSize": ws.get("fileSize", 0) or ws.get("file_size", 0),
                    "renderedPath": ws.get("renderedPath", ""),
                    "width": ws.get("width", 0),
                    "height": ws.get("height", 0),
                }
                normalized_workspaces.append(normalized)

            # Check if it's the same set — fast-path: no-op
            if self._is_identical_set(normalized_workspaces):
                return
            self.beginResetModel()
            self._workspaces = normalized_workspaces
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
            # Normalize field names from camelCase (Rust) to snake_case (model)
            normalized = {}
            for k, v in data.items():
                if k in ("downloadedPath", "downloaded_path"):
                    normalized["downloadedPath"] = v
                elif k in ("downloadedSize", "downloaded_size", "fileSize", "file_size"):
                    normalized["downloadedSize"] = v
                elif k in ("thumbnailLocal", "thumbnail_local"):
                    normalized["thumbnailLocal"] = v
                elif k == "width":
                    normalized["width"] = v
                elif k == "height":
                    normalized["height"] = v
                elif k in ("renderedPath", "rendered_path"):
                    normalized["renderedPath"] = v
                elif k in ("videoSpeed", "video_speed"):
                    normalized["speed"] = v
                elif k in ("trimStart", "trim_start"):
                    normalized["trimStart"] = v
                elif k in ("trimEnd", "trim_end"):
                    normalized["trimEnd"] = v
                elif k in ("isShort", "is_short"):
                    normalized["isShort"] = v
                elif k in ("durationSec", "duration_sec"):
                    normalized["durationSec"] = v
                elif k in ("channelName", "channel_name"):
                    normalized["channel_name"] = v
                elif k in ("createdAt", "created_at"):
                    normalized["created_at"] = v
                elif k in ("publishedAt", "published_at"):
                    normalized["published_at"] = v
                else:
                    normalized[k] = v

            self._workspaces[row].update(normalized)
            idx = self.index(row)
            # Emit all roles that could have changed
            self.dataChanged.emit(idx, idx, [
                self.StatusRole, self.ProgressRole, self.ThumbnailRole,
                self.RenderedRole, self.DurationRole, self.QualityRole,
                self.SpeedRole, self.FileSizeRole, self.IsShortRole
            ])
            return
        # Not found — add
        self.add_workspace({"id": ws_id, **data})

    def add_workspace(self, ws: dict):
        ws_id = ws.get("id", "")
        if ws_id in self._id_index:
            # Update in-place instead of duplicate
            self.update_workspace(ws_id, ws)
            return
        self.beginInsertRows(QModelIndex(), 0, 0)
        self._workspaces.insert(0, ws)
        self._rebuild_index()
        self.endInsertRows()

    def set_progress(self, ws_id: str, progress: float):
        self._progress_map[ws_id] = progress
        row = self._id_index.get(ws_id)
        if row is not None and row < len(self._workspaces):
            idx = self.index(row)
            self.dataChanged.emit(idx, idx, [self.ProgressRole])

    @Slot(str, str, 'QVariant', object)
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
