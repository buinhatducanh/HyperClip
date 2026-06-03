# HyperSnip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Windows desktop app (PySide6) that downloads YouTube videos via yt-dlp, trims + renders them with FFmpeg (NVENC primary, libx264 fallback), and previews results with QMediaPlayer.

**Architecture:** 2-layer separation. Pure-Python services (testable with pytest) handle yt-dlp/ffmpeg subprocess + hardware detection. PySide6 UI layer calls services through QThread workers via signals/slots.

**Tech Stack:** Python 3.11+, PySide6 6.6+, pynvml, psutil, yt-dlp.exe, ffmpeg.exe, pytest + pytest-qt + pytest-mock, ruff, mypy.

**Spec:** `docs/superpowers/specs/2026-06-03-hypersnip-design.md`

---

## File Structure

```
C:\Users\MSI\Projects\ClipForge\              ← project root
├── main.py                                   ← entry point
├── pyproject.toml
├── requirements.txt
├── README.md
├── .gitignore
├── src/hypersnip/
│   ├── __init__.py
│   ├── app.py
│   ├── config.py
│   ├── exceptions.py
│   ├── models.py
│   ├── services/
│   │   ├── __init__.py
│   │   ├── ffmpeg_paths.py
│   │   ├── hardware_detector.py
│   │   ├── progress_parser.py
│   │   ├── downloader.py
│   │   └── renderer.py
│   └── ui/
│       ├── __init__.py
│       ├── main_window.py
│       ├── workers.py
│       └── widgets/
│           ├── __init__.py
│           ├── url_input.py
│           ├── video_info.py
│           ├── trim_panel.py
│           ├── render_panel.py
│           ├── video_player.py
│           └── progress_log.py
└── tests/
    ├── __init__.py
    ├── conftest.py
    ├── test_ffmpeg_paths.py
    ├── test_hardware_detector.py
    ├── test_progress_parser.py
    ├── test_downloader.py
    ├── test_renderer.py
    ├── test_models.py
    └── ui/
        ├── __init__.py
        ├── test_url_input.py
        ├── test_trim_panel.py
        └── test_render_panel.py
```

---

## Phase 1: Project Bootstrap

### Task 1: Project Scaffold

**Files:**
- Create: `C:\Users\MSI\Projects\ClipForge\requirements.txt`
- Create: `C:\Users\MSI\Projects\ClipForge\pyproject.toml`
- Create: `C:\Users\MSI\Projects\ClipForge\.gitignore`
- Create: `C:\Users\MSI\Projects\ClipForge\README.md`
- Create: `C:\Users\MSI\Projects\ClipForge\main.py`

- [ ] **Step 1: Create project folder and initialize git**

```bash
mkdir -p /c/Users/MSI/Projects/ClipForge
cd /c/Users/MSI/Projects/ClipForge
git init
```

- [ ] **Step 2: Create `requirements.txt`**

File: `C:\Users\MSI\Projects\ClipForge\requirements.txt`

```
PySide6>=6.6.0
pynvml>=11.5.0
psutil>=5.9.0
pytest>=8.0
pytest-qt>=4.4
pytest-mock>=3.12
ruff>=0.4.0
mypy>=1.10
```

- [ ] **Step 3: Create `pyproject.toml`**

File: `C:\Users\MSI\Projects\ClipForge\pyproject.toml`

```toml
[project]
name = "hypersnip"
version = "0.1.0"
description = "YouTube download + trim + render desktop app (PySide6)"
requires-python = ">=3.11"

[tool.ruff]
line-length = 100
target-version = "py311"

[tool.ruff.lint]
select = ["E", "F", "I", "B", "UP", "N", "SIM", "RUF"]
ignore = ["E501"]

[tool.mypy]
python_version = "3.11"
strict = true
ignore_missing_imports = true

[tool.pytest.ini_options]
testpaths = ["tests"]
qt_api = "pyside6"
addopts = "-v --tb=short"

[tool.pytestqt]
```

- [ ] **Step 4: Create `.gitignore`**

File: `C:\Users\MSI\Projects\ClipForge\.gitignore`

```
.venv/
__pycache__/
*.pyc
*.pyo
.pytest_cache/
.mypy_cache/
.ruff_cache/
*.egg-info/
dist/
build/
.DS_Store
Thumbs.db
.idea/
.vscode/
*.log
downloads/
output/
```

- [ ] **Step 5: Create `main.py` (placeholder entry)**

File: `C:\Users\MSI\Projects\ClipForge\main.py`

```python
"""HyperSnip entry point."""
from hypersnip.app import main

if __name__ == "__main__":
    main()
```

- [ ] **Step 6: Create `README.md` (minimal — full version in Task 17)**

File: `C:\Users\MSI\Projects\ClipForge\README.md`

```markdown
# HyperSnip

YouTube download + trim + render desktop app. Windows only.

## Setup

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

## Prerequisites

- `yt-dlp.exe` in PATH or set `YTDLP_PATH`
- `ffmpeg.exe` in PATH (Scoop shims OK)

## Run

```bash
python main.py
```
```

- [ ] **Step 7: Commit**

```bash
cd /c/Users/MSI/Projects/ClipForge
git add .
git commit -m "chore: scaffold project structure"
```

---

### Task 2: Package `__init__.py` + `app.py` Bootstrap

**Files:**
- Create: `C:\Users\MSI\Projects\ClipForge\src\hypersnip\__init__.py`
- Create: `C:\Users\MSI\Projects\ClipForge\src\hypersnip\app.py`
- Create: `C:\Users\MSI\Projects\ClipForge\src\hypersnip\config.py`
- Create: `C:\Users\MSI\Projects\ClipForge\tests\__init__.py`
- Create: `C:\Users\MSI\Projects\ClipForge\tests\conftest.py`

- [ ] **Step 1: Create package structure**

```bash
mkdir -p /c/Users/MSI/Projects/ClipForge/src/hypersnip/services
mkdir -p /c/Users/MSI/Projects/ClipForge/src/hypersnip/ui/widgets
mkdir -p /c/Users/MSI/Projects/ClipForge/tests/ui
```

- [ ] **Step 2: Create `src/hypersnip/__init__.py`**

File: `C:\Users\MSI\Projects\ClipForge\src\hypersnip\__init__.py`

```python
"""HyperSnip — YouTube download + trim + render desktop app."""

__version__ = "0.1.0"
```

- [ ] **Step 3: Create `src/hypersnip/config.py`**

File: `C:\Users\MSI\Projects\ClipForge\src\hypersnip\config.py`

```python
"""App-wide constants and theme."""

from pathlib import Path

APP_NAME = "HyperSnip"
APP_VERSION = "0.1.0"

# Theme colors (matches HyperClip)
BG_COLOR = "#121212"
SURFACE_COLOR = "#1E1E1E"
BORDER_COLOR = "#2A2A2A"
TEXT_COLOR = "#E0E0E0"
TEXT_MUTED = "#888888"
ACCENT_COLOR = "#00B4FF"
SUCCESS_COLOR = "#00FF88"
WARNING_COLOR = "#FFB800"
ERROR_COLOR = "#FF4444"

FONT_FAMILY = "Inter"
FONT_SIZE = 13

# Layout
SIDEBAR_WIDTH = 220

# Logging
LOG_DIR = Path.home() / ".hypersnip" / "logs"
LOG_FILE = LOG_DIR / "hypersnip.log"
LOG_MAX_BYTES = 5 * 1024 * 1024  # 5MB
LOG_BACKUP_COUNT = 3

# Defaults
DEFAULT_BITRATE = "12M"
DEFAULT_PRESET = "p1"
DEFAULT_WIDTH = 1920
DEFAULT_HEIGHT = 1080
DEFAULT_FPS = 30

# Output
DEFAULT_OUTPUT_DIR = Path.home() / "Videos" / "HyperSnip"
```

- [ ] **Step 4: Create `src/hypersnip/app.py`**

File: `C:\Users\MSI\Projects\ClipForge\src\hypersnip\app.py`

```python
"""QApplication bootstrap and theme setup."""

import logging
import sys
from logging.handlers import RotatingFileHandler

from PySide6.QtCore import Qt
from PySide6.QtGui import QFont
from PySide6.QtWidgets import QApplication

from hypersnip import config
from hypersnip.ui.main_window import MainWindow


def _setup_logging() -> None:
    """Configure rotating file logger."""
    config.LOG_DIR.mkdir(parents=True, exist_ok=True)
    handler = RotatingFileHandler(
        config.LOG_FILE,
        maxBytes=config.LOG_MAX_BYTES,
        backupCount=config.LOG_BACKUP_COUNT,
        encoding="utf-8",
    )
    handler.setFormatter(
        logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s")
    )
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    root.addHandler(handler)


def main() -> int:
    """Bootstrap and run the QApplication."""
    _setup_logging()

    # High-DPI policy
    QApplication.setHighDpiScaleFactorRoundingPolicy(
        Qt.HighDpiScaleFactorRoundingPolicy.PassThrough
    )

    app = QApplication(sys.argv)
    app.setApplicationName(config.APP_NAME)
    app.setApplicationVersion(config.APP_VERSION)

    # Theme
    app.setStyle("Fusion")
    font = QFont(config.FONT_FAMILY, config.FONT_SIZE)
    app.setFont(font)

    window = MainWindow()
    window.show()

    return app.exec()
```

- [ ] **Step 5: Stub `src/hypersnip/ui/main_window.py` so app can launch**

File: `C:\Users\MSI\Projects\ClipForge\src\hypersnip\ui\__init__.py`

```python
"""HyperSnip UI layer."""
```

File: `C:\Users\MSI\Projects\ClipForge\src\hypersnip\ui\widgets\__init__.py`

```python
"""HyperSnip UI widgets."""
```

File: `C:\Users\MSI\Projects\ClipForge\src\hypersnip\ui\main_window.py`

```python
"""Main application window (stub — full impl in Task 16)."""

from PySide6.QtWidgets import QMainWindow


class MainWindow(QMainWindow):
    def __init__(self) -> None:
        super().__init__()
        self.setWindowTitle("HyperSnip")
        self.resize(1200, 800)
```

- [ ] **Step 6: Create test scaffolding**

File: `C:\Users\MSI\Projects\ClipForge\tests\__init__.py`

```python
"""HyperSnip test suite."""
```

File: `C:\Users\MSI\Projects\ClipForge\tests\ui\__init__.py`

```python
"""UI test suite."""
```

File: `C:\Users\MSI\Projects\ClipForge\tests\conftest.py`

```python
"""Shared pytest fixtures."""

from __future__ import annotations

import os
import subprocess
from pathlib import Path
from unittest.mock import MagicMock

import pytest


@pytest.fixture
def tmp_dir(tmp_path: Path) -> Path:
    """Provide a temporary directory for tests."""
    return tmp_path


@pytest.fixture
def mock_subprocess(mocker: pytest.MockerFixture) -> MagicMock:
    """Mock subprocess.Popen to return a fake completed process."""
    return mocker.patch("subprocess.Popen")


@pytest.fixture
def mock_run(mocker: pytest.MockerFixture) -> MagicMock:
    """Mock subprocess.run."""
    return mocker.patch("subprocess.run")


@pytest.fixture(autouse=True)
def no_real_subprocess(monkeypatch: pytest.MonkeyPatch) -> None:
    """Disable PATH lookups for binaries during tests."""
    # Make sure tests never accidentally call real yt-dlp / ffmpeg
    monkeypatch.setenv("FFMPEG_PATH", "")
    monkeypatch.setenv("YTDLP_PATH", "")
```

- [ ] **Step 7: Install package in editable mode + verify launch**

```bash
cd /c/Users/MSI/Projects/ClipForge
python -m venv .venv
source .venv/Scripts/activate
pip install -r requirements.txt
pip install -e .
```

Expected: install completes without errors.

- [ ] **Step 8: Verify app launches (will show empty window)**

```bash
cd /c/Users/MSI/Projects/ClipForge
timeout 3 python main.py
```

Expected: window opens for 3 seconds, then closes. No traceback.

- [ ] **Step 9: Commit**

```bash
cd /c/Users/MSI/Projects/ClipForge
git add .
git commit -m "feat: bootstrap QApplication with theme and logging"
```

---

### Task 3: Exceptions + Models

**Files:**
- Create: `C:\Users\MSI\Projects\ClipForge\src\hypersnip\exceptions.py`
- Create: `C:\Users\MSI\Projects\ClipForge\src\hypersnip\models.py`
- Create: `C:\Users\MSI\Projects\ClipForge\src\hypersnip\services\__init__.py`
- Create: `C:\Users\MSI\Projects\ClipForge\tests\test_models.py`

- [ ] **Step 1: Write `test_models.py` with failing tests**

File: `C:\Users\MSI\Projects\ClipForge\tests\test_models.py`

```python
"""Tests for data models."""

from pathlib import Path

import pytest

from hypersnip.models import RenderConfig, RenderProgress, VideoInfo


def test_video_info_construction() -> None:
    info = VideoInfo(
        title="Test Video",
        duration=120.5,
        thumbnail_url="https://i.ytimg.com/vi/abc/0.jpg",
        width=1920,
        height=1080,
        fps=30.0,
        formats=["137+140", "22", "18"],
    )
    assert info.title == "Test Video"
    assert info.duration == 120.5
    assert info.width == 1920
    assert info.height == 1080
    assert info.fps == 30.0
    assert len(info.formats) == 3


def test_render_progress_construction() -> None:
    progress = RenderProgress(time_seconds=45.0, fps=60.0, speed="1.5x")
    assert progress.time_seconds == 45.0
    assert progress.fps == 60.0
    assert progress.speed == "1.5x"


def test_render_config_defaults() -> None:
    config = RenderConfig(preset="p1", bitrate="12M")
    assert config.preset == "p1"
    assert config.bitrate == "12M"
    assert config.width == 1920
    assert config.height == 1080
    assert config.fps == 30
    assert isinstance(config.output_dir, Path)


def test_render_config_custom_values() -> None:
    custom_dir = Path("/tmp/output")
    config = RenderConfig(
        preset="ull",
        bitrate="6M",
        width=1280,
        height=720,
        fps=60,
        output_dir=custom_dir,
    )
    assert config.preset == "ull"
    assert config.width == 1280
    assert config.height == 720
    assert config.fps == 60
    assert config.output_dir == custom_dir


def test_render_progress_optional_fields() -> None:
    progress = RenderProgress(time_seconds=10.0)
    assert progress.fps is None
    assert progress.speed is None
```

