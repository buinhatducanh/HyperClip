# src/backend/protocol.py
from dataclasses import dataclass
from typing import Optional


@dataclass
class SystemStats:
    ram_used: int
    ram_total: int
    gpu_usage: int
    gpu_temp: int
    gpu_name: str
    gpu_tier: str  # 'high' | 'mid' | 'low' | 'software'
    max_workers: int
    active_workers: int
    network_ip: str
    is_online: bool


@dataclass
class VideoInfo:
    id: str
    title: str
    channel_id: str
    published_at: int


@dataclass
class WorkspaceData:
    id: str
    status: str  # 'pending' | 'downloading' | 'ready' | 'rendering' | 'done' | 'error'
    progress: Optional[float] = None
    source_video: Optional[str] = None
    title: Optional[str] = None
    channel_name: Optional[str] = None
    created_at: Optional[int] = None
