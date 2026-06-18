"""LogFileModel — reads backend log files via IPC."""
from PySide6.QtCore import QAbstractListModel, QModelIndex, Qt, QByteArray, Slot, Signal, QObject, Property


class LogFileModel(QObject):
    """Model for a single log file content — lines with levels."""

    FileNameRole = Qt.UserRole + 1
    LinesRole = Qt.UserRole + 2
    LoadingRole = Qt.UserRole + 3

    # Qt property signals
    loadingChanged = Signal()
    linesChanged = Signal()
    fileNameChanged = Signal()

    def __init__(self, parent=None, backend=None):
        super().__init__(parent)
        self._backend = backend
        self._lines = []
        self._loading = False
        self._file_name = ""

    @Property(list, notify=linesChanged)
    def lines(self):
        return self._lines

    @Property(bool, notify=loadingChanged)
    def loading(self):
        return self._loading

    @Property(str, notify=fileNameChanged)
    def file_name(self):
        return self._file_name

    @Slot(str, int)
    def load(self, file_name: str, max_lines: int = 500):
        if not self._backend:
            return
        self._loading = True
        self.loadingChanged.emit()
        self._file_name = file_name
        self.fileNameChanged.emit()

        # Use IPC to read log file
        resp = self._backend.send_command("logs:read", {"file": file_name, "max_lines": max_lines})
        if resp.get("ok"):
            entries = resp.get("result", {}).get("entries", [])
            self._lines = entries
        else:
            self._lines = [f"Error: {resp.get('error', 'unknown')}"]
        self._loading = False
        self.loadingChanged.emit()
        self.linesChanged.emit()

    @Slot()
    def clear(self):
        self._lines = []
        self._file_name = ""
        self.fileNameChanged.emit()
        self.linesChanged.emit()


class LogFilesListModel(QAbstractListModel):
    """List of available log files in the logs directory."""
    NameRole = Qt.UserRole + 1
    SizeRole = Qt.UserRole + 2
    ModifiedRole = Qt.UserRole + 3

    def __init__(self, parent=None, backend=None):
        super().__init__(parent)
        self._backend = backend
        self._files = []

    def rowCount(self, parent=QModelIndex()):
        if parent.isValid():
            return 0
        return len(self._files)

    def data(self, index, role=Qt.DisplayRole):
        if not index.isValid() or index.row() >= len(self._files):
            return None
        f = self._files[index.row()]
        if role == self.NameRole:
            return f.get("name", "")
        if role == self.SizeRole:
            return int(f.get("size", 0))
        if role == self.ModifiedRole:
            return f.get("modified", "")
        return None

    def roleNames(self):
        return {
            self.NameRole: QByteArray(b"name"),
            self.SizeRole: QByteArray(b"size"),
            self.ModifiedRole: QByteArray(b"modified"),
        }

    @Slot()
    def refresh(self):
        if not self._backend:
            return
        resp = self._backend.send_command("logs:list")
        if resp.get("ok"):
            self.beginResetModel()
            self._files = resp.get("result", {}).get("files", [])
            self.endResetModel()

    @Slot(str, result=int)
    def get_index(self, name: str):
        for i, f in enumerate(self._files):
            if f.get("name") == name:
                return i
        return -1