- [ ] **Step 2: Run test to verify it fails (ImportError)**

```bash
cd /c/Users/MSI/Projects/ClipForge
pytest tests/test_models.py -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'hypersnip.models'`

- [ ] **Step 3: Create `exceptions.py`**

File: `C:\Users\MSI\Projects\ClipForge\src\hypersnip\exceptions.py`

```python
"""Custom exception hierarchy."""


class HyperSnipError(Exception):
    """Base for all HyperSnip errors."""


class BinaryNotFoundError(HyperSnipError):
    """Raised when yt-dlp or ffmpeg binary cannot be located."""


class DownloadError(HyperSnipError):
    """Raised when yt-dlp fails (network, private video, region, etc.)."""


class RenderError(HyperSnipError):
    """Raised when ffmpeg fails (codec mismatch, invalid input, etc.)."""


class HardwareError(HyperSnipError):
    """Raised when hardware detection fails (pynvml error)."""
```

- [ ] **Step 4: Create `models.py`**

File: `C:\Users\MSI\Projects\ClipForge\src\hypersnip\models.py`

```python
"""Data models for video info, render config, and progress."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from hypersnip.config import DEFAULT_OUTPUT_DIR


@dataclass(frozen=True)
class VideoInfo:
    """Parsed YouTube video metadata."""

    title: str
    duration: float  # seconds
    thumbnail_url: str
    width: int
    height: int
    fps: float
    formats: list[str]


@dataclass(frozen=True)
class RenderProgress:
    """Real-time ffmpeg progress."""

    time_seconds: float
    fps: float | None = None
    speed: str | None = None


@dataclass(frozen=True)
class RenderConfig:
    """User-configurable render settings."""

    preset: str  # "p1" | "p2" | ... | "p7" | "ull"
    bitrate: str  # e.g. "12M"
    width: int = 1920
    height: int = 1080
    fps: int = 30
    output_dir: Path = field(default_factory=lambda: DEFAULT_OUTPUT_DIR)
```

- [ ] **Step 5: Create `services/__init__.py`**

File: `C:\Users\MSI\Projects\ClipForge\src\hypersnip\services\__init__.py`

```python
"""HyperSnip service layer."""
```

- [ ] **Step 6: Run test to verify it passes**

```bash
cd /c/Users/MSI/Projects/ClipForge
pytest tests/test_models.py -v
```

Expected: 5 passed

- [ ] **Step 7: Commit**

```bash
cd /c/Users/MSI/Projects/ClipForge
git add src/hypersnip/exceptions.py src/hypersnip/models.py src/hypersnip/services/__init__.py tests/test_models.py
git commit -m "feat: add exceptions and data models"
```

---

## Phase 2: Services Layer (TDD)

### Task 4: `ffmpeg_paths.py` — Binary Resolution

**Files:**
- Create: `C:\Users\MSI\Projects\ClipForge\src\hypersnip\services\ffmpeg_paths.py`
- Create: `C:\Users\MSI\Projects\ClipForge\tests\test_ffmpeg_paths.py`

- [ ] **Step 1: Write failing tests**

File: `C:\Users\MSI\Projects\ClipForge\tests\test_ffmpeg_paths.py`

```python
"""Tests for binary path resolution."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest

from hypersnip.exceptions import BinaryNotFoundError
from hypersnip.services.ffmpeg_paths import resolve_ffmpeg, resolve_ytdlp


class TestResolveFFmpeg:
    def test_env_var_override(self, monkeypatch: pytest.MonkeyPatch) -> None:
        custom = "C:/custom/ffmpeg.exe"
        monkeypatch.setenv("FFMPEG_PATH", custom)
        assert resolve_ffmpeg() == Path(custom)

    def test_scoop_shims(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("FFMPEG_PATH", "")
        scoop_path = Path("C:/Users/Test/scoop/shims/ffmpeg.exe")

        def fake_exists(self: Path) -> bool:
            return str(self) == str(scoop_path)

        with patch.object(Path, "exists", fake_exists):
            assert resolve_ffmpeg() == scoop_path

    def test_which_fallback(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("FFMPEG_PATH", "")

        def fake_exists(_self: Path) -> bool:
            return False

        with patch.object(Path, "exists", fake_exists):
            with patch("hypersnip.services.ffmpeg_paths.shutil.which") as mock_which:
                mock_which.return_value = "C:/some/ffmpeg.exe"
                assert resolve_ffmpeg() == Path("C:/some/ffmpeg.exe")

    def test_raises_when_not_found(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("FFMPEG_PATH", "")

        def fake_exists(_self: Path) -> bool:
            return False

        with patch.object(Path, "exists", fake_exists):
            with patch("hypersnip.services.ffmpeg_paths.shutil.which") as mock_which:
                mock_which.return_value = None
                with pytest.raises(BinaryNotFoundError, match="ffmpeg"):
                    resolve_ffmpeg()


class TestResolveYtdlp:
    def test_env_var_override(self, monkeypatch: pytest.MonkeyPatch) -> None:
        custom = "C:/custom/yt-dlp.exe"
        monkeypatch.setenv("YTDLP_PATH", custom)
        assert resolve_ytdlp() == Path(custom)

    def test_which_fallback(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("YTDLP_PATH", "")

        with patch("hypersnip.services.ffmpeg_paths.shutil.which") as mock_which:
            mock_which.return_value = "C:/some/yt-dlp.exe"
            assert resolve_ytdlp() == Path("C:/some/yt-dlp.exe")

    def test_raises_when_not_found(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("YTDLP_PATH", "")

        with patch("hypersnip.services.ffmpeg_paths.shutil.which") as mock_which:
            mock_which.return_value = None
            with pytest.raises(BinaryNotFoundError, match="yt-dlp"):
                resolve_ytdlp()
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /c/Users/MSI/Projects/ClipForge
pytest tests/test_ffmpeg_paths.py -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'hypersnip.services.ffmpeg_paths'`

- [ ] **Step 3: Implement `ffmpeg_paths.py`**

File: `C:\Users\MSI\Projects\ClipForge\src\hypersnip\services\ffmpeg_paths.py`

```python
"""Resolve paths to external binaries (ffmpeg.exe, yt-dlp.exe)."""

from __future__ import annotations

import os
import shutil
from pathlib import Path

from hypersnip.exceptions import BinaryNotFoundError

_SCOOP_FFMPEG = Path("C:/Users/")  # placeholder; resolved dynamically below
_FFMPEG_CANDIDATES: list[Path] = []


def _get_scoop_ffmpeg() -> Path:
    """Build Scoop shim path for current user."""
    return Path(f"C:/Users/{os.environ.get('USERNAME', '')}/scoop/shims/ffmpeg.exe")


def _build_ffmpeg_candidates() -> list[Path]:
    """Build ffmpeg lookup list (lazy, so USERNAME env is read at call time)."""
    return [
        _get_scoop_ffmpeg(),
        Path("C:/ffmpeg/bin/ffmpeg.exe"),
    ]


def resolve_ffmpeg() -> Path:
    """Return the path to ffmpeg.exe.

    Lookup order:
        1. $FFMPEG_PATH env var
        2. Scoop shims (C:/Users/<user>/scoop/shims/ffmpeg.exe)
        3. C:/ffmpeg/bin/ffmpeg.exe
        4. shutil.which('ffmpeg')

    Raises:
        BinaryNotFoundError: if ffmpeg is not found in any location.
    """
    env_path = os.environ.get("FFMPEG_PATH", "").strip()
    if env_path:
        return Path(env_path)

    for candidate in _build_ffmpeg_candidates():
        if candidate.exists():
            return candidate

    which = shutil.which("ffmpeg")
    if which:
        return Path(which)

    raise BinaryNotFoundError(
        "ffmpeg.exe not found. Install via Scoop (scoop install ffmpeg) "
        "or set FFMPEG_PATH environment variable."
    )


def resolve_ytdlp() -> Path:
    """Return the path to yt-dlp.exe.

    Lookup order:
        1. $YTDLP_PATH env var
        2. shutil.which('yt-dlp')
        3. C:/Users/<user>/scoop/shims/yt-dlp.exe
        4. C:/yt-dlp/yt-dlp.exe

    Raises:
        BinaryNotFoundError: if yt-dlp is not found in any location.
    """
    env_path = os.environ.get("YTDLP_PATH", "").strip()
    if env_path:
        return Path(env_path)

    which = shutil.which("yt-dlp")
    if which:
        return Path(which)

    scoop = Path(f"C:/Users/{os.environ.get('USERNAME', '')}/scoop/shims/yt-dlp.exe")
    if scoop.exists():
        return scoop

    fallback = Path("C:/yt-dlp/yt-dlp.exe")
    if fallback.exists():
        return fallback

    raise BinaryNotFoundError(
        "yt-dlp.exe not found. Download from "
        "github.com/yt-dlp/yt-dlp/releases or set YTDLP_PATH."
    )
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /c/Users/MSI/Projects/ClipForge
pytest tests/test_ffmpeg_paths.py -v
```

Expected: 7 passed

- [ ] **Step 5: Commit**

```bash
cd /c/Users/MSI/Projects/ClipForge
git add src/hypersnip/services/ffmpeg_paths.py tests/test_ffmpeg_paths.py
git commit -m "feat(services): add binary path resolution for ffmpeg and yt-dlp"
```

---

### Task 5: `hardware_detector.py` — GPU/CPU/RAM Detection

**Files:**
- Create: `C:\Users\MSI\Projects\ClipForge\src\hypersnip\services\hardware_detector.py`
- Create: `C:\Users\MSI\Projects\ClipForge\tests\test_hardware_detector.py`

- [ ] **Step 1: Write failing tests**

File: `C:\Users\MSI\Projects\ClipForge\tests\test_hardware_detector.py`

```python
"""Tests for hardware detection (GPU/NVENC/CPU/RAM)."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from hypersnip.services.hardware_detector import HardwareInfo, detect


def _mock_pynvml(no_gpu: bool = False, nvenc: bool = True) -> MagicMock:
    """Build a pynvml mock."""
    pynvml = MagicMock()
    pynvml.nvmlInit.return_value = None
    pynvml.nvmlShutdown.return_value = None
    if no_gpu:
        pynvml.nvmlDeviceGetCount.side_effect = Exception("no gpu")
    else:
        pynvml.nvmlDeviceGetCount.return_value = 1
        handle = MagicMock()
        pynvml.nvmlDeviceGetHandleByIndex.return_value = handle
        pynvml.nvmlDeviceGetName.return_value = b"NVIDIA GeForce RTX 5080"
        info = MagicMock()
        info.total = 16 * 1024 * 1024 * 1024  # 16GB
        pynvml.nvmlDeviceGetMemoryInfo.return_value = info
        if nvenc:
            caps = MagicMock()
            caps.cap.value = 1  # supported
            pynvml.nvmlDeviceGetCodecUtilizationCapability.return_value = caps
        else:
            pynvml.nvmlDeviceGetCodecUtilizationCapability.side_effect = Exception("no nvenc")
    return pynvml


class TestDetect:
    def test_with_nvidia_gpu(self) -> None:
        pynvml = _mock_pynvml(no_gpu=False, nvenc=True)
        with patch.dict("sys.modules", {"pynvml": pynvml}):
            # Clear lru_cache
            from hypersnip.services.hardware_detector import detect

            detect.cache_clear()
            info = detect()
            assert info.gpu_name == "NVIDIA GeForce RTX 5080"
            assert info.gpu_memory_mb == 16 * 1024
            assert info.nvenc_supported is True
            assert info.cpu_count >= 1
            assert info.ram_total_gb > 0

    def test_no_nvidia_gpu(self) -> None:
        pynvml = _mock_pynvml(no_gpu=True)
        with patch.dict("sys.modules", {"pynvml": pynvml}):
            from hypersnip.services.hardware_detector import detect

            detect.cache_clear()
            info = detect()
            assert info.gpu_name is None
            assert info.nvenc_supported is False

    def test_caches_result(self) -> None:
        pynvml = _mock_pynvml(no_gpu=False, nvenc=True)
        with patch.dict("sys.modules", {"pynvml": pynvml}):
            from hypersnip.services.hardware_detector import detect

            detect.cache_clear()
            info1 = detect()
            info2 = detect()
            # Same dataclass instance returned from cache
            assert info1 is info2


class TestHardwareInfo:
    def test_construction(self) -> None:
        info = HardwareInfo(
            gpu_name="RTX 5080",
            gpu_memory_mb=16384,
            nvenc_supported=True,
            cpu_count=24,
            ram_total_gb=64.0,
        )
        assert info.gpu_name == "RTX 5080"
        assert info.gpu_memory_mb == 16384
        assert info.nvenc_supported is True
        assert info.cpu_count == 24
        assert info.ram_total_gb == 64.0

    def test_frozen(self) -> None:
        import dataclasses

        info = HardwareInfo(
            gpu_name=None,
            gpu_memory_mb=0,
            nvenc_supported=False,
            cpu_count=4,
            ram_total_gb=8.0,
        )
        with pytest.raises(dataclasses.FrozenInstanceError):
            info.cpu_count = 8  # type: ignore[misc]
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /c/Users/MSI/Projects/ClipForge
pytest tests/test_hardware_detector.py -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'hypersnip.services.hardware_detector'`

- [ ] **Step 3: Implement `hardware_detector.py`**

File: `C:\Users\MSI\Projects\ClipForge\src\hypersnip\services\hardware_detector.py`

