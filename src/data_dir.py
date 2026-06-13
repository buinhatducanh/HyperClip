"""Centralized data directory resolver — mirrors crate::store::get_data_dir() logic.

    HYPERCLIP_DATA_DIR env var overrides the default ./data/
"""
import os

_DATA_DIR = None

def get_data_dir() -> str:
    global _DATA_DIR
    if _DATA_DIR is not None:
        return _DATA_DIR
    env = os.environ.get("HYPERCLIP_DATA_DIR")
    if env:
        _DATA_DIR = env
    else:
        local_data = os.path.abspath("data")
        if os.path.isdir(local_data):
            _DATA_DIR = local_data
        else:
            app_data = os.environ.get("APPDATA")
            if app_data:
                _DATA_DIR = os.path.join(app_data, "HyperClip")
            else:
                _DATA_DIR = local_data
    return _DATA_DIR

def get_media_dir() -> str:
    return os.path.join(get_data_dir(), "media")

def get_thumbnails_dir() -> str:
    """Legacy flat thumbnails dir — new code should use per-channel paths."""
    return os.path.join(get_data_dir(), "thumbnails")
