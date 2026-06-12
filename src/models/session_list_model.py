"""SessionListModel — list of Chrome sessions (per profile, login state, health).

Incremental model: _ids_identical check avoids gratuitous beginResetModel on
periodic refresh. When the list is structurally unchanged only dataChanged is
emitted.
"""
import json
from PySide6.QtCore import QAbstractListModel, QModelIndex, Qt, QByteArray, Slot, QObject


class SessionListModel(QAbstractListModel):
    IdRole = Qt.UserRole + 1
    NameRole = Qt.UserRole + 2
    LoggedInRole = Qt.UserRole + 3
    ConsentedRole = Qt.UserRole + 4
    UsedTodayRole = Qt.UserRole + 5
    LastUsedRole = Qt.UserRole + 6
    ErrorRole = Qt.UserRole + 7
    HealthRole = Qt.UserRole + 8

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
        s = self._items[index.row()]
        if role == self.IdRole: return s.get("profileId", "")
        if role == self.NameRole: return s.get("profileName", "")
        if role == self.LoggedInRole: return bool(s.get("isLoggedIn", False))
        if role == self.ConsentedRole: return bool(s.get("isConsented", False))
        if role == self.UsedTodayRole: return int(s.get("usedToday", 0))
        if role == self.LastUsedRole: return int(s.get("lastUsed", 0))
        if role == self.ErrorRole: return s.get("error", "")
        if role == self.HealthRole: return s.get("refreshFailCount", 0)
        return None

    def roleNames(self):
        return {
            self.IdRole: QByteArray(b"id"),
            self.NameRole: QByteArray(b"name"),
            self.LoggedInRole: QByteArray(b"loggedIn"),
            self.ConsentedRole: QByteArray(b"consented"),
            self.UsedTodayRole: QByteArray(b"usedToday"),
            self.LastUsedRole: QByteArray(b"lastUsed"),
            self.ErrorRole: QByteArray(b"error"),
            self.HealthRole: QByteArray(b"health"),
        }

    def _rebuild_index(self):
        self._id_index = {s.get("profileId", ""): i for i, s in enumerate(self._items)}

    def _ids_identical(self, new: list[dict]) -> bool:
        if len(new) != len(self._items):
            return False
        for a, b in zip(self._items, new):
            if a.get("profileId") != b.get("profileId"):
                return False
        return True

    def load_from_backend(self, backend):
        try:
            resp = backend.send_command("session:status")
            result = resp.get("result", {})
            sessions = list(result.get("sessions", []))
            if self._ids_identical(sessions):
                for i, s in enumerate(sessions):
                    self._items[i] = s
                idx_top = self.index(0)
                idx_bot = self.index(len(self._items) - 1) if self._items else idx_top
                self.dataChanged.emit(idx_top, idx_bot, [])
            else:
                self.beginResetModel()
                self._items = sessions
                self._rebuild_index()
                self.endResetModel()
        except Exception as e:
            print(f"[SessionListModel] load error: {e}")

    @Slot(QObject)
    def refresh(self, backend):
        self.load_from_backend(backend)

    @Slot(QObject, str)
    def open_login(self, backend, profile_id: str):
        if not backend: return
        backend.send_command("session:openLogin", {"profileId": profile_id})

    @Slot(QObject)
    def add_session(self, backend):
        if not backend: return
        backend.send_command("session:add")

    @Slot(QObject)
    def refresh_all(self, backend):
        if not backend: return
        backend.send_command("session:refreshAll")

    @Slot(QObject)
    def clone_one(self, backend):
        if not backend: return
        backend.send_command("session:cloneOne")

    def extract_all_sessions(self, backend):
        """Trigger cookie extraction for all 30 Chrome profiles."""
        results = []
        for i in range(1, 31):
            profile_name = f"HyperClip-Chrome-Profile-{i}"
            response = backend.send_command(
                "auth:extractCookies",
                {"profile_name": profile_name},
                timeout=15.0,
            )
            if response and response.get("ok") is not False:
                data = response.get("data", response)
                cookies = data.get("cookies", []) if isinstance(data, dict) else []
                results.append({
                    "profile": profile_name,
                    "ok": True,
                    "cookie_count": len(cookies),
                    "has_sapisid": any(c.get("name") == "SAPISID" for c in cookies) if isinstance(cookies, list) else False,
                })
            else:
                error = response.get("error", "unknown") if isinstance(response, dict) else "unknown"
                results.append({"profile": profile_name, "ok": False, "error": error})
        return results

    def export_to_file(self, file_path: str):
        """Export sessions to JSON file."""
        try:
            data = {"sessions": self._items}
            with open(file_path, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
        except Exception as e:
            print(f"[SessionListModel] export error: {e}")