```python
"""Detect GPU, NVENC support, CPU, and RAM. Result is cached."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from functools import lru_cache

import psutil

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class HardwareInfo:
    """Hardware capabilities snapshot."""

    gpu_name: str | None
    gpu_memory_mb: int
    nvenc_supported: bool
    cpu_count: int
    ram_total_gb: float


@lru_cache(maxsize=1)
def detect() -> HardwareInfo:
    """Detect hardware. Cached — call once at startup.

    Returns:
        HardwareInfo with all fields populated. If NVIDIA GPU is not
        detected, gpu_name is None and nvenc_supported is False.
    """
    gpu_name: str | None = None
    gpu_memory_mb = 0
    nvenc_supported = False

    try:
        import pynvml

        pynvml.nvmlInit()
        try:
            count = pynvml.nvmlDeviceGetCount()
            if count > 0:
                handle = pynvml.nvmlDeviceGetHandleByIndex(0)
                name_bytes = pynvml.nvmlDeviceGetName(handle)
                gpu_name = name_bytes.decode("utf-8") if isinstance(name_bytes, bytes) else str(name_bytes)
                mem_info = pynvml.nvmlDeviceGetMemoryInfo(handle)
                gpu_memory_mb = mem_info.total // (1024 * 1024)
                try:
                    caps = pynvml.nvmlDeviceGetCodecUtilizationCapability(handle)
                    if hasattr(caps, "cap") and caps.cap.value:
                        nvenc_supported = True
                except Exception as e:  # noqa: BLE001
                    logger.debug("NVENC capability check failed: %s", e)
                    nvenc_supported = False
        finally:
            pynvml.nvmlShutdown()
    except Exception as e:  # noqa: BLE001
        logger.info("No NVIDIA GPU detected or pynvml not available: %s", e)

    cpu_count = psutil.cpu_count(logical=True) or 1
    ram_total_gb = psutil.virtual_memory().total / (1024**3)

    return HardwareInfo(
        gpu_name=gpu_name,
        gpu_memory_mb=gpu_memory_mb,
        nvenc_supported=nvenc_supported,
        cpu_count=cpu_count,
        ram_total_gb=ram_total_gb,
    )
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /c/Users/MSI/Projects/ClipForge
pytest tests/test_hardware_detector.py -v
```

Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
cd /c/Users/MSI/Projects/ClipForge
git add src/hypersnip/services/hardware_detector.py tests/test_hardware_detector.py
git commit -m "feat(services): add hardware detection with NVENC support check"
```

---

### Task 6: `progress_parser.py` — Stderr Parsing

**Files:**
- Create: `C:\Users\MSI\Projects\ClipForge\src\hypersnip\services\progress_parser.py`
- Create: `C:\Users\MSI\Projects\ClipForge\tests\test_progress_parser.py`

- [ ] **Step 1: Write failing tests**

File: `C:\Users\MSI\Projects\ClipForge\tests\test_progress_parser.py`

```python
"""Tests for yt-dlp and ffmpeg progress/error parsing."""

import pytest

from hypersnip.services.progress_parser import (
    parse_ffmpeg_progress,
    parse_ytdlp_error,
    parse_ytdlp_progress,
)


class TestParseYtdlpProgress:
    def test_basic(self) -> None:
        line = "[download]  45.2% of  100.0MiB at 5.00MiB/s ETA 00:30"
        assert parse_ytdlp_progress(line) == 45.2

    def test_zero_percent(self) -> None:
        line = "[download]   0.0% of  100.0MiB at  0B/s ETA --:--"
        assert parse_ytdlp_progress(line) == 0.0

    def test_hundred_percent(self) -> None:
        line = "[download] 100.0% of  100.0MiB at 5.00MiB/s in 00:20"
        assert parse_ytdlp_progress(line) == 100.0

    def test_no_match(self) -> None:
        line = "[generic] Extracting URL: https://youtube.com/watch?v=abc"
        assert parse_ytdlp_progress(line) is None

    def test_destination_line(self) -> None:
        line = "[download] Destination: video.mp4"
        assert parse_ytdlp_progress(line) is None


class TestParseFfmpegProgress:
    def test_basic(self) -> None:
        line = "frame= 1234 fps= 60 q=28.0 size=   10240kB time=00:01:30.45 bitrate= 950.0kbits/s"
        progress = parse_ffmpeg_progress(line)
        assert progress is not None
        assert progress.time_seconds == pytest.approx(90.45, abs=0.01)
        assert progress.fps == 60.0

    def test_no_match(self) -> None:
        line = "ffmpeg version 6.0 Copyright (c) 2000-2023 the FFmpeg developers"
        assert parse_ffmpeg_progress(line) is None

    def test_zero_time(self) -> None:
        line = "frame=    0 fps=0.0 q=0.0 size=       0kB time=00:00:00.00 bitrate=N/A"
        progress = parse_ffmpeg_progress(line)
        assert progress is not None
        assert progress.time_seconds == 0.0


class TestParseYtdlpError:
    def test_private_video(self) -> None:
        stderr = "ERROR: [youtube] abc123: Private video. Sign in if you've been granted access"
        msg = parse_ytdlp_error(stderr)
        assert msg is not None
        assert "riêng tư" in msg.lower()

    def test_region_locked(self) -> None:
        stderr = "ERROR: [youtube] abc123: Video unavailable. This video is not available in your country"
        msg = parse_ytdlp_error(stderr)
        assert msg is not None
        assert "khu vực" in msg.lower() or "quốc gia" in msg.lower()

    def test_age_restricted(self) -> None:
        stderr = "ERROR: Sign in to confirm your age"
        msg = parse_ytdlp_error(stderr)
        assert msg is not None
        assert "tuổi" in msg.lower()

    def test_video_unavailable(self) -> None:
        stderr = "ERROR: [youtube] abc123: Video unavailable"
        msg = parse_ytdlp_error(stderr)
        assert msg is not None
        assert "không khả dụng" in msg.lower()

    def test_no_match(self) -> None:
        stderr = "[download] 50.0% of 100MiB"
        assert parse_ytdlp_error(stderr) is None
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /c/Users/MSI/Projects/ClipForge
pytest tests/test_progress_parser.py -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'hypersnip.services.progress_parser'`

- [ ] **Step 3: Implement `progress_parser.py`**

File: `C:\Users\MSI\Projects\ClipForge\src\hypersnip\services\progress_parser.py`

```python
"""Parse yt-dlp and ffmpeg stderr streams for progress and error info."""

from __future__ import annotations

import re

from hypersnip.models import RenderProgress

# yt-dlp download percent: [download]  45.2% of ...
_YTDLP_PERCENT_RE = re.compile(r"\[download\]\s+(\d+(?:\.\d+)?)\s*%")

# ffmpeg time=HH:MM:SS.SS
_FFMPEG_TIME_RE = re.compile(r"time=(\d+):(\d+):(\d+\.\d+)")
_FFMPEG_FPS_RE = re.compile(r"fps=\s*(\d+(?:\.\d+)?)")

# yt-dlp error patterns → Vietnamese messages
_YTDLP_ERROR_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"Private video", re.IGNORECASE), "Video riêng tư — cần đăng nhập"),
    (
        re.compile(r"not available in your country|region locked", re.IGNORECASE),
        "Video bị giới hạn khu vực — không khả dụng tại Việt Nam",
    ),
    (
        re.compile(r"Sign in to confirm your age", re.IGNORECASE),
        "Video giới hạn độ tuổi — cần đăng nhập YouTube",
    ),
    (
        re.compile(r"Video unavailable|This video has been removed", re.IGNORECASE),
        "Video không khả dụng hoặc đã bị xóa",
    ),
    (
        re.compile(r"Sign in to confirm you're not a bot", re.IGNORECASE),
        "YouTube yêu cầu xác minh bot — thử lại sau vài phút",
    ),
]


def parse_ytdlp_progress(line: str) -> float | None:
    """Extract download percent from a yt-dlp stderr line.

    Returns:
        Float in [0, 100] or None if line doesn't match.
    """
    m = _YTDLP_PERCENT_RE.search(line)
    if m:
        return float(m.group(1))
    return None


def parse_ffmpeg_progress(line: str) -> RenderProgress | None:
    """Extract progress from a ffmpeg stderr line.

    Returns:
        RenderProgress with time_seconds (and fps if available), or None.
    """
    time_match = _FFMPEG_TIME_RE.search(line)
    if not time_match:
        return None
    h, m, s = (float(x) for x in time_match.groups())
    time_seconds = h * 3600 + m * 60 + s

    fps: float | None = None
    fps_match = _FFMPEG_FPS_RE.search(line)
    if fps_match:
        fps = float(fps_match.group(1))

    return RenderProgress(time_seconds=time_seconds, fps=fps)


