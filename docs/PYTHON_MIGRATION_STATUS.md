# HyperClip PySide6 Migration — Status

## Completed Phases

- **Phase 1 (Scaffold)** — Rust workspace, Python protocol, QML layout
- **Phase 2 (Backend Port)** — system.rs GPU detection, ffmpeg.rs filter chain, youtube.rs yt-dlp, cookies.rs DPAPI stub, store.rs persistence, detection.rs poller/health
- **Phase 3 (UI Binding)** — WorkspaceModel/ChannelModel/SystemStatsModel QAbstractListModel, WorkspaceCard/Queue/DetailEditor/Sidebar/SystemMonitor/Settings QML, QMediaPlayer + Timeline, EventBus wiring
- **Phase 4 (Packaging)** — PyInstaller spec + Windows build script

## Files Created

```
crates/hyperclip_ipc/src/
  lib.rs       # BackendCommand enum + module re-exports
  system.rs    # NVENC_ARCH (RTX 5080/3060/4050 Laptop) + GPU detection
  ffmpeg.rs    # SHORT + landscape filter chains, NVENC params
  youtube.rs   # yt-dlp spawn (tv_embedded, 16 fragments)
  cookies.rs   # Chrome DPAPI stub + SOCS=CAI force-inject
  store.rs     # Workspace/Channel/SeenVideos JSON persistence
  detection.rs # Poller (5s ± 20% jitter) + HealthMonitor (6 conditions)

src/backend/
  protocol.py  # SystemStats, VideoInfo, WorkspaceData dataclasses
  client.py    # RustClient subprocess (NDJSON over stdin/stdout)
  events.py    # EventBus (QObject + Signal)

src/models/
  workspace_model.py    # QAbstractListModel — 9 roles
  channel_model.py      # QAbstractListModel — 7 roles
  system_stats_model.py # QObject with Property bindings

src/services/
  video_player.py       # QMediaPlayer wrapper

src/ui/qml/
  main.qml              # 3-pane RowLayout (Sidebar | Queue | Editor)
  Theme.qml             # Singleton (bg, accent, success, error, ...)
  Sidebar.qml           # Logo + nav + SystemMonitor
  WorkspaceQueue.qml    # ListView + workspaceModel
  WorkspaceCard.qml     # Status icon + progress bar
  DetailEditor.qml      # VideoOutput + Timeline + keyboard shortcuts
  SystemMonitor.qml     # GPU/RAM/workers/IP
  Settings.qml          # OAuth + Chrome sessions + Channels

build/
  hyperclip.spec        # PyInstaller spec
  build.ps1             # Windows build script
```

## Next Steps

1. Real cookie extraction (DPAPI + AES-256-GCM)
2. Innertube subprocess (npx ts-node)
3. OAuth verify for publishedAt=0 videos
4. E2E test (poll → detect → download → render → archive)
