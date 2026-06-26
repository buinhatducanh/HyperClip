"""
Tests for render_stars JSON-RPC daemon architecture.

Tests written BEFORE implementation (TDD).
"""

import json
import time
import threading
from unittest.mock import MagicMock, patch, mock_open
from io import BytesIO

import pytest

from render_stars import (
    RenderStarsDaemon,
    StarsConfig,
    StarPlacement,
    StarLayer,
    render_video,
    calculate_star_config,
)


# --- Fixtures ---

@pytest.fixture
def minimal_video(tmp_path):
    """Create a minimal MP4 video for testing."""
    import subprocess
    video_path = tmp_path / "test.mp4"
    cmd = [
        "ffmpeg", "-y", "-f", "lavfi", "-i",
        "color=c=black:s=1920x1080:d=1,format=yuv420p",
        "-c:v", "libx264", "-preset", "ultrafast", "-crf", "28",
        "-t", "1", "-r", "24",
        str(video_path),
    ]
    subprocess.run(cmd, capture_output=True, check=True)
    return video_path


@pytest.fixture
def minimal_video_2s(tmp_path):
    """Create a 2-second MP4 video."""
    import subprocess
    video_path = tmp_path / "test2s.mp4"
    cmd = [
        "ffmpeg", "-y", "-f", "lavfi", "-i",
        "color=c=black:s=1920x1080:d=2,format=yuv420p",
        "-c:v", "libx264", "-preset", "ultrafast", "-crf", "28",
        "-t", "2", "-r", "24",
        str(video_path),
    ]
    subprocess.run(cmd, capture_output=True, check=True)
    return video_path


@pytest.fixture
def default_config():
    return StarsConfig()


@pytest.fixture
def custom_config():
    return StarsConfig(
        duration_pct=20.0,
        star_min_px=24,
        star_max_px=80,
        star_min_alpha=0.6,
        star_max_alpha=1.0,
        drift_px_sec=30,
        seed=42,
        output_suffix="_tested",
        max_workers=2,
    )


# --- StarsConfig tests ---

class TestStarsConfig:
    def test_defaults(self, default_config):
        cfg = default_config
        assert cfg.duration_pct == 15.0
        assert cfg.star_min_px == 32
        assert cfg.star_max_px == 100
        assert cfg.star_min_alpha == 0.4
        assert cfg.star_max_alpha == 1.0
        assert cfg.drift_px_sec == 40.0
        assert cfg.seed is None
        assert cfg.max_workers == 4
        assert cfg.fade_in_sec == 1.0
        assert cfg.fade_out_sec == 1.5
        assert cfg.fade_start_pct == 0.05
        assert cfg.fade_end_pct == 0.95

    def test_custom_config(self, custom_config):
        cfg = custom_config
        assert cfg.duration_pct == 20.0
        assert cfg.star_min_px == 24
        assert cfg.seed == 42
        assert cfg.output_suffix == "_tested"


# --- StarPlacement tests ---

class TestStarPlacement:
    def test_frozen(self):
        s = StarPlacement(x=100.0, y=200.0, size=48, alpha=0.8, drift=0.5)
        with pytest.raises(AttributeError):
            s.x = 999.0


# --- StarLayer tests ---

class TestStarLayer:
    def test_render_frame(self):
        import numpy as np
        layer = StarLayer(
            stars=[StarPlacement(100.0, 100.0, 32, 1.0, 0.0)],
            layer_t_start=0.0,
            layer_t_end=2.0,
            total_duration=10.0,
            fps=24,
        )
        frame = layer.render_frame(0.0, 1920, 1080)
        assert frame.dtype == np.uint8
        assert frame.shape == (1080, 1920, 4)
        assert frame[100, 100, 3] == 255  # alpha channel at star center


# --- calculate_star_config tests ---

class TestCalculateStarConfig:
    def test_basic(self):
        cfg, layer_t_start, layer_t_end = calculate_star_config(
            300.0, 0.20, 0.5, 0.5, StarsConfig(seed=42),
        )
        assert layer_t_start == pytest.approx(60.0, abs=0.1)
        assert layer_t_end == pytest.approx(299.5, abs=0.1)
        assert 3 <= len(cfg) <= 50

    def test_short_video(self):
        cfg, layer_t_start, layer_t_end = calculate_star_config(
            10.0, 0.20, 0.5, 0.5, StarsConfig(seed=42),
        )
        assert layer_t_start == pytest.approx(2.0, abs=0.1)
        assert layer_t_end == pytest.approx(9.5, abs=0.1)


