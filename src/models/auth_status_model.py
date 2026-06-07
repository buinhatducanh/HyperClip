"""AuthStatusModel — cookie count, OAuth ready, account name."""
from PySide6.QtCore import QObject, Signal, Slot, Property


class AuthStatusModel(QObject):
    changed = Signal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self._is_ready: bool = False
        self._cookie_count: int = 0
        self._logged_out: bool = True
        self._account_name: str = ""
        self._oauth_ready: bool = False
        self._cookie_critical: bool = False
        self._cookie_error: str = ""

    def load_from_dict(self, d: dict):
        self._is_ready = bool(d.get("isReady", False))
        self._cookie_count = int(d.get("cookieCount", 0))
        self._logged_out = bool(d.get("loggedOut", True))
        self._account_name = d.get("accountName") or ""
        self._oauth_ready = bool(d.get("oauthReady", False))
        self._cookie_critical = bool(d.get("cookieCritical", False))
        self._cookie_error = d.get("cookieError") or ""
        self.changed.emit()

    @Slot()
    def refresh_from_backend(self, backend):
        if not backend:
            return
        resp = backend.send_command("auth:status")
        result = resp.get("result", {})
        if result:
            self.load_from_dict(result)

    @Slot()
    def start_oauth(self, backend):
        if not backend:
            return
        resp = backend.send_command("auth:startOAuth")
        result = resp.get("result", {})
        if result:
            self.load_from_dict(result)

    @Slot()
    def logout(self, backend):
        if not backend:
            return
        backend.send_command("auth:logout")
        self.refresh_from_backend(backend)

    @Property(bool, notify=changed)
    def isReady(self): return self._is_ready
    @Property(int, notify=changed)
    def cookieCount(self): return self._cookie_count
    @Property(bool, notify=changed)
    def loggedOut(self): return self._logged_out
    @Property(str, notify=changed)
    def accountName(self): return self._account_name
    @Property(bool, notify=changed)
    def oauthReady(self): return self._oauth_ready
    @Property(bool, notify=changed)
    def cookieCritical(self): return self._cookie_critical
    @Property(str, notify=changed)
    def cookieError(self): return self._cookie_error
