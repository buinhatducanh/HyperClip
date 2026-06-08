import pytest
from src.models.types import WorkspaceStatus, WorkspaceData


def test_workspace_status_values():
    assert WorkspaceStatus.NEW == "new"
    assert WorkspaceStatus.DOWNLOADING == "downloading"
    assert WorkspaceStatus.RENDERING == "rendering"
    assert WorkspaceStatus.DONE == "done"


def test_workspace_data_defaults():
    ws = WorkspaceData(
        id="ws-1",
        channel_id="UC1",
        channel_name="Test",
        title="Test Video",
    )
    assert ws.status == WorkspaceStatus.NEW
    assert ws.speed == 1.0
    assert ws.trim_start == 0.0
    assert ws.trim_end == 0.0
    assert ws.quality == 1080
    assert ws.progress == 0.0


def test_workspace_data_to_dict():
    ws = WorkspaceData(
        id="ws-1",
        channel_id="UC1",
        channel_name="Test",
        title="Test Video",
    )
    d = ws.to_dict()
    assert d["id"] == "ws-1"
    assert d["status"] == "new"
    assert d["speed"] == 1.0