def parse_ytdlp_error(stderr: str) -> str | None:
    """Match yt-dlp stderr against known error patterns.

    Returns:
        Vietnamese error message or None if no pattern matches.
    """
    for pattern, message in _YTDLP_ERROR_PATTERNS:
        if pattern.search(stderr):
            return message
    return None
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /c/Users/MSI/Projects/ClipForge
pytest tests/test_progress_parser.py -v
```

Expected: 13 passed

- [ ] **Step 5: Commit**

```bash
cd /c/Users/MSI/Projects/ClipForge
git add src/hypersnip/services/progress_parser.py tests/test_progress_parser.py
git commit -m "feat(services): add progress and error parsers for yt-dlp/ffmpeg"
```

---

### Task 7: `downloader.py` — yt-dlp Subprocess Wrapper

**Files:**
- Create: `C:\Users\MSI\Projects\ClipForge\src\hypersnip\services\downloader.py`
- Create: `C:\Users\MSI\Projects\ClipForge\tests\test_downloader.py`

- [ ] **Step 1: Write failing tests**

File: `C:\Users\MSI\Projects\ClipForge\tests\test_downloader.py`

```python
"""Tests for the yt-dlp downloader service."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, call

import pytest

from hypersnip.exceptions import DownloadError
from hypersnip.services.downloader import Downloader, get_info
from hypersnip.services.ffmpeg_paths import resolve_ytdlp


def _make_completed(stdout: str = "", stderr: str = "", returncode: int = 0) -> MagicMock:
    cp = MagicMock()
    cp.stdout = stdout
    cp.stderr = stderr
    cp.returncode = returncode
    return cp


class TestGetInfo:
    def test_success(self, mock_run: MagicMock, tmp_dir: Path) -> None:
        info_json: dict[str, Any] = {
            "title": "Test Video",
            "duration": 120,
            "thumbnail": "https://i.ytimg.com/vi/abc/0.jpg",
            "width": 1920,
            "height": 1080,
            "fps": 30,
            "formats": [{"format_id": "22"}, {"format_id": "18"}],
        }
        mock_run.return_value = _make_completed(stdout=json.dumps(info_json))

        info = get_info("https://youtube.com/watch?v=abc", ytdlp_path=tmp_dir / "yt-dlp.exe")
        assert info.title == "Test Video"
        assert info.duration == 120.0
        assert info.thumbnail_url == "https://i.ytimg.com/vi/abc/0.jpg"
        assert info.width == 1920
        assert info.height == 1080
        assert info.fps == 30.0
        assert "22" in info.formats

    def test_failure_raises(self, mock_run: MagicMock, tmp_dir: Path) -> None:
        mock_run.return_value = _make_completed(
            stderr="ERROR: [youtube] abc: Private video", returncode=1
        )
        with pytest.raises(DownloadError, match="riêng tư"):
            get_info("https://youtube.com/watch?v=abc", ytdlp_path=tmp_dir / "yt-dlp.exe")


class TestDownload:
    def test_success_no_sections(self, mock_subprocess: MagicMock, tmp_dir: Path) -> None:
        process = MagicMock()
        process.stdout = iter([])  # no stderr lines
        process.returncode = 0
        process.wait.return_value = 0
        mock_subprocess.return_value = process

        out = tmp_dir / "video.mp4"
        downloader = Downloader(ytdlp_path=tmp_dir / "yt-dlp.exe")
        result = downloader.download(
            url="https://youtube.com/watch?v=abc",
            sections=None,
            out_path=out,
            on_progress=lambda p: None,
        )
        assert result == out

    def test_success_with_sections(self, mock_subprocess: MagicMock, tmp_dir: Path) -> None:
        process = MagicMock()
        process.stdout = iter([])
        process.returncode = 0
        process.wait.return_value = 0
        mock_subprocess.return_value = process

        out = tmp_dir / "trim.mp4"
        downloader = Downloader(ytdlp_path=tmp_dir / "yt-dlp.exe")
        result = downloader.download(
            url="https://youtube.com/watch?v=abc",
            sections="*0-30",
            out_path=out,
            on_progress=lambda p: None,
        )
        assert result == out
        # Verify --download-sections was passed
        args = mock_subprocess.call_args[0][0]
        assert "--download-sections" in args
        assert "*0-30" in args

    def test_progress_callback_invoked(self, mock_subprocess: MagicMock, tmp_dir: Path) -> None:
        lines = [
            b"[download]  25.0% of 100MiB at 5MiB/s ETA 00:15\n",
            b"[download]  50.0% of 100MiB at 5MiB/s ETA 00:10\n",
            b"[download] 100.0% of 100MiB at 5MiB/s in 00:20\n",
        ]
        process = MagicMock()
        process.stdout = iter(lines)
        process.returncode = 0
        process.wait.return_value = 0
        mock_subprocess.return_value = process

        out = tmp_dir / "video.mp4"
        progresses: list[float] = []
        downloader = Downloader(ytdlp_path=tmp_dir / "yt-dlp.exe")
        downloader.download(
            url="https://youtube.com/watch?v=abc",
            sections=None,
            out_path=out,
            on_progress=lambda p: progresses.append(p),
        )
        assert progresses == [25.0, 50.0, 100.0]

    def test_retry_on_network_error(self, mock_subprocess: MagicMock, tmp_dir: Path) -> None:
        # First 2 attempts fail with network error, 3rd succeeds
        fail = MagicMock()
        fail.stdout = iter([b"ERROR: connection reset by peer\n"])
        fail.returncode = 1
        fail.wait.return_value = 1

        success = MagicMock()
        success.stdout = iter([])
        success.returncode = 0
        success.wait.return_value = 0

        mock_subprocess.side_effect = [fail, fail, success]

        out = tmp_dir / "video.mp4"
        downloader = Downloader(ytdlp_path=tmp_dir / "yt-dlp.exe", retry_backoff_base=0)
        result = downloader.download(
            url="https://youtube.com/watch?v=abc",
            sections=None,
            out_path=out,
            on_progress=lambda p: None,
        )
        assert result == out
        assert mock_subprocess.call_count == 3

    def test_failure_raises_after_retries(self, mock_subprocess: MagicMock, tmp_dir: Path) -> None:
        fail = MagicMock()
        fail.stdout = iter([b"ERROR: timeout\n"])
        fail.returncode = 1
        fail.wait.return_value = 1
        mock_subprocess.return_value = fail

        out = tmp_dir / "video.mp4"
        downloader = Downloader(ytdlp_path=tmp_dir / "yt-dlp.exe", retry_backoff_base=0)
        with pytest.raises(DownloadError, match="timeout"):
            downloader.download(
                url="https://youtube.com/watch?v=abc",
                sections=None,
                out_path=out,
                on_progress=lambda p: None,
            )
        assert mock_subprocess.call_count == 3
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /c/Users/MSI/Projects/ClipForge
pytest tests/test_downloader.py -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'hypersnip.services.downloader'`

- [ ] **Step 3: Implement `downloader.py`**

File: `C:\Users\MSI\Projects\ClipForge\src\hypersnip\services\downloader.py`

```python
"""yt-dlp subprocess wrapper for getting video info and downloading."""

from __future__ import annotations

import json
import logging
import re
import subprocess
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

from hypersnip.exceptions import DownloadError
from hypersnip.models import VideoInfo
from hypersnip.services.ffmpeg_paths import resolve_ytdlp
from hypersnip.services.progress_parser import (
    parse_ytdlp_error,
    parse_ytdlp_progress,
)

logger = logging.getLogger(__name__)

# Network error patterns that trigger retry
_NETWORK_ERROR_RE = re.compile(
    r"timeout|connection|reset|unreachable|network|temporary", re.IGNORECASE
)


def get_info(url: str, ytdlp_path: Path | None = None) -> VideoInfo:
    """Fetch video metadata via `yt-dlp --dump-json`.

    Args:
        url: YouTube video URL.
        ytdlp_path: Optional override for yt-dlp.exe path.

    Returns:
        VideoInfo populated from yt-dlp JSON output.

    Raises:
        DownloadError: if yt-dlp exits non-zero or output is invalid.
    """
    bin_path = ytdlp_path or resolve_ytdlp()
    cmd = [
        str(bin_path),
        "--dump-json",
        "--no-warnings",
        "--no-playlist",
        url,
    ]
    logger.info("yt-dlp get_info: %s", url)
    result = subprocess.run(cmd, capture_output=True, text=True, check=False, encoding="utf-8")

    if result.returncode != 0:
        err_msg = parse_ytdlp_error(result.stderr) or f"yt-dlp failed: {result.stderr[:200]}"
        raise DownloadError(err_msg)

    try:
        data: dict[str, Any] = json.loads(result.stdout)
    except json.JSONDecodeError as e:
        raise DownloadError(f"Invalid JSON from yt-dlp: {e}") from e

    return VideoInfo(
        title=data.get("title", "Unknown"),
        duration=float(data.get("duration", 0)),
        thumbnail_url=data.get("thumbnail", ""),
        width=int(data.get("width", 0)),
        height=int(data.get("height", 0)),
        fps=float(data.get("fps", 30)),
        formats=[f.get("format_id", "") for f in data.get("formats", []) if f.get("format_id")],
    )


class Downloader:
    """Stateful downloader with retry + progress callback."""

    def __init__(
        self,
        ytdlp_path: Path | None = None,
        max_retries: int = 3,
        retry_backoff_base: float = 2.0,
    ) -> None:
        self.ytdlp_path = ytdlp_path or resolve_ytdlp()
        self.max_retries = max_retries
        self.retry_backoff_base = retry_backoff_base

    def download(
        self,
        url: str,
        sections: str | None,
        out_path: Path,
        on_progress: Callable[[float], None],
    ) -> Path:
        """Download video with optional section trimming.

        Args:
            url: YouTube URL.
            sections: yt-dlp section spec (e.g. "*0-30") or None.
            out_path: Where to save the downloaded file.
            on_progress: Callback invoked with percent (0-100) per stderr line.

        Returns:
            Path to downloaded file (== out_path on success).

        Raises:
            DownloadError: after exhausting retries on network errors,
                or immediately on non-network errors (private video, etc.).
        """
        cmd: list[str] = [
            str(self.ytdlp_path),
            "-f",
            "bv*+ba/b",
            "-N",
            "16",
            "--merge-output-format",
            "mp4",
        ]
        if sections:
            cmd.extend(["--download-sections", sections])
        cmd.extend(["-o", str(out_path), url])

        last_error = ""
        for attempt in range(1, self.max_retries + 1):
            logger.info("yt-dlp download attempt %d/%d: %s", attempt, self.max_retries, url)
            try:
                self._run_download(cmd, on_progress)
                return out_path
            except DownloadError as e:
                last_error = str(e)
                if attempt < self.max_retries and _NETWORK_ERROR_RE.search(last_error):
                    backoff = self.retry_backoff_base ** attempt
                    logger.warning("Retry %d after %.1fs: %s", attempt, backoff, last_error)
                    time.sleep(backoff)
                    continue
                raise

        # Should not reach here, but be safe
        raise DownloadError(last_error)

    def _run_download(
        self, cmd: list[str], on_progress: Callable[[float], None]
    ) -> None:
        """Run a single download attempt. Raises DownloadError on failure."""
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,  # yt-dlp logs to stderr
            text=True,
            encoding="utf-8",
        )
        assert process.stdout is not None
        captured: list[str] = []
        for line in process.stdout:
            captured.append(line)
            percent = parse_ytdlp_progress(line)
            if percent is not None:
                on_progress(percent)
        returncode = process.wait()

        if returncode != 0:
            full_stderr = "".join(captured)
            err_msg = parse_ytdlp_error(full_stderr) or f"yt-dlp failed: {full_stderr[:200]}"
            raise DownloadError(err_msg)
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /c/Users/MSI/Projects/ClipForge
pytest tests/test_downloader.py -v
```

Expected: 7 passed

- [ ] **Step 5: Commit**

```bash
cd /c/Users/MSI/Projects/ClipForge
git add src/hypersnip/services/downloader.py tests/test_downloader.py
git commit -m "feat(services): add yt-dlp downloader with retry and progress callback"
```

---

### Task 8: `renderer.py` — ffmpeg Subprocess Wrapper

**Files:**
- Create: `C:\Users\MSI\Projects\ClipForge\src\hypersnip\services\renderer.py`
- Create: `C:\Users\MSI\Projects\ClipForge\tests\test_renderer.py`

- [ ] **Step 1: Write failing tests**

File: `C:\Users\MSI\Projects\ClipForge\tests\test_renderer.py`

```python
"""Tests for the ffmpeg renderer service."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock

import pytest

from hypersnip.exceptions import RenderError
from hypersnip.models import RenderConfig
from hypersnip.services.hardware_detector import HardwareInfo
from hypersnip.services.renderer import Renderer, build_ffmpeg_command


class TestBuildFfmpegCommand:
    def test_nvenc_encoder(self, tmp_dir: Path) -> None:
        config = RenderConfig(preset="p1", bitrate="12M")
        hw = HardwareInfo(
            gpu_name="RTX 5080", gpu_memory_mb=16384, nvenc_supported=True, cpu_count=24, ram_total_gb=64
        )
        cmd = build_ffmpeg_command(
            ffmpeg_path=tmp_dir / "ffmpeg.exe",
            input_path=tmp_dir / "in.mp4",
            trim_start=10.0,
            trim_end=30.0,
            output_path=tmp_dir / "out.mp4",
            config=config,
            hardware=hw,
        )
        assert "-c:v" in cmd
        idx = cmd.index("-c:v")
        assert cmd[idx + 1] == "h264_nvenc"
        assert "-preset" in cmd
        assert "p1" in cmd
        assert "-b:v" in cmd
        assert "12M" in cmd

    def test_libx264_fallback(self, tmp_dir: Path) -> None:
        config = RenderConfig(preset="medium", bitrate="0", width=1920, height=1080, fps=30)
        hw = HardwareInfo(
            gpu_name=None, gpu_memory_mb=0, nvenc_supported=False, cpu_count=4, ram_total_gb=8
        )
        cmd = build_ffmpeg_command(
            ffmpeg_path=tmp_dir / "ffmpeg.exe",
            input_path=tmp_dir / "in.mp4",
            trim_start=0.0,
            trim_end=60.0,
            output_path=tmp_dir / "out.mp4",
            config=config,
            hardware=hw,
        )
        idx = cmd.index("-c:v")
        assert cmd[idx + 1] == "libx264"
        # CRF mode (bitrate=0 → use -crf 18)
        assert "-crf" in cmd
        assert "18" in cmd

    def test_ull_preset_maps_to_ultrafast_for_libx264(self, tmp_dir: Path) -> None:
        config = RenderConfig(preset="ull", bitrate="6M", width=1280, height=720, fps=30)
        hw = HardwareInfo(
            gpu_name=None, gpu_memory_mb=0, nvenc_supported=False, cpu_count=4, ram_total_gb=8
        )
        cmd = build_ffmpeg_command(
            ffmpeg_path=tmp_dir / "ffmpeg.exe",
            input_path=tmp_dir / "in.mp4",
            trim_start=0.0,
            trim_end=30.0,
            output_path=tmp_dir / "out.mp4",
            config=config,
            hardware=hw,
        )
        idx = cmd.index("-preset")
        assert cmd[idx + 1] == "ultrafast"

    def test_ull_preset_kept_for_nvenc(self, tmp_dir: Path) -> None:
        config = RenderConfig(preset="ull", bitrate="6M", width=1280, height=720, fps=30)
        hw = HardwareInfo(
            gpu_name="RTX", gpu_memory_mb=8192, nvenc_supported=True, cpu_count=8, ram_total_gb=16
        )
        cmd = build_ffmpeg_command(
            ffmpeg_path=tmp_dir / "ffmpeg.exe",
            input_path=tmp_dir / "in.mp4",
            trim_start=0.0,
            trim_end=30.0,
            output_path=tmp_dir / "out.mp4",
            config=config,
            hardware=hw,
        )
        idx = cmd.index("-preset")
        assert cmd[idx + 1] == "ull"  # NVENC accepts "ull"

    def test_filter_graph_contains_scale(self, tmp_dir: Path) -> None:
        config = RenderConfig(preset="p1", bitrate="12M", width=1920, height=1080, fps=30)
        hw = HardwareInfo(
            gpu_name="RTX", gpu_memory_mb=8192, nvenc_supported=True, cpu_count=8, ram_total_gb=16
        )
        cmd = build_ffmpeg_command(
            ffmpeg_path=tmp_dir / "ffmpeg.exe",
            input_path=tmp_dir / "in.mp4",
            trim_start=0.0,
            trim_end=30.0,
            output_path=tmp_dir / "out.mp4",
            config=config,
            hardware=hw,
        )
        idx = cmd.index("-vf")
        filter_str = cmd[idx + 1]
        assert "fps=30" in filter_str
        assert "scale=1920:1080" in filter_str
        assert "setpts=PTS-STARTPTS" in filter_str

    def test_trim_args_present(self, tmp_dir: Path) -> None:
        config = RenderConfig(preset="p1", bitrate="12M")
        hw = HardwareInfo(
            gpu_name=None, gpu_memory_mb=0, nvenc_supported=False, cpu_count=4, ram_total_gb=8
        )
        cmd = build_ffmpeg_command(
            ffmpeg_path=tmp_dir / "ffmpeg.exe",
            input_path=tmp_dir / "in.mp4",
            trim_start=15.5,
            trim_end=45.5,
            output_path=tmp_dir / "out.mp4",
            config=config,
            hardware=hw,
        )
        assert "-ss" in cmd
        assert "15.5" in cmd
        assert "-to" in cmd
        assert "45.5" in cmd


class TestRenderer:
    def test_render_success(self, mock_subprocess: MagicMock, tmp_dir: Path) -> None:
        process = MagicMock()
        process.stdout = iter([])
        process.returncode = 0
        process.wait.return_value = 0
        mock_subprocess.return_value = process

        hw = HardwareInfo(
            gpu_name="RTX", gpu_memory_mb=8192, nvenc_supported=True, cpu_count=8, ram_total_gb=16
        )
        config = RenderConfig(preset="p1", bitrate="12M")
        renderer = Renderer(hardware=hw, ffmpeg_path=tmp_dir / "ffmpeg.exe")

        progresses: list[float] = []
        result = renderer.render(
            input_path=tmp_dir / "in.mp4",
            trim_start=0.0,
            trim_end=30.0,
            output_path=tmp_dir / "out.mp4",
            config=config,
            on_progress=lambda p: progresses.append(p),
        )
        assert result == tmp_dir / "out.mp4"

    def test_render_failure_raises(self, mock_subprocess: MagicMock, tmp_dir: Path) -> None:
        process = MagicMock()
        process.stdout = iter([b"Error: Invalid data found when processing input\n"])
        process.returncode = 1
        process.wait.return_value = 1
        mock_subprocess.return_value = process

        hw = HardwareInfo(
            gpu_name=None, gpu_memory_mb=0, nvenc_supported=False, cpu_count=4, ram_total_gb=8
        )
        config = RenderConfig(preset="medium", bitrate="0")
        renderer = Renderer(hardware=hw, ffmpeg_path=tmp_dir / "ffmpeg.exe")

        with pytest.raises(RenderError, match="Invalid"):
            renderer.render(
                input_path=tmp_dir / "in.mp4",
                trim_start=0.0,
                trim_end=30.0,
                output_path=tmp_dir / "out.mp4",
                config=config,
                on_progress=lambda p: None,
            )

    def test_progress_callback(self, mock_subprocess: MagicMock, tmp_dir: Path) -> None:
        # 30-second trim, 50% point at 15s
        lines = [
            b"frame= 450 fps=60 q=28.0 size= 10240kB time=00:00:15.00 bitrate= 950.0kbits/s\n",
        ]
        process = MagicMock()
        process.stdout = iter(lines)
        process.returncode = 0
        process.wait.return_value = 0
        mock_subprocess.return_value = process

        hw = HardwareInfo(
            gpu_name="RTX", gpu_memory_mb=8192, nvenc_supported=True, cpu_count=8, ram_total_gb=16
        )
        config = RenderConfig(preset="p1", bitrate="12M")
        renderer = Renderer(hardware=hw, ffmpeg_path=tmp_dir / "ffmpeg.exe")

        progresses: list[float] = []
        renderer.render(
            input_path=tmp_dir / "in.mp4",
            trim_start=0.0,
            trim_end=30.0,
            output_path=tmp_dir / "out.mp4",
            config=config,
            on_progress=lambda p: progresses.append(p),
        )
        assert progresses == [50.0]
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /c/Users/MSI/Projects/ClipForge
pytest tests/test_renderer.py -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'hypersnip.services.renderer'`

- [ ] **Step 3: Implement `renderer.py`**

File: `C:\Users\MSI\Projects\ClipForge\src\hypersnip\services\renderer.py`

```python
"""ffmpeg subprocess wrapper for trimming + transcoding."""

