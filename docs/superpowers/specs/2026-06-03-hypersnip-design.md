# HyperSnip — Python Desktop App (yt-dlp + ffmpeg + PySide6)

**Date:** 2026-06-03
**Folder name:** `C:\Users\MSI\Projects\ClipForge\`
**Python package name:** `hypersnip`
**Target OS:** Windows 10/11 only
**Python:** 3.11+
**Status:** Design — pending review

---

## Context

HyperClip (Electron + Next.js) UI production build vẫn giật lag và đơ UI liên tục. Root cause: Chromium overhead + React re-render cascade + IPC roundtrip latency. HyperSnip là project mới: native Qt widgets (PySide6), loại bỏ hoàn toàn web layer và IPC bridge.

HyperSnip reuse được kiến trúc yt-dlp + ffmpeg subprocess pipeline đã proven trong HyperClip (download 1080p, NVENC render), nhưng thay shell bằng Qt — cùng chất lượng đầu ra, performance tốt hơn nhiều.

---

## Mục tiêu

App desktop Windows, single-instance, workflow tuyến tính:

**paste YouTube URL → parse info → trim range → download 1080p H.264 → render với FFmpeg NVENC → preview kết quả.**

Tối đa performance cho máy RTX 5080 + 64GB RAM (NVENC primary). Tự động fallback `libx264` cho máy khách không có NVIDIA GPU.

---

## Non-Goals (YAGNI)

Loại bỏ hoàn toàn — không implement, không预留 hooks:

- Auto-poller / subscription feed
- Channel management (add/remove/list)
- OAuth 2.0 / Chrome cookie extraction / Innertube API
- System tray
- Drag-drop multiple URLs (chỉ 1 URL tại 1 thời điểm)
- Cross-platform (chỉ Windows)
- Cloud sync / multi-user
- Settings page phức tạp (chỉ output dir + bitrate/preset trong RenderPanel)
- Auto-update mechanism
- Crash reporter / telemetry

---

## Tech Stack

| Layer | Technology | Lý do |
|-------|-----------|-------|
| UI shell | PySide6 6.6+ | Native Qt widgets, LGPL license, `QMediaPlayer` native |
| Video preview | `QMediaPlayer` + `QVideoWidget` | Playback native, không cần VLC wrap |
| Download | `yt-dlp.exe` subprocess, `-N 16` fragments | EJS bypass, 1080p H.264, `tv_embedded` client |
| Render | `ffmpeg.exe` subprocess, `h264_nvenc` primary | Match HyperClip proven pipeline |
| Hardware detect | `pynvml` (GPU/NVENC) + `psutil` (CPU/RAM) | Module-level cache, gọi 1 lần |
| Threading | `QThread` + `QObject` workers + signals/slots | Không block UI, type-safe communication |
| Testing | `pytest` + `pytest-qt` + `pytest-mock` | Service unit tests + UI smoke |
| Lint | `ruff` + `mypy --strict` | Code quality gate |

### External Binaries (không pip, document trong README)

- `yt-dlp.exe` — tải từ github.com/yt-dlp/yt-dlp/releases, đặt trong `PATH` hoặc cạnh `python.exe`
- `ffmpeg.exe` — user đã cài qua Scoop (`C:\Users\MSI\scoop\shims\ffmpeg.exe`)

---

## Architecture: 2-layer Separation

```
src/hypersnip/
  services/     ← pure Python, no Qt dependency, testable với pytest
  ui/           ← PySide6 only
```

**Nguyên tắc:**
- Services expose plain Python methods, raise custom exceptions
- UI gọi services thông qua `QThread` workers, giao tiếp qua signals/slots
- Không có circular dependency: services import standard library only; UI imports services

---

## Components

### Services Layer (`src/hypersnip/services/`)

#### `ffmpeg_paths.py`

Resolve binary paths theo thứ tự ưu tiên:

**`resolve_ffmpeg() -> Path`:**
1. `os.environ["FFMPEG_PATH"]` (override)
2. `C:\Users\MSI\scoop\shims\ffmpeg.exe` (Scoop shims)
3. `C:\ffmpeg\bin\ffmpeg.exe`
4. `shutil.which("ffmpeg")` (system PATH)
5. Raise `BinaryNotFoundError` nếu tất cả fail

**`resolve_ytdlp() -> Path`:**
1. `os.environ["YTDLP_PATH"]` (override)
2. `shutil.which("yt-dlp")` hoặc `yt-dlp.exe` (system PATH)
3. Cạnh `sys.executable` (next to python.exe)
4. Raise `BinaryNotFoundError`

#### `hardware_detector.py`

```python
@dataclass(frozen=True)
class HardwareInfo:
    gpu_name: str | None
    gpu_memory_mb: int
    nvenc_supported: bool
    cpu_count: int
    ram_total_gb: float
