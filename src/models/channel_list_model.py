"""ChannelListModel — channel metadata for Sidebar (avatar, name, new-count).

Incremental model: uses _id_index + _is_identical_set to avoid gratuitous
beginResetModel on periodic refresh.  When the list is structurally unchanged
only dataChanged is emitted.
"""
import json
from PySide6.QtCore import QAbstractListModel, QModelIndex, Qt, QByteArray, Slot, Property, Signal


class ChannelListModel(QAbstractListModel):
    paginationChanged = Signal()

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
        self._filtered_items: list[dict] = []
        self._id_index: dict[str, int] = {}
        self._page = 0
        self._page_size = 10
        self._filter_text = ""

    # ─── Properties ──────────────────────────────────────────────────
    @Property(int, notify=paginationChanged)
    def page(self):
        return self._page

    @page.setter
    def page(self, val):
        val = int(val)
        max_page = self.get_page_count() - 1
        if val < 0:
            val = 0
        elif val > max_page:
            val = max_page
        if self._page != val:
            self.beginResetModel()
            self._page = val
            self.endResetModel()
            self.paginationChanged.emit()

    @Property(int, notify=paginationChanged)
    def pageSize(self):
        return self._page_size

    @pageSize.setter
    def pageSize(self, val):
        val = int(val)
        if val < 1:
            val = 1
        if self._page_size != val:
            self.beginResetModel()
            self._page_size = val
            self._apply_filter_and_pagination()
            self.endResetModel()
            self.paginationChanged.emit()

    @Property(int, notify=paginationChanged)
    def pageCount(self):
        return self.get_page_count()

    def get_page_count(self):
        if not self._filtered_items:
            return 1
        return max(1, (len(self._filtered_items) + self._page_size - 1) // self._page_size)

    @Property(int, notify=paginationChanged)
    def totalCount(self):
        return len(self._filtered_items)

    @Property(str, notify=paginationChanged)
    def filterText(self):
        return self._filter_text

    @filterText.setter
    def filterText(self, val):
        val = str(val)
        if self._filter_text != val:
            self.beginResetModel()
            self._filter_text = val
            self._page = 0  # reset to page 1 on search
            self._apply_filter_and_pagination()
            self.endResetModel()
            self.paginationChanged.emit()

    # ─── Filter & Slice implementation ──────────────────────────────
    def _apply_filter_and_pagination(self):
        # 1. Filter
        if not self._filter_text:
            self._filtered_items = list(self._items)
        else:
            q = self._filter_text.lower()
            self._filtered_items = [
                ch for ch in self._items
                if q in (ch.get("name") or "").lower() or q in (ch.get("handle") or "").lower() or q in (ch.get("channelId") or "").lower()
            ]
        
        # 2. Bound page
        max_page = self.get_page_count() - 1
        if self._page > max_page:
            self._page = max_page
        elif self._page < 0:
            self._page = 0

    def rowCount(self, parent=QModelIndex()):
        if parent.isValid():
            return 0
        start = self._page * self._page_size
        if start >= len(self._filtered_items):
            return 0
        return min(self._page_size, len(self._filtered_items) - start)

    def data(self, index, role=Qt.DisplayRole):
        if not index.isValid():
            return None
        actual_row = self._page * self._page_size + index.row()
        if actual_row >= len(self._filtered_items):
            return None
        ch = self._filtered_items[actual_row]
        if role == self.IdRole:
            return ch.get("id", "")
        if role == self.NameRole:
            return ch.get("name") or ch.get("handle") or ch.get("channelId", "")
        if role == self.ChannelIdRole:
            return ch.get("channelId", "")
        if role == self.AvatarUrlRole:
            return ch.get("avatarUrl", "")
        if role == self.AvatarColorRole:
            # Consistent color index based on the full list position, not filtered position
            original_row = self._items.index(ch) if ch in self._items else actual_row
            return self.PALETTE[original_row % len(self.PALETTE)]
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
            self.beginResetModel()
            self._items = list(channels)
            self._rebuild_index()
            self._apply_filter_and_pagination()
            self.endResetModel()
            self.paginationChanged.emit()
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
                self.beginResetModel()
                del self._items[i]
                self._rebuild_index()
                self._apply_filter_and_pagination()
                self.endResetModel()
                self.paginationChanged.emit()
                return

    @Slot(str)
    def toggle_pause(self, channel_id: str):
        for i, ch in enumerate(self._items):
            if ch.get("id") == channel_id or ch.get("channelId") == channel_id:
                ch["paused"] = not ch.get("paused", False)
                # Find in filtered items to emit dataChanged for the current view
                for f_idx, f_ch in enumerate(self._filtered_items):
                    if f_ch.get("id") == channel_id or f_ch.get("channelId") == channel_id:
                        page_start = self._page * self._page_size
                        page_end = page_start + self._page_size
                        if page_start <= f_idx < page_end:
                            row_relative = f_idx - page_start
                            q_idx = self.index(row_relative)
                            self.dataChanged.emit(q_idx, q_idx, [self.PausedRole])
                return

    @Slot(str, 'QVariant')
    def import_from_file(self, file_url: str, backend):
        """Import channels from JSON file."""
        if not backend: return
        try:
            from PySide6.QtCore import QUrl
            path = QUrl(file_url).toLocalFile()
            with open(path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            
            channels = []
            if isinstance(data, list):
                channels = data
            elif isinstance(data, dict):
                target = data.get("result", data)
                if isinstance(target, dict):
                    channels = target.get("channels", [])
                elif isinstance(target, list):
                    channels = target
            
            if not isinstance(channels, list):
                channels = []
                
            for ch in channels:
                if isinstance(ch, str):
                    backend.send_command("channel:add", {"url": ch})
                elif isinstance(ch, dict):
                    url = ch.get("url") or ch.get("handle") or ch.get("channelId") or ch.get("id")
                    if url:
                        backend.send_command("channel:add", {"url": url})
            self.load_from_backend(backend)
        except Exception as e:
            print(f"[ChannelListModel] import error: {e}")

    def export_to_file(self, file_path: str):
        """Export channels to JSON file."""
        try:
            data = {"channels": self._items}
            with open(file_path, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
        except Exception as e:
            print(f"[ChannelListModel] export error: {e}")
