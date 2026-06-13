"""Integration tests: verify download + render args via cargo test."""
import subprocess
import sys
import os

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def test_ytdlp_args():
    """Verify yt-dlp args builder via Rust tests."""
    result = subprocess.run(
        ["cargo", "test", "-p", "hyperclip_ipc", "--test", "youtube_test"],
        capture_output=True, text=True, cwd=PROJECT_ROOT,
    )
    assert result.returncode == 0, f"FAILED: {result.stderr[-300:]}"


def test_download_progress_parser():
    """Verify download progress parser via Rust tests."""
    result = subprocess.run(
        ["cargo", "test", "-p", "hyperclip_ipc", "download_progress"],
        capture_output=True, text=True, cwd=PROJECT_ROOT,
    )
    assert result.returncode == 0, f"FAILED: {result.stderr[-300:]}"


def test_render_progress_parser():
    """Verify render progress parser via Rust tests."""
    result = subprocess.run(
        ["cargo", "test", "-p", "hyperclip_ipc", "render_progress"],
        capture_output=True, text=True, cwd=PROJECT_ROOT,
    )
    assert result.returncode == 0, f"FAILED: {result.stderr[-300:]}"


def test_all_ipc_tests_pass():
    """Verify all hyperclip_ipc tests pass."""
    result = subprocess.run(
        ["cargo", "test", "-p", "hyperclip_ipc"],
        capture_output=True, text=True, cwd=PROJECT_ROOT,
    )
    assert result.returncode == 0, f"FAILED: {result.stderr[-500:]}"


if __name__ == "__main__":
    import pytest
    pytest.main([__file__, "-v"])