from __future__ import annotations

import logging
import subprocess
from collections.abc import Callable
from pathlib import Path

from hypersnip.exceptions import RenderError
from hypersnip.models import RenderConfig
from hypersnip.services.ffmpeg_paths import resolve_ffmpeg
from hypersnip.services.hardware_detector import HardwareInfo
from hypersnip.services.progress_parser import parse_ffmpeg_progress

logger = logging.getLogger(__name__)


def build_ffmpeg_command(
    ffmpeg_path: Path,
    input_path: Path,
    trim_start: float,
    trim_end: float,
    output_path: Path,
    config: RenderConfig,
    hardware: HardwareInfo,
) -> list[str]:
    """Build the ffmpeg command list.

    Encoder selection:
        - h264_nvenc if NVENC supported (RTX 5080 primary)
        - libx264 fallback (CRF 18 for non-NVENC machines)

    Preset mapping:
        - "ull" stays "ull" for NVENC, becomes "ultrafast" for libx264
        - "p1"-"p7" pass through
    """
    encoder = "h264_nvenc" if hardware.nvenc_supported else "libx264"

    if encoder == "libx264":
        preset = "ultrafast" if config.preset == "ull" else config.preset
    else:
        preset = config.preset

    filter_chain = (
        f"fps={config.fps},"
        f"setpts=PTS-STARTPTS,"
        f"scale={config.width}:{config.height}:flags=lanczos"
    )

    cmd: list[str] = [
        str(ffmpeg_path),
        "-y",
        "-ss",
        str(trim_start),
        "-to",
        str(trim_end),
        "-i",
        str(input_path),
        "-vf",
        filter_chain,
        "-c:v",
        encoder,
        "-preset",
        preset,
    ]

    if encoder == "libx264" and config.bitrate == "0":
        # Use CRF mode for libx264 when bitrate not specified
        cmd.extend(["-crf", "18"])
    else:
        cmd.extend(["-b:v", config.bitrate])

    cmd.extend(["-c:a", "aac", "-b:a", "192k", str(output_path)])
    return cmd


class Renderer:
    """ffmpeg subprocess runner with progress callback."""

    def __init__(
        self,
        hardware: HardwareInfo,
        ffmpeg_path: Path | None = None,
    ) -> None:
        self.hardware = hardware
        self.ffmpeg_path = ffmpeg_path or resolve_ffmpeg()

    def render(
        self,
        input_path: Path,
        trim_start: float,
        trim_end: float,
        output_path: Path,
        config: RenderConfig,
        on_progress: Callable[[float], None],
    ) -> Path:
        """Run ffmpeg with the given config.

        Args:
            input_path: Source video file.
            trim_start: Start time in seconds.
            trim_end: End time in seconds.
            output_path: Where to write the rendered file.
            config: Render settings (preset, bitrate, resolution, fps).
            on_progress: Callback invoked with percent (0-100) per stderr line.

        Returns:
            Path to rendered file (== output_path on success).

        Raises:
            RenderError: if ffmpeg exits non-zero.
        """
        total_duration = trim_end - trim_start
        if total_duration <= 0:
            raise RenderError(f"Invalid trim range: {trim_start} to {trim_end}")

        cmd = build_ffmpeg_command(
            ffmpeg_path=self.ffmpeg_path,
            input_path=input_path,
            trim_start=trim_start,
            trim_end=trim_end,
            output_path=output_path,
            config=config,
            hardware=self.hardware,
        )
        logger.info("ffmpeg render: %s", " ".join(cmd))

        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
        )
        assert process.stdout is not None
        captured: list[str] = []
        for line in process.stdout:
            captured.append(line)
            progress = parse_ffmpeg_progress(line)
            if progress and total_duration > 0:
                pct = min(100.0, (progress.time_seconds / total_duration) * 100)
                on_progress(pct)

        returncode = process.wait()
        if returncode != 0:
            full_stderr = "".join(captured)
            raise RenderError(f"ffmpeg failed: {full_stderr[:500]}")

        return output_path
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /c/Users/MSI/Projects/ClipForge
pytest tests/test_renderer.py -v
```

Expected: 9 passed

- [ ] **Step 5: Commit**

```bash
cd /c/Users/MSI/Projects/ClipForge
git add src/hypersnip/services/renderer.py tests/test_renderer.py
git commit -m "feat(services): add ffmpeg renderer with NVENC and libx264 fallback"
```

---

## Phase 3: UI Workers

### Task 9: `workers.py` — QThread Worker Pattern

**Files:**
- Create: `C:\Users\MSI\Projects\ClipForge\src\hypersnip\ui\workers.py`

(No test file for this task — workers are tested implicitly via UI integration. The services they wrap are already tested in Phase 2.)

- [ ] **Step 1: Implement `workers.py`**

File: `C:\Users\MSI\Projects\ClipForge\src\hypersnip\ui\workers.py`

```python
"""QObject workers for QThread-based async work."""

from __future__ import annotations

import logging
from pathlib import Path

from PySide6.QtCore import QObject, Signal

from hypersnip.models import RenderConfig, VideoInfo
from hypersnip.services.downloader import Downloader, get_info
from hypersnip.services.hardware_detector import detect
from hypersnip.services.renderer import Renderer

logger = logging.getLogger(__name__)


class ParseWorker(QObject):
    """Runs `yt-dlp --dump-json` to fetch video info."""

    info_ready = Signal(VideoInfo)
    failed = Signal(str)

    def run(self, url: str) -> None:
        try:
            logger.info("ParseWorker: %s", url)
            info = get_info(url)
            self.info_ready.emit(info)
        except Exception as e:  # noqa: BLE001
            logger.exception("ParseWorker failed")
            self.failed.emit(str(e))


class DownloadWorker(QObject):
    """Runs yt-dlp download with progress callback."""

    progress = Signal(int)
    log = Signal(str)
    finished = Signal(Path)
    failed = Signal(str)

    def run(self, url: str, sections: str | None, out_path: Path) -> None:
        try:
            logger.info("DownloadWorker: %s -> %s", url, out_path)
            downloader = Downloader()

            def on_progress(percent: float) -> None:
                self.progress.emit(int(percent))

            result = downloader.download(url, sections, out_path, on_progress)
            self.finished.emit(result)
        except Exception as e:  # noqa: BLE001
            logger.exception("DownloadWorker failed")
            self.failed.emit(str(e))


class RenderWorker(QObject):
    """Runs ffmpeg render with progress callback."""

    progress = Signal(int)
    log = Signal(str)
    finished = Signal(Path)
    failed = Signal(str)

    def run(
        self,
        input_path: Path,
        trim_start: float,
        trim_end: float,
        config: RenderConfig,
    ) -> None:
        try:
            logger.info("RenderWorker: %s", input_path)
            hw = detect()
            renderer = Renderer(hardware=hw)

            def on_progress(percent: float) -> None:
                self.progress.emit(int(percent))

            result = renderer.render(input_path, trim_start, trim_end, out_path_via_config(config), config, on_progress)
            self.finished.emit(result)
        except Exception as e:  # noqa: BLE001
            logger.exception("RenderWorker failed")
            self.failed.emit(str(e))


def out_path_via_config(config: RenderConfig) -> Path:
    """Resolve output path from config (output_dir + auto-generated filename)."""
    config.output_dir.mkdir(parents=True, exist_ok=True)
    return config.output_dir / "rendered.mp4"
```

- [ ] **Step 2: Verify import works**

```bash
cd /c/Users/MSI/Projects/ClipForge
python -c "from hypersnip.ui.workers import ParseWorker, DownloadWorker, RenderWorker; print('ok')"
```

Expected: `ok`

- [ ] **Step 3: Commit**

```bash
cd /c/Users/MSI/Projects/ClipForge
git add src/hypersnip/ui/workers.py
git commit -m "feat(ui): add QThread workers for parse, download, render"
```

---

## Phase 4: UI Widgets

### Task 10: `url_input.py` — URL Input Widget

**Files:**
- Create: `C:\Users\MSI\Projects\ClipForge\src\hypersnip\ui\widgets\url_input.py`
- Create: `C:\Users\MSI\Projects\ClipForge\tests\ui\test_url_input.py`

- [ ] **Step 1: Write failing test**

File: `C:\Users\MSI\Projects\ClipForge\tests\ui\test_url_input.py`

```python
"""Tests for UrlInput widget."""

from __future__ import annotations

import pytest
from PySide6.QtWidgets import QApplication

from hypersnip.ui.widgets.url_input import UrlInput


@pytest.fixture
def app(qtbot: pytestqt.qtbot.QtBot) -> QApplication:
    return QApplication.instance() or QApplication([])


def test_paste_url_and_click_parse_emits_signal(qtbot: pytestqt.qtbot.QtBot, app: QApplication) -> None:
    widget = UrlInput()
    qtbot.addWidget(widget)

    with qtbot.waitSignal(widget.parse_requested, timeout=1000) as blocker:
        widget.url_edit.setText("https://youtube.com/watch?v=abc123")
        widget.parse_btn.click()

    assert blocker.args[0] == "https://youtube.com/watch?v=abc123"


def test_empty_url_does_not_emit(qtbot: pytestqt.qtbot.QtBot, app: QApplication) -> None:
    widget = UrlInput()
    qtbot.addWidget(widget)

    with qtbot.assertNotEmitted(widget.parse_requested, wait=200):
        widget.url_edit.setText("")
        widget.parse_btn.click()


def test_invalid_url_does_not_emit(qtbot: pytestqt.qtbot.QtBot, app: QApplication) -> None:
    widget = UrlInput()
    qtbot.addWidget(widget)

    with qtbot.assertNotEmitted(widget.parse_requested, wait=200):
        widget.url_edit.setText("not-a-youtube-url")
        widget.parse_btn.click()


def test_set_enabled_toggles_button(qtbot: pytestqt.qtbot.QtBot, app: QApplication) -> None:
    widget = UrlInput()
    qtbot.addWidget(widget)

    widget.set_enabled(False)
    assert not widget.parse_btn.isEnabled()
    widget.set_enabled(True)
    assert widget.parse_btn.isEnabled()
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /c/Users/MSI/Projects/ClipForge
pytest tests/ui/test_url_input.py -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'hypersnip.ui.widgets.url_input'`

- [ ] **Step 3: Implement `url_input.py`**

File: `C:\Users\MSI\Projects\ClipForge\src\hypersnip\ui\widgets\url_input.py`

```python
"""URL input widget with Parse button."""

from __future__ import annotations

import re

from PySide6.QtCore import Signal
from PySide6.QtWidgets import QHBoxLayout, QLineEdit, QPushButton, QWidget

_YT_URL_RE = re.compile(r"^https?://(www\.)?(youtube\.com|youtu\.be)/.+", re.IGNORECASE)


class UrlInput(QWidget):
    """QLineEdit + Parse button. Emits parse_requested(url) on click."""

    parse_requested = Signal(str)

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        layout = QHBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)

        self.url_edit = QLineEdit()
        self.url_edit.setPlaceholderText("Paste YouTube URL and press Enter...")
        self.url_edit.returnPressed.connect(self._on_parse)

        self.parse_btn = QPushButton("Parse")
        self.parse_btn.clicked.connect(self._on_parse)

        layout.addWidget(self.url_edit, 1)
        layout.addWidget(self.parse_btn, 0)

    def _on_parse(self) -> None:
        url = self.url_edit.text().strip()
        if not url or not _YT_URL_RE.match(url):
            return
        self.parse_requested.emit(url)

    def set_enabled(self, enabled: bool) -> None:
        """Enable/disable the entire widget."""
        self.url_edit.setEnabled(enabled)
        self.parse_btn.setEnabled(enabled)

    def clear(self) -> None:
        self.url_edit.clear()
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /c/Users/MSI/Projects/ClipForge
pytest tests/ui/test_url_input.py -v
```

Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
cd /c/Users/MSI/Projects/ClipForge
git add src/hypersnip/ui/widgets/url_input.py tests/ui/test_url_input.py
git commit -m "feat(ui): add UrlInput widget with URL validation"
```

---

### Task 11: `video_info.py` — Video Info Display

**Files:**
- Create: `C:\Users\MSI\Projects\ClipForge\src\hypersnip\ui\widgets\video_info.py`

(Skip widget-level tests — QPixmap network loading is hard to test reliably; covered by manual smoke test in Task 18.)

- [ ] **Step 1: Implement `video_info.py`**

File: `C:\Users\MSI\Projects\ClipForge\src\hypersnip\ui\widgets\video_info.py`