```

- `detect() -> HardwareInfo` — cached với `@functools.lru_cache(maxsize=1)`
- `nvenc_supported` check bằng pynvml `nvmlDeviceGetCodecUtilizationCapability` (nếu pynvml raise, return False)
- Trả `gpu_name=None, nvenc_supported=False` nếu pynvml không detect được NVIDIA GPU

#### `progress_parser.py`

Pure functions, no I/O:

- `parse_ytdlp_progress(line: str) -> float | None` — match regex `\[download\]\s+(\d+\.\d+)%`, return percent
- `parse_ffmpeg_progress(line: str) -> RenderProgress | None` — match `time=(\d+):(\d+):(\d+\.\d+)`, return `RenderProgress(time_seconds)`
- `parse_ytdlp_error(stderr: str) -> str | None` — match patterns `"Private video"`, `"Video unavailable"`, `"region locked"`, `"Sign in to confirm your age"`, return Vietnamese message

```python
@dataclass(frozen=True)
class RenderProgress:
    time_seconds: float
    fps: float | None = None
    speed: str | None = None
```

#### `downloader.py`

**`get_info(url: str) -> VideoInfo`:**
- Subprocess: `yt-dlp.exe --dump-json --no-warnings --no-playlist <url>`
- Parse stdout JSON, return `VideoInfo` dataclass
- Raise `DownloadError(stderr_summary)` nếu `returncode != 0`

**`download(url: str, sections: str | None, out_path: Path, on_progress: Callable[[float], None]) -> Path`:**
- Build args: `-f "bv*+ba/b" -N 16 --merge-output-format mp4 {sections_arg} -o {out_path} <url>`
- `sections_arg` = `"--download-sections {sections}"` nếu `sections` không None, else `""`
- Stream stderr từng line, gọi `on_progress(percent)` real-time
- Retry 3x với exponential backoff (2s → 4s → 8s) khi:
  - `returncode != 0` VÀ
  - Error match network category regex (`timeout|connection|reset|unreachable`)
- Raise `DownloadError(message)` sau lần retry cuối

#### `renderer.py`

**`render(input_path: Path, trim_start: float, trim_end: float, output_path: Path, config: RenderConfig, on_progress: Callable[[float], None]) -> Path`:**

Build FFmpeg command:
```
ffmpeg.exe -y -ss {trim_start} -to {trim_end} -i {input_path}
  -vf "fps={fps},setpts=PTS-STARTPTS,scale={width}:{height}:flags=lanczos"
  -c:v {encoder} -preset {preset} -b:v {bitrate}
  -c:a aac -b:a 192k
  {output_path}
```

- `encoder` = `"h264_nvenc"` nếu `hardware_info.nvenc_supported`, else `"libx264"`
- `preset` từ `config.preset` (mapping: `"ull"→"ultrafast"`, `"p1"→"p1"`, ..., `"p7"→"p7"`)
- Parse stderr, `on_progress(percent)` dựa trên `time=` vs `(trim_end - trim_start)`
- Raise `RenderError(stderr_summary)` nếu `returncode != 0`

#### `models.py`

```python
@dataclass
class VideoInfo:
    title: str
    duration: float  # seconds
    thumbnail_url: str
    width: int
    height: int
    fps: float
    formats: list[str]

@dataclass
class RenderConfig:
    preset: str  # "p1" | "p2" | ... | "p7" | "ull"
    bitrate: str  # e.g. "12M"
    width: int = 1920
    height: int = 1080
    fps: int = 30
    output_dir: Path = field(default_factory=lambda: Path.home() / "Videos" / "HyperSnip")
