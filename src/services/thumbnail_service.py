"""Download YouTube thumbnail to local storage."""
import os
import urllib.request
from typing import Optional


def get_thumbnail_dir() -> str:
    """Get local thumbnail storage dir."""
    app_data = os.environ.get("APPDATA", os.path.expanduser("~/.config"))
    thumb_dir = os.path.join(app_data, "HyperClip", "thumbnails")
    os.makedirs(thumb_dir, exist_ok=True)
    return thumb_dir


def download_youtube_thumbnail(video_id: str) -> Optional[str]:
    """Download YouTube default thumbnail (maxresdefault.jpg).

    Falls back to hqdefault.jpg if maxres 404.
    Returns local path or None.
    """
    output_path = os.path.join(get_thumbnail_dir(), f"{video_id}.jpg")

    def _download(url: str) -> bool:
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=10) as resp:
                with open(output_path, "wb") as f:
                    f.write(resp.read())
            return os.path.getsize(output_path) > 1024
        except Exception:
            return False

    primary = f"https://i.ytimg.com/vi/{video_id}/maxresdefault.jpg"
    fallback = f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"

    if _download(primary):
        return output_path
    if _download(fallback):
        return output_path
    return None
