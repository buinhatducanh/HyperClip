"""ChannelListModel — channel metadata for Sidebar (avatar, name, new-count).

Incremental model: uses _id_index + _is_identical_set to avoid gratuitous
beginResetModel on periodic refresh.  When the list is structurally unchanged
only dataChanged is emitted.
"""
from PySide6.QtCore import QAbstractListModel, QModelIndex, Qt, QByteArray, Slot


class ChannelListModel(QAbstractListModel):
    IdRole = Qt.UserRole + 1
    NameRole = Qt.UserRole + 2
    ChannelIdRole = Qt.UserRole + 3
    AvatarUrlRole = Qt.UserRole + 4
    AvatarColorRole = Qt.UserRole + 5
    NewCountRole = Qt.UserRole + 6
    PausedRole = Qt.UserRole + 7

    PALETTE = ["#00B4FF", "#00FF88", "#FF6B6B", "#FFD93D", "#A78BFA", "#FB7185", "#34D399"]

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
        ch = self._items[index.row()]
        if role == self.IdRole:
            return ch.get("id", "")
        if role == self.NameRole:
            return ch.get("name") or ch.get("handle") or ch.get("channelId", "")
        if role == self.ChannelIdRole:
            return ch.get("channelId", "")
        if role == self.AvatarUrlRole:
            return ch.get("avatarUrl", "")
        if role == self.AvatarColorRole:
            return self.PALETTE[index.row() % len(self.PALETTE)]
        if role == self.NewCountRole:
            return int(ch.get("newCount", 0))
        if role == self.PausedRole:
            return bool(ch.get("paused", False))
        return None

    def roleNames(self):
        return {
            self.IdRole: QByteArray(b"id"),
            self.NameRole: QByteArray(b"name"),
            self.ChannelIdRole: QByteArray(b"channelId"),
            self.AvatarUrlRole: QByteArray(b"avatarUrl"),
            self.AvatarColorRole: QByteArray(b"avatarColor"),
            self.NewCountRole: QByteArray(b"newCount"),
            self.PausedRole: QByteArray(b"paused"),
        }

    def _rebuild_index(self):
        self._id_index = {ch.get("id", ""): i for i, ch in enumerate(self._items)}

    def _ids_identical(self, new: list[dict]) -> bool:
        if len(new) != len(self._items):
            return False
        for a, b in zip(self._items, new):
            if a.get("id") != b.get("id"):
                return False
        return True

    def load_from_backend(self, backend):
        try:
            resp = backend.send_command("channel:list")
            channels = resp.get("result", {}).get("channels", [])
            if self._ids_identical(channels):
                # Update metadata in-place instead of full reset
                for i, ch in enumerate(channels):
                    self._items[i] = ch
                idx_top = self.index(0)
                idx_bot = self.index(len(self._items) - 1) if self._items else idx_top
                self.dataChanged.emit(idx_top, idx_bot, [])
            else:
                self.beginResetModel()
                self._items = list(channels)
                self._rebuild_index()
                self.endResetModel()
        except Exception as e:
            print(f"[ChannelListModel] load error: {e}")

    @Slot(str)
    def add_channel(self, url: str):
        from src.backend.client import get_client
        client = get_client()
        if not client:
            return
        client.send_command("channel:add", {"url": url})
        self.load_from_backend(client)

    @Slot(str)
    def remove_channel(self, channel_id: str):
        for i, ch in enumerate(self._items):
            if ch.get("id") == channel_id or ch.get("channelId") == channel_id:
                self.beginRemoveRows(QModelIndex(), i, i)
                del self._items[i]
                self.endRemoveRows()
                self._rebuild_index()
                return

    @Slot(str)
    def toggle_pause(self, channel_id: str):
        for i, ch in enumerate(self._items):
            if ch.get("id") == channel_id or ch.get("channelId") == channel_id:
                ch["paused"] = not ch.get("paused", False)
                idx = self.index(i)
                self.dataChanged.emit(idx, idx, [self.PausedRole])
                return