```python
"""Video info display widget."""

from __future__ import annotations

import logging

from PySide6.QtCore import QSize, Qt, QUrl
from PySide6.QtGui import QPixmap
from PySide6.QtNetwork import QNetworkAccessManager, QNetworkReply, QNetworkRequest
from PySide6.QtWidgets import QLabel, QVBoxLayout, QWidget

from hypersnip.models import VideoInfo

logger = logging.getLogger(__name__)


def _format_duration(seconds: float) -> str:
    """Format seconds as `m:ss` or `h:mm:ss`."""
    total = int(seconds)
    h, rem = divmod(total, 3600)
    m, s = divmod(rem, 60)
    if h > 0:
        return f"{h}:{m:02d}:{s:02d}"
    return f"{m}:{s:02d}"


class VideoInfoWidget(QWidget):
    """Displays title, duration, resolution, and thumbnail for a parsed video."""

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self._nam = QNetworkAccessManager(self)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(8)

        self.thumbnail_label = QLabel()
        self.thumbnail_label.setFixedSize(QSize(320, 180))
        self.thumbnail_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.thumbnail_label.setStyleSheet(
            "background-color: #1E1E1E; color: #888; border: 1px solid #2A2A2A;"
        )
        self.thumbnail_label.setText("(no thumbnail)")

        self.title_label = QLabel("(no video)")
        self.title_label.setStyleSheet("font-size: 14px; font-weight: 600; color: #E0E0E0;")
        self.title_label.setWordWrap(True)

        self.meta_label = QLabel("")
        self.meta_label.setStyleSheet("color: #888; font-size: 12px;")

        layout.addWidget(self.thumbnail_label)
        layout.addWidget(self.title_label)
        layout.addWidget(self.meta_label)
        layout.addStretch(1)

    def display(self, info: VideoInfo) -> None:
        """Update the widget with parsed video info."""
        self.title_label.setText(info.title)
        meta = (
            f"{_format_duration(info.duration)}  •  "
            f"{info.width}x{info.height}  •  "
            f"{info.fps:.1f}fps"
        )
        self.meta_label.setText(meta)
        self._load_thumbnail(info.thumbnail_url)

    def _load_thumbnail(self, url: str) -> None:
        """Load thumbnail from URL using QNetworkAccessManager (async)."""
        if not url:
            return
        self.thumbnail_label.setText("Loading...")
        request = QNetworkRequest(QUrl(url))
        reply = self._nam.get(request)
        reply.finished.connect(lambda: self._on_thumbnail_loaded(reply))

    def _on_thumbnail_loaded(self, reply: QNetworkReply) -> None:
        if reply.error() != QNetworkReply.NetworkError.NoError:
            logger.warning("Thumbnail load failed: %s", reply.errorString())
            self.thumbnail_label.setText("(thumbnail unavailable)")
            reply.deleteLater()
            return
        data = reply.readAll()
        pixmap = QPixmap()
        if pixmap.loadFromData(data):
            scaled = pixmap.scaled(
                320,
                180,
                Qt.AspectRatioMode.KeepAspectRatio,
                Qt.TransformationMode.SmoothTransformation,
            )
            self.thumbnail_label.setPixmap(scaled)
        else:
            self.thumbnail_label.setText("(invalid thumbnail)")
        reply.deleteLater()
```

- [ ] **Step 2: Verify import works**

```bash
cd /c/Users/MSI/Projects/ClipForge
python -c "from hypersnip.ui.widgets.video_info import VideoInfoWidget; print('ok')"
```

Expected: `ok`

- [ ] **Step 3: Commit**

```bash
cd /c/Users/MSI/Projects/ClipForge
git add src/hypersnip/ui/widgets/video_info.py
git commit -m "feat(ui): add VideoInfoWidget with async thumbnail loading"
```

---

### Task 12: `trim_panel.py` — Trim Range Slider

**Files:**
- Create: `C:\Users\MSI\Projects\ClipForge\src\hypersnip\ui\widgets\trim_panel.py`
- Create: `C:\Users\MSI\Projects\ClipForge\tests\ui\test_trim_panel.py`

- [ ] **Step 1: Write failing test**

File: `C:\Users\MSI\Projects\ClipForge\tests\ui\test_trim_panel.py`

```python
"""Tests for TrimPanel widget."""

from __future__ import annotations

import pytest
from PySide6.QtWidgets import QApplication

from hypersnip.ui.widgets.trim_panel import TrimPanel


@pytest.fixture
def app(qtbot: pytestqt.qtbot.QtBot) -> QApplication:
    return QApplication.instance() or QApplication([])


def test_set_duration_enables_widgets(qtbot: pytestqt.qtbot.QtBot, app: QApplication) -> None:
    panel = TrimPanel()
    qtbot.addWidget(panel)
    panel.set_duration(60.0)
    assert panel.start_slider.maximum() == 60
    assert panel.end_slider.maximum() == 60


def test_trim_values_initial(qtbot: pytestqt.qtbot.QtBot, app: QApplication) -> None:
    panel = TrimPanel()
    qtbot.addWidget(panel)
    panel.set_duration(60.0)
    assert panel.get_trim() == (0.0, 60.0)


def test_end_cannot_be_less_than_start(qtbot: pytestqt.qtbot.QtBot, app: QApplication) -> None:
    panel = TrimPanel()
    qtbot.addWidget(panel)
    panel.set_duration(60.0)
    panel.start_slider.setValue(30)
    panel.end_slider.setValue(20)  # try to set end < start
    assert panel.end_slider.value() >= panel.start_slider.value()


def test_trim_changed_signal_emitted(qtbot: pytestqt.qtbot.QtBot, app: QApplication) -> None:
    panel = TrimPanel()
    qtbot.addWidget(panel)
    panel.set_duration(60.0)

    with qtbot.waitSignal(panel.trim_changed, timeout=1000) as blocker:
        panel.start_slider.setValue(10)

    start, end = blocker.args
    assert start == 10.0
    assert end == 60.0  # end was at max
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /c/Users/MSI/Projects/ClipForge
pytest tests/ui/test_trim_panel.py -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'hypersnip.ui.widgets.trim_panel'`

- [ ] **Step 3: Implement `trim_panel.py`**

File: `C:\Users\MSI\Projects\ClipForge\src\hypersnip\ui\widgets\trim_panel.py`

```python
"""Trim range slider with start/end controls."""

from __future__ import annotations

from PySide6.QtCore import Signal
from PySide6.QtWidgets import (
    QFormLayout,
    QHBoxLayout,
    QLabel,
    QSlider,
    QSpinBox,
    QVBoxLayout,
    QWidget,
)


class TrimPanel(QWidget):
    """Start/end slider + spinbox. Emits trim_changed(start, end) in seconds."""

    trim_changed = Signal(float, float)

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self._duration = 0.0
        self._suppress_signal = False

        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)

        # Start row
        start_row = QHBoxLayout()
        start_row.addWidget(QLabel("Start"))
        self.start_slider = QSlider()
        self.start_slider.setOrientation(QSlider.Orientation.Horizontal)
        self.start_slider.setMinimum(0)
        self.start_slider.setMaximum(0)  # disabled until duration set
        self.start_spin = QSpinBox()
        self.start_spin.setSuffix("s")
        self.start_spin.setMaximum(0)
        start_row.addWidget(self.start_slider, 1)
        start_row.addWidget(self.start_spin, 0)
        layout.addLayout(start_row)

        # End row
        end_row = QHBoxLayout()
        end_row.addWidget(QLabel("End"))
        self.end_slider = QSlider()
        self.end_slider.setOrientation(QSlider.Orientation.Horizontal)
        self.end_slider.setMinimum(0)
        self.end_slider.setMaximum(0)
        self.end_spin = QSpinBox()
        self.end_spin.setSuffix("s")
        self.end_spin.setMaximum(0)
        end_row.addWidget(self.end_slider, 1)
        end_row.addWidget(self.end_spin, 0)
        layout.addLayout(end_row)

        # Wire bidirectional sync
        self.start_slider.valueChanged.connect(self._on_start_slider)
        self.end_slider.valueChanged.connect(self._on_end_slider)
        self.start_spin.valueChanged.connect(self._on_start_spin)
        self.end_spin.valueChanged.connect(self._on_end_spin)

    def set_duration(self, duration: float) -> None:
        """Set the max duration. Resets trim to full range."""
        self._duration = duration
        max_int = int(duration)
        for w in (self.start_slider, self.end_slider, self.start_spin, self.end_spin):
            w.blockSignals(True)
        self.start_slider.setMaximum(max_int)
        self.end_slider.setMaximum(max_int)
        self.start_spin.setMaximum(max_int)
        self.end_spin.setMaximum(max_int)
        self.start_slider.setValue(0)
        self.end_slider.setValue(max_int)
        for w in (self.start_slider, self.end_slider, self.start_spin, self.end_spin):
            w.blockSignals(False)
        self._emit_trim()

    def get_trim(self) -> tuple[float, float]:
        return float(self.start_slider.value()), float(self.end_slider.value())

    def _on_start_slider(self, v: int) -> None:
        if v > self.end_slider.value():
            self.end_slider.blockSignals(True)
            self.end_slider.setValue(v)
            self.end_slider.blockSignals(False)
            self.end_spin.blockSignals(True)
            self.end_spin.setValue(v)
            self.end_spin.blockSignals(False)
        self.start_spin.blockSignals(True)
        self.start_spin.setValue(v)
        self.start_spin.blockSignals(False)
        self._emit_trim()

    def _on_end_slider(self, v: int) -> None:
        if v < self.start_slider.value():
            self.start_slider.blockSignals(True)
            self.start_slider.setValue(v)
            self.start_slider.blockSignals(False)
            self.start_spin.blockSignals(True)
            self.start_spin.setValue(v)
            self.start_spin.blockSignals(False)
        self.end_spin.blockSignals(True)
        self.end_spin.setValue(v)
        self.end_spin.blockSignals(False)
        self._emit_trim()

    def _on_start_spin(self, v: int) -> None:
        if v > self.end_slider.value():
            self._suppress_signal = True
        self.start_slider.blockSignals(True)
        self.start_slider.setValue(v)
        self.start_slider.blockSignals(False)
        self._emit_trim()

    def _on_end_spin(self, v: int) -> None:
        if v < self.start_slider.value():
            self._suppress_signal = True
        self.end_slider.blockSignals(True)
        self.end_slider.setValue(v)
        self.end_slider.blockSignals(False)
        self._emit_trim()

    def _emit_trim(self) -> None:
        if self._suppress_signal:
            self._suppress_signal = False
            return
        self.trim_changed.emit(*self.get_trim())
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /c/Users/MSI/Projects/ClipForge
pytest tests/ui/test_trim_panel.py -v
```

Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
cd /c/Users/MSI/Projects/ClipForge
git add src/hypersnip/ui/widgets/trim_panel.py tests/ui/test_trim_panel.py
git commit -m "feat(ui): add TrimPanel with bidirectional slider/spinbox sync"
```

---

### Task 13: `render_panel.py` — Render Settings Panel

**Files:**
- Create: `C:\Users\MSI\Projects\ClipForge\src\hypersnip\ui\widgets\render_panel.py`
- Create: `C:\Users\MSI\Projects\ClipForge\tests\ui\test_render_panel.py`

- [ ] **Step 1: Write failing test**

File: `C:\Users\MSI\Projects\ClipForge\tests\ui\test_render_panel.py`

```python
"""Tests for RenderPanel widget."""

from __future__ import annotations

import pytest
from PySide6.QtWidgets import QApplication

from hypersnip.models import RenderConfig
from hypersnip.ui.widgets.render_panel import RenderPanel


@pytest.fixture
def app(qtbot: pytestqt.qtbot.QtBot) -> QApplication:
    return QApplication.instance() or QApplication([])


def test_default_values(qtbot: pytestqt.qtbot.QtBot, app: QApplication) -> None:
    panel = RenderPanel()
    qtbot.addWidget(panel)
    config = panel.get_config()
    assert config.preset == "p1"
    assert config.bitrate == "12M"
    assert config.width == 1920
    assert config.height == 1080
    assert config.fps == 30


def test_preset_change_emits_signal(qtbot: pytestqt.qtbot.QtBot, app: QApplication) -> None:
    panel = RenderPanel()
    qtbot.addWidget(panel)

    with qtbot.waitSignal(panel.config_changed, timeout=1000) as blocker:
        panel.preset_combo.setCurrentText("ull")
    config: RenderConfig = blocker.args[0]
    assert config.preset == "ull"


def test_bitrate_change(qtbot: pytestqt.qtbot.QtBot, app: QApplication) -> None:
    panel = RenderPanel()
    qtbot.addWidget(panel)
    panel.bitrate_spin.setValue(6)
    config = panel.get_config()
    assert config.bitrate == "6M"


def test_resolution_change(qtbot: pytestqt.qtbot.QtBot, app: QApplication) -> None:
    panel = RenderPanel()
    qtbot.addWidget(panel)
    panel.resolution_combo.setCurrentText("720p")
    config = panel.get_config()
    assert config.width == 1280
    assert config.height == 720
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /c/Users/MSI/Projects/ClipForge
pytest tests/ui/test_render_panel.py -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'hypersnip.ui.widgets.render_panel'`

- [ ] **Step 3: Implement `render_panel.py`**

File: `C:\Users\MSI\Projects\ClipForge\src\hypersnip\ui\widgets\render_panel.py`

```python
"""Render settings panel: preset, bitrate, resolution, output dir."""

from __future__ import annotations

from pathlib import Path

from PySide6.QtCore import Signal
from PySide6.QtWidgets import (
    QComboBox,
    QFileDialog,
    QFormLayout,
    QHBoxLayout,
    QLineEdit,
    QPushButton,
    QSpinBox,
    QVBoxLayout,
    QWidget,
)

from hypersnip.config import DEFAULT_BITRATE, DEFAULT_OUTPUT_DIR, DEFAULT_PRESET
from hypersnip.models import RenderConfig

_RESOLUTIONS: list[tuple[str, int, int]] = [
    ("1080p", 1920, 1080),
    ("720p", 1280, 720),
    ("480p", 854, 480),
]

_PRESETS: list[str] = ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "ull"]


