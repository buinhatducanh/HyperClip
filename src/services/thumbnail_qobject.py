from PySide6.QtCore import QObject, Slot, Signal
from src.services.thumbnail_service import download_youtube_thumbnail


class ThumbnailService(QObject):
    thumbnailReady = Signal(str)

    @Slot(str, result=str)
    def download_thumbnail(self, video_id: str) -> str:
        """Download YouTube thumbnail, return local path or empty string."""
        path = download_youtube_thumbnail(video_id)
        if path:
            self.thumbnailReady.emit(path)
            return path
        return ""
