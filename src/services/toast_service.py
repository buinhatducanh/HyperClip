"""ToastService — bridge for showing toast notifications from QML or Python.

Usage from QML:
    toastService.show("Title", "Message", "success")
    toastService.show("Title", "Message", "error")
    toastService.show("Title", "Message", "info")

Levels: info, success, warn, error
"""
from PySide6.QtCore import QObject, Signal, Slot


class ToastService(QObject):
    """QML-accessible toast notification service."""

    toastRequested = Signal(str, str, str)  # title, message, level

    @Slot(str, str, str)
    def show(self, title: str, message: str, level: str = "info"):
        self.toastRequested.emit(title, message, level)


_toast_service: ToastService | None = None

def get_toast_service() -> ToastService:
    global _toast_service
    if _toast_service is None:
        _toast_service = ToastService()
    return _toast_service
