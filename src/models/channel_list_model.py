"""ChannelListModel — channel metadata for Sidebar (avatar, name, new-count)."""
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
            color = self.PALETTE[index.row() % len(self.PALETTE)]
            return color
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

    def load_from_backend(self, backend):
        try:
            resp = backend.send_command("channel:list")
            channels = resp.get("result", {}).get("channels", [])
            self.beginResetModel()
            self._items = list(channels)
            self.endResetModel()
        except Exception as e:
            print(f"[ChannelListModel] load error: {e}")

    @Slot(str)
    def add_channel(self, url: str):
        # Stays stubbed — actual flow goes through main app
        pass

    @Slot(str)
    def remove_channel(self, channel_id: str):
        for i, ch in enumerate(self._items):
            if ch.get("id") == channel_id or ch.get("channelId") == channel_id:
                self.beginRemoveRows(QModelIndex(), i, i)
                del self._items[i]
                self.endRemoveRows()
                return

    @Slot(str)
    def toggle_pause(self, channel_id: str):
        for i, ch in enumerate(self._items):
            if ch.get("id") == channel_id or ch.get("channelId") == channel_id:
                ch["paused"] = not ch.get("paused", False)
                idx = self.index(i)
                self.dataChanged.emit(idx, idx, [self.PausedRole])
                return