```

### UI Layer (`src/hypersnip/ui/`)

#### `main_window.py`

`QMainWindow` với 3-pane layout:

```
┌─ Sidebar (220px) ──┬──── Content (flex) ──────────────┬─ Detail (flex) ─────────┐
│  ● HyperSnip       │  ┌─ UrlInput ──────────────────┐ │  ┌─ VideoPlayer ──────┐ │
│                    │  │ [URL............] [Parse]   │ │  │                     │ │
│  Status: IDLE      │  └─────────────────────────────┘ │  │   [play preview]    │ │
│  GPU: RTX 5080     │  ┌─ VideoInfo ─────────────────┐ │  │                     │ │
│  NVENC: ✓          │  │ Title / 5m32s / 1920x1080   │ │  └─────────────────────┘ │
│  RAM: 64GB         │  │ [thumbnail]                  │ │  ┌─ TrimPanel ────────┐ │
│                    │  └─────────────────────────────┘ │  │ Start [0:00]       │ │
│  [Quit]            │  ┌─ ProgressLog ───────────────┐ │  │ End   [5:32]       │ │
│                    │  │ ▓▓▓▓▓▓▓░░░ 60%             │ │  └─────────────────────┘ │
│                    │  │ [stderr log lines...]       │ │  ┌─ RenderPanel ──────┐ │
│                    │  └─────────────────────────────┘ │  │ Preset: [p1]       │ │
│                    │                                  │  │ Bitrate: [12M]     │ │
│                    │                                  │  │ Output: [.../dir]  │ │
│                    │                                  │  │ [   Render   ]     │ │
│                    │                                  │  └─────────────────────┘ │
└────────────────────┴──────────────────────────────────┴──────────────────────────┘
```

**State machine:** `IDLE → PARSING → READY → DOWNLOADING → DOWNLOADED → RENDERING → RENDERED`

Theme:
- Background: `#121212`
- Surface: `#1E1E1E`
- Accent: `#00B4FF`
- Success: `#00FF88`
- Error: `#FF4444`
- Font: Inter, 13px body

#### `workers.py`

`QObject` workers, mỗi cái trong 1 `QThread`:

```python
class ParseWorker(QObject):
    info_ready = Signal(VideoInfo)
    failed = Signal(str)
    def run(self, url: str) -> None: ...

class DownloadWorker(QObject):
    progress = Signal(int)  # 0-100
    log = Signal(str)
    finished = Signal(Path)
    failed = Signal(str)
    def run(self, url: str, sections: str | None, out_path: Path) -> None: ...

class RenderWorker(QObject):
    progress = Signal(int)
    log = Signal(str)
    finished = Signal(Path)
    failed = Signal(str)
    def run(self, input_path: Path, trim_start: float, trim_end: float, config: RenderConfig) -> None: ...
```

**Pattern (chuẩn cho mọi worker):**
```python
worker = WorkerClass()
thread = QThread()
worker.moveToThread(thread)
thread.started.connect(worker.run)
worker.finished.connect(thread.quit)
worker.finished.connect(worker.deleteLater)
thread.finished.connect(thread.deleteLater)
thread.start()
```

#### `widgets/`

| File | Class | Mô tả |
|------|-------|-------|
| `url_input.py` | `UrlInput(QWidget)` | QLineEdit + Parse QPushButton. Disable khi đang parse. Validate URL basic (regex `youtube\.com|youtu\.be`). |
| `video_info.py` | `VideoInfoWidget(QWidget)` | Title, duration (format `m:ss`), resolution, QLabel thumbnail (load async từ URL → QPixmap). |
| `trim_panel.py` | `TrimPanel(QWidget)` | Start/End QSlider (0 → duration*100) + QSpinBox (0 → duration). Sync bidirectional. Validate `end > start`. Emit `trim_changed(start, end)`. |
| `render_panel.py` | `RenderPanel(QWidget)` | Preset QComboBox, Bitrate QSpinBox (suffix "M"), Output dir QLineEdit + Browse QPushButton, Start QPushButton. Emit `render_requested(config)`. |
| `video_player.py` | `VideoPlayer(QWidget)` | QMediaPlayer + QVideoWidget. Keyboard shortcuts: `Space`=play/pause, `←/→`=±5s, `Shift+←/→`=±1s. Methods: `load(path)`, `play()`, `pause()`, `seek(seconds)`. |
| `progress_log.py` | `ProgressLog(QWidget)` | QProgressBar (0-100) + QPlainTextEdit (stderr, monospace 10px). Auto-scroll bottom. Clear QPushButton. |

---

## Data Flow (Happy Path)