class RenderPanel(QWidget):
    """Form with preset, bitrate, resolution, output dir. Emits config_changed on any change."""

    config_changed = Signal(RenderConfig)

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self._build_ui()
        self._emit_change()

    def _build_ui(self) -> None:
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)

        form = QFormLayout()
        form.setLabelAlignment(form.labelAlignment())

        self.preset_combo = QComboBox()
        self.preset_combo.addItems(_PRESETS)
        self.preset_combo.setCurrentText(DEFAULT_PRESET)

        self.bitrate_spin = QSpinBox()
        self.bitrate_spin.setSuffix("M")
        self.bitrate_spin.setRange(1, 50)
        self.bitrate_spin.setValue(int(DEFAULT_BITRATE.rstrip("M")))

        self.resolution_combo = QComboBox()
        for label, w, h in _RESOLUTIONS:
            self.resolution_combo.addItem(label, (w, h))
        self.resolution_combo.setCurrentText("1080p")

        out_row = QHBoxLayout()
        self.output_edit = QLineEdit(str(DEFAULT_OUTPUT_DIR))
        browse_btn = QPushButton("Browse...")
        browse_btn.clicked.connect(self._on_browse)
        out_row.addWidget(self.output_edit, 1)
        out_row.addWidget(browse_btn, 0)

        form.addRow("Preset", self.preset_combo)
        form.addRow("Bitrate", self.bitrate_spin)
        form.addRow("Resolution", self.resolution_combo)
        form.addRow("Output", out_row)
        layout.addLayout(form)

        # Wire change signals
        self.preset_combo.currentTextChanged.connect(self._emit_change)
        self.bitrate_spin.valueChanged.connect(self._emit_change)
        self.resolution_combo.currentTextChanged.connect(self._emit_change)
        self.output_edit.textChanged.connect(self._emit_change)

    def _on_browse(self) -> None:
        directory = QFileDialog.getExistingDirectory(
            self, "Select Output Directory", self.output_edit.text()
        )
        if directory:
            self.output_edit.setText(directory)

    def get_config(self) -> RenderConfig:
        w, h = self.resolution_combo.currentData()
        return RenderConfig(
            preset=self.preset_combo.currentText(),
            bitrate=f"{self.bitrate_spin.value()}M",
            width=w,
            height=h,
            fps=30,
            output_dir=Path(self.output_edit.text() or str(DEFAULT_OUTPUT_DIR)),
        )

    def _emit_change(self) -> None:
        self.config_changed.emit(self.get_config())
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /c/Users/MSI/Projects/ClipForge
pytest tests/ui/test_render_panel.py -v
```

Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
cd /c/Users/MSI/Projects/ClipForge
git add src/hypersnip/ui/widgets/render_panel.py tests/ui/test_render_panel.py
git commit -m "feat(ui): add RenderPanel with preset/bitrate/resolution/output controls"
```

---

### Task 14: `video_player.py` — QMediaPlayer Wrapper

**Files:**
- Create: `C:\Users\MSI\Projects\ClipForge\src\hypersnip\ui\widgets\video_player.py`

(No widget-level tests — QMediaPlayer playback tested manually in Task 18.)

- [ ] **Step 1: Implement `video_player.py`**

File: `C:\Users\MSI\Projects\ClipForge\src\hypersnip\ui\widgets\video_player.py`

```python
"""QMediaPlayer wrapper for video preview."""

from __future__ import annotations

import logging
from pathlib import Path

from PySide6.QtCore import QEvent, QUrl, Qt
from PySide6.QtGui import QKeyEvent
from PySide6.QtMultimedia import QAudioOutput, QMediaPlayer
from PySide6.QtMultimediaWidgets import QVideoWidget
from PySide6.QtWidgets import QVBoxLayout, QWidget

logger = logging.getLogger(__name__)


class VideoPlayer(QWidget):
    """QMediaPlayer + QVideoWidget with keyboard shortcuts."""

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setFocusPolicy(Qt.FocusPolicy.StrongFocus)

        self._player = QMediaPlayer(self)
        self._audio_output = QAudioOutput(self)
        self._player.setAudioOutput(self._audio_output)

        self._video_widget = QVideoWidget(self)
        self._player.setVideoOutput(self._video_widget)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.addWidget(self._video_widget, 1)

    def load(self, path: Path) -> None:
        """Load a video file for playback."""
        logger.info("VideoPlayer.load: %s", path)
        self._player.setSource(QUrl.fromLocalFile(str(path)))
        self._player.play()

    def play(self) -> None:
        self._player.play()

    def pause(self) -> None:
        self._player.pause()

    def seek(self, seconds: float) -> None:
        self._player.setPosition(int(seconds * 1000))

    def keyPressEvent(self, event: QKeyEvent) -> None:  # noqa: N802
        if event.key() == Qt.Key.Key_Space:
            if self._player.playbackState() == QMediaPlayer.PlaybackState.PlayingState:
                self.pause()
            else:
                self.play()
        elif event.key() == Qt.Key.Key_Left:
            shift = event.modifiers() & Qt.KeyboardModifier.ShiftModifier
            delta = 1 if shift else 5
            self.seek(max(0, self._player.position() / 1000 - delta))
        elif event.key() == Qt.Key.Key_Right:
            shift = event.modifiers() & Qt.KeyboardModifier.ShiftModifier
            delta = 1 if shift else 5
            self.seek(self._player.position() / 1000 + delta)
        else:
            super().keyPressEvent(event)
```

- [ ] **Step 2: Verify import works**

```bash
cd /c/Users/MSI/Projects/ClipForge
python -c "from hypersnip.ui.widgets.video_player import VideoPlayer; print('ok')"
```

Expected: `ok`

- [ ] **Step 3: Commit**

```bash
cd /c/Users/MSI/Projects/ClipForge
git add src/hypersnip/ui/widgets/video_player.py
git commit -m "feat(ui): add VideoPlayer with QMediaPlayer and keyboard shortcuts"
```

---

### Task 15: `progress_log.py` — Progress Bar + Log Display

**Files:**
- Create: `C:\Users\MSI\Projects\ClipForge\src\hypersnip\ui\widgets\progress_log.py`

- [ ] **Step 1: Implement `progress_log.py`**

File: `C:\Users\MSI\Projects\ClipForge\src\hypersnip\ui\widgets\progress_log.py`

```python
"""Progress bar + log display widget."""

from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtGui import QFont
from PySide6.QtWidgets import (
    QHBoxLayout,
    QLabel,
    QPlainTextEdit,
    QProgressBar,
    QPushButton,
    QVBoxLayout,
    QWidget,
)


class ProgressLog(QWidget):
    """Vertical stack: progress bar + log text area + clear button."""

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)

        bar_row = QHBoxLayout()
        self.progress_bar = QProgressBar()
        self.progress_bar.setRange(0, 100)
        self.progress_bar.setValue(0)
        self.progress_bar.setTextVisible(True)
        self.status_label = QLabel("Idle")
        self.status_label.setStyleSheet("color: #888; font-size: 12px;")
        bar_row.addWidget(self.progress_bar, 1)
        bar_row.addWidget(self.status_label, 0)
        layout.addLayout(bar_row)

        self.log_view = QPlainTextEdit()
        self.log_view.setReadOnly(True)
        self.log_view.setMaximumBlockCount(500)
        log_font = QFont("Consolas", 10)
        self.log_view.setFont(log_font)
        self.log_view.setStyleSheet(
            "background-color: #0D0D0D; color: #888; "
            "border: 1px solid #2A2A2A; padding: 4px;"
        )
        layout.addWidget(self.log_view, 1)

        clear_btn = QPushButton("Clear")
        clear_btn.clicked.connect(self.clear_log)
        layout.addWidget(clear_btn, 0, Qt.AlignmentFlag.AlignRight)

    def set_status(self, text: str) -> None:
        self.status_label.setText(text)

    def set_progress(self, percent: int) -> None:
        self.progress_bar.setValue(max(0, min(100, percent)))

    def append_log(self, line: str) -> None:
        self.log_view.appendPlainText(line.rstrip())

    def clear_log(self) -> None:
        self.log_view.clear()

    def reset(self) -> None:
        """Reset progress + clear log."""
        self.progress_bar.setValue(0)
        self.status_label.setText("Idle")
        self.log_view.clear()
```

- [ ] **Step 2: Verify import works**

```bash
cd /c/Users/MSI/Projects/ClipForge
python -c "from hypersnip.ui.widgets.progress_log import ProgressLog; print('ok')"
```

Expected: `ok`

- [ ] **Step 3: Commit**

```bash
cd /c/Users/MSI/Projects/ClipForge
git add src/hypersnip/ui/widgets/progress_log.py
git commit -m "feat(ui): add ProgressLog widget with progress bar and log view"
```

---

## Phase 5: MainWindow

### Task 16: MainWindow — 3-pane Integration

**Files:**
- Modify: `C:\Users\MSI\Projects\ClipForge\src\hypersnip\ui\main_window.py`

- [ ] **Step 1: Replace `main_window.py` with full implementation**

File: `C:\Users\MSI\Projects\ClipForge\src\hypersnip\ui\main_window.py`

