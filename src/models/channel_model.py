# src/models/channel_model.py
from PySide6.QtCore import QAbstractListModel, QModelIndex, Qt, QByteArray


class ChannelModel(QAbstractListModel):
    IdRole = Qt.UserRole + 1
    NameRole = Qt.UserRole + 2
    HandleRole = Qt.UserRole + 3
    ColorRole = Qt.UserRole + 4
    ChannelIdRole = Qt.UserRole + 5
    EnabledRole = Qt.UserRole + 6
    AvatarRole = Qt.UserRole + 7

    def __init__(self, parent=None):
        super().__init__(parent)
        self._channels: list[dict] = []

    def rowCount(self, parent=QModelIndex()):
        if parent.isValid():
            return 0
        return len(self._channels)

    def data(self, index, role=Qt.DisplayRole):
        if not index.isValid() or index.row() >= len(self._channels):
            return None
        ch = self._channels[index.row()]
        if role == self.IdRole:
            return ch.get("id", "")
        if role == self.NameRole:
            return ch.get("name", "")
        if role == self.HandleRole:
            return ch.get("handle", "")
        if role == self.ColorRole:
            return ch.get("avatarColor", "#00B4FF")
        if role == self.ChannelIdRole:
            return ch.get("channelId", "")
        if role == self.EnabledRole:
            return ch.get("enabled", True)
        if role == self.AvatarRole:
            return ch.get("avatarUrl", "")
        return None

    def roleNames(self):
        return {
            self.IdRole: QByteArray(b"id"),
            self.NameRole: QByteArray(b"name"),
            self.HandleRole: QByteArray(b"handle"),
            self.ColorRole: QByteArray(b"avatarColor"),
            self.ChannelIdRole: QByteArray(b"channelId"),
            self.EnabledRole: QByteArray(b"enabled"),
            self.AvatarRole: QByteArray(b"avatarUrl"),
        }

    def load_from_backend(self, backend):
        try:
            resp = backend.send_command("channel:list")
            channels = resp.get("result", {}).get("channels", [])
            self.beginResetModel()
            self._channels = channels
            self.endResetModel()
        except Exception as e:
            print(f"[ChannelModel] load error: {e}")

    def add_channel(self, ch: dict):
        self.beginInsertRows(QModelIndex(), len(self._channels), len(self._channels))
        self._channels.append(ch)
        self.endInsertRows()

    def remove_channel(self, channel_id: str):
        for i, ch in enumerate(self._channels):
            if ch.get("id") == channel_id or ch.get("channelId") == channel_id:
                self.beginRemoveRows(QModelIndex(), i, i)
                del self._channels[i]
                self.endRemoveRows()
                return