```
[1] User paste URL vào UrlInput, click Parse
        ↓
[2] UrlInput emits parse_requested(url)
        ↓
[3] MainWindow tạo ParseWorker, moveToThread(QThread), start
        ↓
[4] ParseWorker.run() → Downloader.get_info(url)
        → subprocess: yt-dlp.exe --dump-json <url>
        → parse JSON → emit info_ready(VideoInfo)
        ↓
[5] MainWindow nhận info_ready → populate VideoInfoWidget
        → enable TrimPanel + RenderPanel
        → state = READY
        ↓
[6] User set trim range (start, end)
        ↓
[7] User click Download → DownloadWorker.run()
        → Downloader.download(url, sections, out_path)
        → subprocess: yt-dlp.exe -N 16 --download-sections ...
        → parse stderr → emit progress(percent) real-time
        → emit finished(file_path)
        ↓
[8] MainWindow nhận finished → state = DOWNLOADED
        → enable Render Start button
        ↓
[9] User set render config (preset, bitrate, output_dir) → click Render
        ↓
[10] RenderWorker.run() → Renderer.render(input, trim, output, config)
         → subprocess: ffmpeg.exe -ss start -to end -i input -c:v h264_nvenc ...
         → parse stderr → emit progress(percent)
         → emit finished(output_path)
         ↓
[11] MainWindow nhận finished → state = RENDERED
         → VideoPlayer.load(output_path) → auto play
```

---

## Error Handling

| Category | Detection | UX |
|----------|-----------|-----|
| **Binary missing** (yt-dlp/ffmpeg) | Startup `FFmpegPaths.resolve_*()` raise `BinaryNotFoundError` | QMessageBox với download link + PATH setup instructions |
| **Network error** | `subprocess` returncode + stderr regex | Retry 3x exp backoff (2s/4s/8s) trong service, sau đó emit `failed(msg)` → toast notification |
| **YouTube error** (private/region/age) | `parse_ytdlp_error()` match pattern | Vietnamese message + link gốc video, no retry |
| **NVENC unavailable** | `pynvml` return `nvenc_supported=False` | Renderer tự động fallback `libx264` (preset `medium`, CRF 18), log warning, Sidebar badge "CPU mode" |
| **FFmpeg error** (codec/invalid input) | `returncode != 0` + stderr capture | Show first 500 chars trong QMessageBox, button "Show full log" → mở file log |
| **Disk space insufficient** | `psutil.disk_usage(output_dir)` before render | Abort trước khi gọi ffmpeg, show free vs required bytes |
| **QMediaPlayer codec error** | `mediaStatusChanged` → `InvalidMedia` | Inline error trong VideoPlayer panel, log full error |

**Exception hierarchy:**
```python
class HyperSnipError(Exception): pass
class BinaryNotFoundError(HyperSnipError): pass
class DownloadError(HyperSnipError): pass
class RenderError(HyperSnipError): pass
class HardwareError(HyperSnipError): pass
```

**Logging:**
- File: `%USERPROFILE%/.hypersnip/logs/hypersnip.log`
- Format: `%(asctime)s [%(levelname)s] %(name)s: %(message)s`
- Rotation: 5MB × 3 backups (dùng `logging.handlers.RotatingFileHandler`)

---

## Testing

### Unit Tests (`tests/`, pytest + pytest-mock)

Mock `subprocess.run` / `subprocess.Popen` để test service logic không cần binary thật.

| File | Coverage |
|------|----------|
| `test_ffmpeg_paths.py` | Scoop shims, custom dir, missing → `BinaryNotFoundError` |
| `test_hardware_detector.py` | Mock pynvml/psutil, NVENC detect, fallback path, cache hit |
| `test_progress_parser.py` | yt-dlp `%` regex, ffmpeg `time=` regex, error pattern matching |
| `test_downloader.py` | Mock subprocess, progress callback invocation, retry logic, error mapping |
| `test_renderer.py` | Mock subprocess, filter graph construction, encoder selection (NVENC vs libx264), preset mapping |
| `test_models.py` | Dataclass validation, default values, `__post_init__` (nếu có) |

### UI Tests (`tests/ui/`, pytest-qt)

| File | Coverage |
|------|----------|
| `test_main_window.py` | Smoke: launch window, verify 3-pane layout exists |
| `test_url_input.py` | Paste URL → click Parse → verify `parse_requested` signal emitted với correct URL |
| `test_trim_panel.py` | Slider ↔ spinbox sync, `end > start` validation |
| `test_render_panel.py` | Preset/bitrate/output_dir changes emit `render_requested` signal với correct `RenderConfig` |