```python
"""Main application window: 3-pane layout, state machine, signal wiring."""

from __future__ import annotations

import logging
import re
from datetime import datetime
from pathlib import Path
from typing import Any

from PySide6.QtCore import QThread, Qt
from PySide6.QtGui import QCloseEvent
from PySide6.QtWidgets import (
    QHBoxLayout,
    QLabel,
    QMainWindow,
    QPushButton,
    QVBoxLayout,
    QWidget,
)

from hypersnip import config
from hypersnip.models import VideoInfo
from hypersnip.services.ffmpeg_paths import resolve_ffmpeg, resolve_ytdlp
from hypersnip.services.hardware_detector import detect
from hypersnip.ui.widgets.progress_log import ProgressLog
from hypersnip.ui.widgets.render_panel import RenderPanel
from hypersnip.ui.widgets.trim_panel import TrimPanel
from hypersnip.ui.widgets.url_input import UrlInput
from hypersnip.ui.widgets.video_info import VideoInfoWidget
from hypersnip.ui.widgets.video_player import VideoPlayer
from hypersnip.ui.workers import (
    DownloadWorker,
    ParseWorker,
    RenderWorker,
    out_path_via_config,
)

logger = logging.getLogger(__name__)

# State machine values
IDLE = "IDLE"
PARSING = "PARSING"
READY = "READY"
DOWNLOADING = "DOWNLOADING"
DOWNLOADED = "DOWNLOADED"
RENDERING = "RENDERING"
RENDERED = "RENDERED"


class MainWindow(QMainWindow):
    """3-pane: Sidebar | Content | Detail."""

    def __init__(self) -> None:
        super().__init__()
        self.setWindowTitle(f"{config.APP_NAME} v{config.APP_VERSION}")
        self.resize(1400, 900)

        self._state = IDLE
        self._video_info: VideoInfo | None = None
        self._trim_start = 0.0
        self._trim_end = 0.0
        self._downloaded_path: Path | None = None
        self._parse_thread: QThread | None = None
        self._download_thread: QThread | None = None
        self._render_thread: QThread | None = None

        self._build_sidebar()
        self._build_content()
        self._build_detail()
        self._apply_theme()
        self._set_state(IDLE)

    def _build_sidebar(self) -> None:
        sidebar = QWidget()
        sidebar.setFixedWidth(config.SIDEBAR_WIDTH)
        layout = QVBoxLayout(sidebar)
        layout.setContentsMargins(12, 12, 12, 12)

        title = QLabel(f"● {config.APP_NAME}")
        title.setStyleSheet(f"font-size: 16px; font-weight: 700; color: {config.ACCENT_COLOR};")
        layout.addWidget(title)

        self.status_label = QLabel("Status: IDLE")
        self.status_label.setStyleSheet("color: #888; font-size: 12px;")
        layout.addWidget(self.status_label)

        # Hardware info
        try:
            hw = detect()
            hw_lines = [
                f"GPU: {hw.gpu_name or 'none'}",
                f"NVENC: {'✓' if hw.nvenc_supported else '✗'}",
                f"CPU: {hw.cpu_count} cores",
                f"RAM: {hw.ram_total_gb:.0f}GB",
            ]
        except Exception:  # noqa: BLE001
            hw_lines = ["Hardware: unknown"]

        for line in hw_lines:
            lbl = QLabel(line)
            lbl.setStyleSheet("color: #888; font-size: 11px;")
            layout.addWidget(lbl)

        # Binary check
        for name, resolver in [("ffmpeg", resolve_ffmpeg), ("yt-dlp", resolve_ytdlp)]:
            try:
                resolver()
                ok = True
            except Exception:  # noqa: BLE001
                ok = False
            mark = "✓" if ok else "✗"
            lbl = QLabel(f"{name}: {mark}")
            lbl.setStyleSheet(
                f"color: {'#00FF88' if ok else '#FF4444'}; font-size: 11px;"
            )
            layout.addWidget(lbl)

        layout.addStretch(1)

        quit_btn = QPushButton("Quit")
        quit_btn.clicked.connect(self.close)
        layout.addWidget(quit_btn)

        self.sidebar = sidebar

    def _build_content(self) -> None:
        content = QWidget()
        layout = QVBoxLayout(content)
        layout.setContentsMargins(12, 12, 12, 12)
        layout.setSpacing(8)

        self.url_input = UrlInput()
        self.url_input.parse_requested.connect(self._on_parse_requested)
        layout.addWidget(self.url_input)

        self.video_info = VideoInfoWidget()
        layout.addWidget(self.video_info)

        self.progress_log = ProgressLog()
        layout.addWidget(self.progress_log, 1)

        self.content = content

    def _build_detail(self) -> None:
        detail = QWidget()
        layout = QVBoxLayout(detail)
        layout.setContentsMargins(12, 12, 12, 12)
        layout.setSpacing(8)

        self.video_player = VideoPlayer()
        layout.addWidget(self.video_player, 1)

        self.trim_panel = TrimPanel()
        self.trim_panel.trim_changed.connect(self._on_trim_changed)
        layout.addWidget(self.trim_panel)

        self.render_panel = RenderPanel()
        self.render_panel.config_changed.connect(self._on_render_config_changed)
        layout.addWidget(self.render_panel)

        self.action_btn = QPushButton("Download")
        self.action_btn.clicked.connect(self._on_action_clicked)
        layout.addWidget(self.action_btn)

        self.detail = detail

    def _apply_theme(self) -> None:
        central = QWidget()
        layout = QHBoxLayout(central)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)
        layout.addWidget(self.sidebar, 0)
        layout.addWidget(self.content, 1)
        layout.addWidget(self.detail, 1)
        self.setCentralWidget(central)

        self.setStyleSheet(
            f"""
            QMainWindow {{ background-color: {config.BG_COLOR}; }}
            QWidget {{ color: {config.TEXT_COLOR}; }}
            QLineEdit, QSpinBox, QComboBox {{
                background-color: {config.SURFACE_COLOR};
                color: {config.TEXT_COLOR};
                border: 1px solid {config.BORDER_COLOR};
                padding: 6px;
            }}
            QPushButton {{
                background-color: {config.ACCENT_COLOR};
                color: {config.BG_COLOR};
                font-weight: 600;
                padding: 8px 16px;
                border: none;
            }}
            QPushButton:disabled {{ background-color: #333; color: #666; }}
            QProgressBar {{
                border: 1px solid {config.BORDER_COLOR};
                background-color: {config.SURFACE_COLOR};
                text-align: center;
                color: {config.TEXT_COLOR};
            }}
            QProgressBar::chunk {{ background-color: {config.ACCENT_COLOR}; }}
            QSlider::groove:horizontal {{
                height: 6px;
                background: {config.SURFACE_COLOR};
                border: 1px solid {config.BORDER_COLOR};
            }}
            QSlider::handle:horizontal {{
                width: 16px;
                background: {config.ACCENT_COLOR};
                margin: -6px 0;
            }}
            """
        )

    # --- State machine ---

    def _set_state(self, new_state: str) -> None:
        self._state = new_state
        self.status_label.setText(f"Status: {new_state}")
        self._update_action_button()
        self._update_widgets_for_state()

    def _update_action_button(self) -> None:
        labels = {
            IDLE: "Download",
            PARSING: "Parsing...",
            READY: "Download",
            DOWNLOADING: "Downloading...",
            DOWNLOADED: "Render",
            RENDERING: "Rendering...",
            RENDERED: "Render again",
        }
        self.action_btn.setText(labels.get(self._state, "Action"))
        self.action_btn.setEnabled(self._state in (READY, DOWNLOADED, RENDERED))

    def _update_widgets_for_state(self) -> None:
        self.url_input.set_enabled(self._state in (IDLE, READY, DOWNLOADED, RENDERED))
        self.trim_panel.setEnabled(self._state in (READY, DOWNLOADED, RENDERED))
        self.render_panel.setEnabled(self._state in (DOWNLOADED, RENDERED))

    # --- Signal handlers ---

    def _on_parse_requested(self, url: str) -> None:
        self.progress_log.reset()
        self.progress_log.set_status("Parsing URL...")
        self._set_state(PARSING)
        worker = ParseWorker()
        worker.info_ready.connect(self._on_info_ready)
        worker.failed.connect(self._on_parse_failed)
        self._parse_thread = self._start_thread(worker)

    def _on_info_ready(self, info: VideoInfo) -> None:
        self._video_info = info
        self.video_info.display(info)
        self.trim_panel.set_duration(info.duration)
        self._trim_end = info.duration
        self.progress_log.set_status(f"Parsed: {info.title}")
        self.progress_log.append_log(f"Title: {info.title}")
        self.progress_log.append_log(f"Duration: {info.duration:.1f}s")
        self.progress_log.append_log(f"Resolution: {info.width}x{info.height}")
        self._set_state(READY)

    def _on_parse_failed(self, msg: str) -> None:
        self.progress_log.set_status(f"Parse failed: {msg}")
        self.progress_log.append_log(f"ERROR: {msg}")
        self._set_state(IDLE)

    def _on_trim_changed(self, start: float, end: float) -> None:
        self._trim_start = start
        self._trim_end = end

    def _on_render_config_changed(self, config_obj: Any) -> None:
        self._render_config = config_obj

    def _on_action_clicked(self) -> None:
        if self._state == READY:
            self._start_download()
        elif self._state == DOWNLOADED:
            self._start_render()
        elif self._state == RENDERED:
            self._start_render()

    # --- Download ---

    def _start_download(self) -> None:
        if not self._video_info:
            return
        url = self.url_input.url_edit.text().strip()
        sections = (
            f"*{int(self._trim_start)}-{int(self._trim_end)}"
            if self._trim_start > 0 or self._trim_end < self._video_info.duration
            else None
        )
        out_path = config.DEFAULT_OUTPUT_DIR / f"download_{datetime.now():%Y%m%d_%H%M%S}.mp4"
        out_path.parent.mkdir(parents=True, exist_ok=True)

        self.progress_log.set_status("Downloading...")
        self.progress_log.reset()
        self._set_state(DOWNLOADING)

        worker = DownloadWorker()
        worker.progress.connect(self._on_download_progress)
        worker.finished.connect(self._on_download_finished)
        worker.failed.connect(self._on_download_failed)
        self._download_thread = self._start_thread(worker, url=url, sections=sections, out_path=out_path)

    def _on_download_progress(self, percent: int) -> None:
        self.progress_log.set_progress(percent)
        self.progress_log.set_status(f"Downloading... {percent}%")

    def _on_download_finished(self, path: Path) -> None:
        self._downloaded_path = path
        self.progress_log.set_status(f"Downloaded: {path.name}")
        self.progress_log.set_progress(100)
        self.progress_log.append_log(f"Saved to: {path}")
        # Preview downloaded file
        self.video_player.load(path)
        self._set_state(DOWNLOADED)

    def _on_download_failed(self, msg: str) -> None:
        self.progress_log.set_status(f"Download failed: {msg}")
        self.progress_log.append_log(f"ERROR: {msg}")
        self._set_state(READY)

    # --- Render ---

    def _start_render(self) -> None:
        if not self._downloaded_path:
            return
        render_config = self.render_panel.get_config()
        output_path = out_path_via_config(render_config)
        # If file already exists, use a unique name
        if output_path.exists():
            stem = output_path.stem
            suffix = output_path.suffix
            ts = datetime.now().strftime("%H%M%S")
            output_path = output_path.parent / f"{stem}_{ts}{suffix}"

        self.progress_log.set_status("Rendering...")
        self.progress_log.set_progress(0)
        self._set_state(RENDERING)

        worker = RenderWorker()
        worker.progress.connect(self._on_render_progress)
        worker.finished.connect(self._on_render_finished)
        worker.failed.connect(self._on_render_failed)
        self._render_thread = self._start_thread(
            worker,
            input_path=self._downloaded_path,
            trim_start=self._trim_start,
            trim_end=self._trim_end,
            config=render_config,
        )
        self._pending_output = output_path

    def _on_render_progress(self, percent: int) -> None:
        self.progress_log.set_progress(percent)
        self.progress_log.set_status(f"Rendering... {percent}%")

    def _on_render_finished(self, path: Path) -> None:
        self.progress_log.set_status(f"Rendered: {path.name}")
        self.progress_log.set_progress(100)
        self.progress_log.append_log(f"Output: {path}")
        self.video_player.load(path)
        self._set_state(RENDERED)

    def _on_render_failed(self, msg: str) -> None:
        self.progress_log.set_status(f"Render failed: {msg}")
        self.progress_log.append_log(f"ERROR: {msg}")
        self._set_state(DOWNLOADED)

    # --- Thread helper ---

    def _start_thread(self, worker: Any, **kwargs: Any) -> QThread:
        """Move worker to a QThread, wire up cleanup, start with kwargs."""
        thread = QThread()
        worker.moveToThread(thread)
        # Bind kwargs to the run method
        from functools import partial

        thread.started.connect(partial(worker.run, **kwargs))
        thread.finished.connect(worker.deleteLater)
        thread.finished.connect(thread.deleteLater)
        thread.start()
        return thread

    def closeEvent(self, event: QCloseEvent) -> None:  # noqa: N802
        for thread in (self._parse_thread, self._download_thread, self._render_thread):
            if thread and thread.isRunning():
                thread.quit()
                thread.wait(3000)
        super().closeEvent(event)
```

- [ ] **Step 2: Verify import works**

```bash
cd /c/Users/MSI/Projects/ClipForge
python -c "from hypersnip.ui.main_window import MainWindow; print('ok')"
```

Expected: `ok`

- [ ] **Step 3: Verify app launches**

```bash
cd /c/Users/MSI/Projects/ClipForge
timeout 5 python main.py
```

Expected: window opens, 3 panes visible (Sidebar 220px | Content | Detail), 3 Quit button works.

- [ ] **Step 4: Run all tests**

```bash
cd /c/Users/MSI/Projects/ClipForge
pytest -v
```

Expected: all tests pass (services + UI widget tests).

- [ ] **Step 5: Commit**

```bash
cd /c/Users/MSI/Projects/ClipForge
git add src/hypersnip/ui/main_window.py
git commit -m "feat(ui): integrate 3-pane MainWindow with state machine"
```

---

## Phase 6: Finalization

### Task 17: README + Lint Pass

**Files:**
- Modify: `C:\Users\MSI\Projects\ClipForge\README.md`

- [ ] **Step 1: Replace `README.md` with full version**

File: `C:\Users\MSI\Projects\ClipForge\README.md`

```markdown
# HyperSnip

Desktop app tải + trim + render video YouTube. Native Qt (PySide6), không dùng web UI.

## Tính năng

- Paste YouTube URL → tự động parse metadata
- Download 1080p H.264 (yt-dlp, 16 fragments parallel)
- Trim range với slider + spinbox
- Render với FFmpeg NVENC (RTX card) hoặc libx264 fallback
- Preview kết quả với QMediaPlayer (Space=play/pause, ←→=±5s)
- Auto-fallback cho máy không có NVIDIA GPU

## Yêu cầu

- **OS:** Windows 10/11
- **Python:** 3.11+
- **External binaries:**
  - `ffmpeg.exe` — cài qua Scoop (`scoop install ffmpeg`) hoặc đặt trong PATH
  - `yt-dlp.exe` — tải từ [github.com/yt-dlp/yt-dlp/releases](https://github.com/yt-dlp/yt-dlp/releases)

## Cài đặt

```bash
git clone <repo>
cd ClipForge
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
pip install -e .
```

## Chạy

```bash
python main.py
```

## Workflow

1. Paste YouTube URL vào ô input → click **Parse**
2. Xem metadata (title, duration, resolution, thumbnail)
3. Kéo slider để chọn trim range
4. Chọn preset (p1-p7 = NVENC, ull = ultrafast, medium = libx264 fallback)
5. Click **Download** → chờ progress 100%
6. Click **Render** → chờ progress 100%
7. Xem preview kết quả trong player

## Phát triển

```bash
# Run all tests
pytest

# Run service tests only (no UI)
pytest tests/test_*.py

# Run UI tests only
pytest tests/ui/

# Lint
ruff check src/ tests/
mypy src/

# Coverage
pytest --cov=hypersnip
```

## Project structure

Xem `docs/superpowers/specs/2026-06-03-hypersnip-design.md` cho architecture chi tiết.

## Performance

| Metric | Target |
|--------|--------|
| Cold start | < 1s |
| UI responsiveness | 60 FPS |
| Render 1080p NVENC | < 2x realtime |
| Render 1080p libx264 | < 5x realtime |

## License

Internal project.
```

- [ ] **Step 2: Run lint**

```bash
cd /c/Users/MSI/Projects/ClipForge
ruff check src/ tests/
```

Expected: 0 errors (warnings OK).

- [ ] **Step 3: Run type check**

```bash
cd /c/Users/MSI/Projects/ClipForge
mypy src/hypersnip/
```

Expected: 0 errors (some warnings on `Any` from `worker.finished` signal are acceptable).

- [ ] **Step 4: Commit**

```bash
cd /c/Users/MSI/Projects/ClipForge
git add README.md
git commit -m "docs: full README with workflow and performance targets"
```

---

### Task 18: End-to-End Smoke Test

**Files:** None (verification only)

- [ ] **Step 1: Launch app**

```bash
cd /c/Users/MSI/Projects/ClipForge
timeout 10 python main.py
```

Expected: window opens, 3 panes render correctly, Sidebar shows GPU/NVENC/RAM info.

- [ ] **Step 2: Manual workflow test**

Trong app:
1. Paste một public YouTube URL (e.g., Creative Commons short)
2. Click **Parse** → metadata appears
3. Adjust trim slider
4. Click **Download** → progress 0% → 100%
5. Click **Render** → progress 0% → 100%
6. Video preview plays trong VideoPlayer

Expected: tất cả 6 bước work, không có crash, log hiển thị progress.

- [ ] **Step 3: Verify output file exists**

```bash
ls -la /c/Users/MSI/Videos/HyperSnip/
```

Expected: có ít nhất 1 file `.mp4` (downloaded + rendered).

- [ ] **Step 4: Run final test suite**

```bash
cd /c/Users/MSI/Projects/ClipForge
pytest -v --tb=short
```

Expected: all tests pass.

- [ ] **Step 5: Generate coverage report**

```bash
cd /c/Users/MSI/Projects/ClipForge
pip install pytest-cov
pytest --cov=hypersnip --cov-report=term-missing
```

Expected: services coverage ≥ 80%, UI coverage varies.

- [ ] **Step 6: Commit coverage config (if not present)**

Nếu tạo `pyproject.toml` mới, commit:

```bash
cd /c/Users/MSI/Projects/ClipForge
git add pyproject.toml requirements.txt
git commit -m "chore: add pytest-cov to dev requirements"
```

- [ ] **Step 7: Tag v0.1.0 release**

```bash
cd /c/Users/MSI/Projects/ClipForge
git tag v0.1.0
git log --oneline | head -25
```

Expected: ~18 commits, từ `chore: scaffold project structure` đến `chore: add pytest-cov`.

---

## Summary

| Phase | Tasks | Files Created | LOC Estimate |
|-------|-------|---------------|--------------|
| 1. Bootstrap | 3 | ~8 | ~150 |
| 2. Services (TDD) | 5 | 10 (5 src + 5 test) | ~700 |
| 3. Workers | 1 | 1 | ~120 |
| 4. Widgets | 6 | 7 (6 src + 1 test) | ~600 |
| 5. MainWindow | 1 | 1 | ~400 |
| 6. Finalization | 2 | 1 | ~100 |
| **Total** | **18 tasks** | **~30 files** | **~2,070 LOC** |

**Spec coverage check:**
- [x] Tech stack (PySide6, yt-dlp, ffmpeg, pynvml, psutil)
- [x] 2-layer architecture (services + UI)
- [x] All 5 service modules with tests (ffmpeg_paths, hardware_detector, progress_parser, downloader, renderer)
- [x] 6 widgets (url_input, video_info, trim_panel, render_panel, video_player, progress_log)
- [x] 3 workers (parse, download, render)
- [x] MainWindow with state machine
- [x] Error handling via custom exceptions
- [x] Testing with pytest + pytest-qt
- [x] Project layout matches spec
- [x] Performance targets documented
