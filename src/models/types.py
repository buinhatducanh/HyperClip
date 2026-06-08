"""Mirror of Rust types in crates/hyperclip_ipc/src/types.rs.

Keep in sync manually. Used by Qt models for QML data binding.
"""
from dataclasses import dataclass, field, asdict
from enum import Enum
from typing import Optional
import time


class WorkspaceStatus(str, Enum):
    NEW = "new"
    WAITING = "waiting"
    DOWNLOADING = "downloading"
    READY = "ready"
    RENDERING = "rendering"
    DONE = "done"
    ERROR = "error"


@dataclass
class WorkspaceData:
    id: str
    channel_id: str
    channel_name: str
    title: str
    status: WorkspaceStatus = WorkspaceStatus.NEW
    thumbnail: str = ""
    duration_sec: float = 0.0
    progress: float = 0.0
    quality: int = 1080
    speed: float = 1.0
    file_size: str = ""
    age_label: str = ""
    is_short: bool = True
    trim_start: float = 0.0
    trim_end: float = 0.0
    thumbnail_local: Optional[str] = None
    error_message: Optional[str] = None

    def to_dict(self) -> dict:
        """Serialize for QML consumption."""
        d = asdict(self)
        d["status"] = self.status.value
        return d


@dataclass
class ChannelData:
    id: str
    name: str
    handle: Optional[str] = None
    avatar_url: Optional[str] = None
    paused: bool = False
    new_video_count: int = 0
    last_poll_at: Optional[int] = None
    error_count: int = 0