### Integration Tests (`tests/integration/`, `@pytest.mark.slow`)

Opt-in (default skip), cần binary thật và network:

| File | Coverage |
|------|----------|
| `test_e2e_download.py` | Actual yt-dlp against public test video (e.g., Creative Commons short) |
| `test_e2e_render.py` | Actual ffmpeg với synthetic 1080p input (5s) |

### Coverage Target

- **Services:** 80%+ line coverage (core logic, testable)
- **UI:** Smoke coverage only (Qt widgets khó unit test sâu, focus integration)

---

## Project Layout

```
C:\Users\MSI\Projects\ClipForge\
├── pyproject.toml                    # ruff + mypy config
├── requirements.txt                  # pip deps
├── README.md                         # setup + run + bundle yt-dlp.exe note
├── .gitignore                        # Python + venv + IDE
├── main.py                           # entry: from hypersnip.app import main; main()
├── src/
│   └── hypersnip/
│       ├── __init__.py               # __version__ = "0.1.0"
│       ├── app.py                    # QApplication bootstrap, theme, font, logging
│       ├── config.py                 # paths constants, accent colors, app name
│       ├── models.py                 # @dataclass VideoInfo, RenderConfig
│       ├── exceptions.py             # HyperSnipError hierarchy
│       ├── services/
│       │   ├── __init__.py
│       │   ├── ffmpeg_paths.py       # FFmpegPaths.resolve_*
│       │   ├── hardware_detector.py  # HardwareInfo, detect() (cached)
│       │   ├── progress_parser.py    # parse_ytdlp_*, parse_ffmpeg_*
│       │   ├── downloader.py         # Downloader.get_info, .download
│       │   └── renderer.py           # Renderer.render
│       └── ui/
│           ├── __init__.py
│           ├── main_window.py        # QMainWindow, 3-pane, state machine
│           ├── workers.py            # ParseWorker, DownloadWorker, RenderWorker
│           └── widgets/
│               ├── __init__.py
│               ├── url_input.py
│               ├── video_info.py
│               ├── trim_panel.py
│               ├── render_panel.py
│               ├── video_player.py
│               └── progress_log.py
└── tests/
    ├── __init__.py
    ├── conftest.py                   # fixtures: mock_subprocess, tmp_paths, qtbot, qtbot_addWidget
    ├── test_ffmpeg_paths.py
    ├── test_hardware_detector.py
    ├── test_progress_parser.py
    ├── test_downloader.py
    ├── test_renderer.py
    ├── test_models.py
    └── ui/
        ├── __init__.py
        ├── test_main_window.py
        ├── test_url_input.py
        ├── test_trim_panel.py
        └── test_render_panel.py
```

---

## Dependencies (`requirements.txt`)

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

---

## Run Instructions

```bash
cd C:\Users\MSI\Projects\ClipForge
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python main.py
```

**Prerequisites (documented in README):**
- `yt-dlp.exe` trong PATH hoặc `YTDLP_PATH` env var
- `ffmpeg.exe` (Scoop shims OK)

---

## Performance Targets

| Metric | Target | Notes |
|--------|--------|-------|
| Cold start | < 1s | PySide6 native, no Chromium boot |
| UI responsiveness | 60 FPS scroll/click | Native Qt widgets, no React re-render |
| Download 1080p H.264 | Match network speed | 16 fragments parallel, `-N 16` |
| Render 1080p H.264 NVENC | < 2x realtime | RTX 5080 + h264_nvenc preset p1 |
| Render 1080p H.264 libx264 | < 5x realtime | Fallback cho non-NVENC machines, preset medium CRF 18 |
| Memory footprint | < 200MB | No Chromium/Node overhead |

---

## Out of Scope (Future)

Nếu user muốn mở rộng HyperSnip thành full HyperClip-equivalent:

1. Auto-poller (subscription feed scan, 5s interval, age filter ≤ 10 min)
2. Channel management (add/remove/list, persistent JSON store)
3. Innertube API via Chrome cookies (30 sessions pool)
4. OAuth 2.0 fallback (200 GCP projects, TokenManager)
5. System tray (minimize to tray, notification on done)
6. Batch rendering queue
7. Activity log (MMO-style bottom bar)
8. PyInstaller packaging thành standalone `.exe`

Những tính năng này sẽ được brainstorm riêng nếu user yêu cầu, không nằm trong MVP này.