# --- render_stars (blocking render) tests ---

class TestRenderStars:
    def test_basic_render(self, minimal_video, tmp_path):
        out = render_video(
            str(minimal_video), str(tmp_path), StarsConfig(seed=42),
        )
        assert out is not None
        assert os.path.exists(out)
        assert os.path.getsize(out) > 0

    def test_output_filename(self, minimal_video, tmp_path):
        out = render_video(
            str(minimal_video), str(tmp_path), StarsConfig(seed=42),
        )
        assert out.endswith("_stars.mp4")

    def test_custom_suffix(self, minimal_video, tmp_path):
        cfg = StarsConfig(seed=42, output_suffix="_custom")
        out = render_video(
            str(minimal_video), str(tmp_path), cfg,
        )
        assert out.endswith("_custom.mp4")


import os


# --- Daemon JSON-RPC tests ---

class TestRenderStarsDaemon:
    def test_process_render_sync(self, minimal_video, tmp_path):
        out_dir = str(tmp_path)
        daemon = RenderStarsDaemon(out_dir)
        result = daemon._process_command({
            "cmd": "render",
            "input_path": str(minimal_video),
        })
        assert result["ok"] is True
        assert result["output_path"].endswith("_stars.mp4")
        assert os.path.exists(result["output_path"])

    def test_process_render_invalid_input(self, tmp_path):
        daemon = RenderStarsDaemon(str(tmp_path))
        result = daemon._process_command({
            "cmd": "render",
            "input_path": "/nonexistent/video.mp4",
        })
        assert result["ok"] is False
        assert "error" in result

    def test_process_render_missing_field(self, tmp_path):
        daemon = RenderStarsDaemon(str(tmp_path))
        result = daemon._process_command({"cmd": "render"})
        assert result["ok"] is False
        assert "input_path" in result["error"]

    def test_process_render_custom_config(self, minimal_video, tmp_path):
        daemon = RenderStarsDaemon(str(tmp_path))
        result = daemon._process_command({
            "cmd": "render",
            "input_path": str(minimal_video),
            "duration_pct": 20.0,
            "star_min_px": 24,
            "seed": 99,
        })
        assert result["ok"] is True
        assert os.path.exists(result["output_path"])

    def test_process_render_async(self, minimal_video_2s, tmp_path):
        daemon = RenderStarsDaemon(str(tmp_path))
        result = daemon._process_command({
            "cmd": "render_async",
            "input_path": str(minimal_video_2s),
            "duration_pct": 15.0,
        })
        assert result["ok"] is True
        assert "job_id" in result

        # Poll until done
        for _ in range(60):
            status = daemon._process_command({
                "cmd": "render_status",
                "job_id": result["job_id"],
            })
            if status.get("status") in ("done", "error"):
                break
            time.sleep(0.5)

        assert status["status"] == "done"
        assert os.path.exists(status["output_path"])

    def test_process_health(self, tmp_path):
        daemon = RenderStarsDaemon(str(tmp_path))
        result = daemon._process_command({"cmd": "health"})
        assert result["ok"] is True
        assert result["running"] == 0
        assert result["max_concurrent"] == 4


class TestDaemonStdio:
    def test_parse_json_line(self, daemon_instance):
        line = '{"cmd":"health"}\n'
        result = daemon_instance._parse_json_line(line)
        assert result == {"cmd": "health"}

    def test_parse_invalid_json(self, daemon_instance):
        result = daemon_instance._parse_json_line("not json\n")
        assert result is None

    def test_parse_non_dict(self, daemon_instance):
        result = daemon_instance._parse_json_line('[1,2,3]\n')
        assert result is None

    def test_handle_health_line(self, daemon_instance):
        resp = daemon_instance._handle_line('{"cmd":"health","id":1}\n')
        assert resp is not None
        data = json.loads(resp)
        assert data["ok"] is True
        assert data["id"] == 1

    def test_handle_render_line_missing_input(self, daemon_instance):
        resp = daemon_instance._handle_line('{"cmd":"render","id":2}\n')
        assert resp is not None
        data = json.loads(resp)
        assert data["ok"] is False
        assert data["id"] == 2

    def test_handle_unknown_command(self, daemon_instance):
        resp = daemon_instance._handle_line('{"cmd":"unknown","id":3}\n')
        assert resp is not None
        data = json.loads(resp)
        assert data["ok"] is False
        assert "error" in data


@pytest.fixture
def daemon_instance(tmp_path):
    return RenderStarsDaemon(str(tmp_path))
