# HyperClip C# Migration — Design Spec

> Date: 2026-05-29 | Status: Draft | Approach: Monolith MVVM

---

## 1. Goal

Migrate HyperClip from Electron+Next.js to C# WPF (.NET 8) for native Windows performance. All backend logic (25+ services) + UI (redesign from scratch) in a single solution.

**Why:** Electron's Chromium overhead (300-500MB RAM, 3-5s startup, `execSync` blocking) causes UI lag. C# WPF runs in 1 process with native Windows APIs.

---

## 2. Solution Structure

```
HyperClip.sln
│
├── HyperClip.Core/                    — Models, Interfaces, Enums (no dependencies)
│   ├── Models/
│   │   ├── Workspace.cs
│   │   ├── Channel.cs
│   │   ├── RenderedVideo.cs
│   │   ├── SystemStats.cs
│   │   ├── AppSettings.cs
│   │   └── VideoDetectedEventArgs.cs
│   ├── Interfaces/
│   │   ├── IWorkspaceStore.cs
│   │   ├── IChannelStore.cs
│   │   ├── IYoutubeDownloader.cs
│   │   ├── IRenderEngine.cs
│   │   ├── IDetectionService.cs
│   │   ├── IAuthProvider.cs
│   │   ├── IGpuMonitor.cs
│   │   └── IEncryptionService.cs
│   └── Enums/
│       ├── WorkspaceStatus.cs
│       └── RenderQuality.cs
│
├── HyperClip.Services/               — Backend logic
│   ├── Store/
│   │   ├── JsonWorkspaceStore.cs      — JSON file persistence (System.Text.Json)
│   │   └── JsonChannelStore.cs
│   ├── Download/
│   │   └── YtdlpDownloader.cs         — yt-dlp async wrapper
│   ├── Render/
│   │   ├── FfmpegRenderer.cs          — FFmpeg single + chunked render
│   │   ├── NvencDetector.cs           — GPU capability detection
│   │   └── WorkerPool.cs             — Concurrent FFmpeg workers
│   ├── Detection/
│   │   ├── YouTubePoller.cs           — Innertube + OAuth fallback
│   │   ├── InnertubePool.cs           — 30 Chrome session clients
│   │   └── SubscriptionFeed.cs
│   ├── Auth/
│   │   ├── OAuthService.cs            — Google OAuth 2.0 flow
│   │   ├── ChromeSessionManager.cs    — Cookie extraction, DPAPI
│   │   └── TokenManager.cs            — 200 GCP projects quota
│   ├── System/
│   │   ├── GpuMonitor.cs              — NVAPI or async nvidia-smi
│   │   └── SystemInfo.cs              — RAM, CPU via .NET APIs
│   └── Infrastructure/
│       ├── Encryption.cs              — AES-256-GCM, HWID
│       └── SecureCredentialStore.cs
│
├── HyperClip.UI/                      — WPF Application
│   ├── App.xaml + App.xaml.cs         — DI container setup
│   ├── MainWindow.xaml                — 3-pane layout shell
│   ├── ViewModels/
│   │   ├── MainViewModel.cs           — Orchestrator
│   │   ├── SidebarViewModel.cs
│   │   ├── TopBarViewModel.cs
│   │   ├── WorkspaceQueueViewModel.cs
│   │   ├── WorkspaceCardViewModel.cs
│   │   ├── DetailEditorViewModel.cs
│   │   ├── RenderedVideoDetailViewModel.cs
│   │   ├── SettingsViewModel.cs
│   │   └── ToastViewModel.cs
│   ├── Views/
│   │   ├── SidebarView.xaml
│   │   ├── TopBarView.xaml
│   │   ├── WorkspaceQueueView.xaml
│   │   ├── WorkspaceCardView.xaml
│   │   ├── DetailEditorView.xaml
│   │   ├── RenderedVideoDetailView.xaml
│   │   ├── SettingsView.xaml
│   │   └── LoginView.xaml
│   ├── Converters/
│   │   ├── StatusToColorConverter.cs
│   │   ├── BytesToStringConverter.cs
│   │   ├── MillisecondsToTimeConverter.cs
│   │   └── BoolToVisibilityConverter.cs
│   ├── Controls/
│   │   ├── MiniBar.xaml               — GPU/RAM usage bar
│   │   ├── ProgressBar.xaml           — Render progress
│   │   ├── StatusBadge.xaml
│   │   └── ToastNotification.xaml
│   └── Resources/
│       ├── Theme.xaml                 — Dark theme, color tokens
│       └── Fonts/                     — Inter, Cascadia Code (optional)
│
└── HyperClip.Tests/
    ├── Services/
    │   ├── YtdlpDownloaderTests.cs
    │   ├── FfmpegRendererTests.cs
    │   └── JsonStoreTests.cs
    └── ViewModels/
        └── MainViewModelTests.cs
```

---

## 3. Threading Model

### Architecture

```
UI Thread (WPF Dispatcher)
    ↑ INotifyPropertyChanged / Binding
ViewModels (CommunityToolkit.Mvvm)
    ↑ async/await + Events
Services (IHostedService background)
    ↑
External Processes (yt-dlp, FFmpeg, nvidia-smi)
```

### Threading Rules

1. **Services** run on thread pool via `BackgroundService`. Never block UI thread.
2. **FFmpeg/yt-dlp** spawn `Process` async, read stdout/stderr via `Task.Run` with `StreamReader`.
3. **GPU monitor** uses NVAPI NuGet (direct call) or `Process.Start("nvidia-smi")` **async** (never `execSync`).
4. **JSON store** serialize/deserialize on thread pool, `SemaphoreSlim` for file locking.
5. **Chrome cookie extraction** runs async on background thread.

### Service → ViewModel communication

```csharp
// Service publishes events
public class YouTubePoller : BackgroundService
{
    public event Func<VideoDetectedEventArgs, Task>? OnVideoDetected;

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            var videos = await DetectNewVideos(ct);
            foreach (var v in videos)
                await OnVideoDetected?.Invoke(new(v));
            await Task.Delay(TimeSpan.FromSeconds(5), ct);
        }
    }
}

// ViewModel subscribes
public partial class MainViewModel : ObservableObject
{
    public MainViewModel(IYouTubePoller poller, IWorkspaceStore store)
    {
        poller.OnVideoDetected += OnNewVideoDetected;
    }

    private async Task OnNewVideoDetected(VideoDetectedEventArgs e)
    {
        await Dispatcher.InvokeAsync(() =>
        {
            Workspaces.Add(new WorkspaceViewModel(e.Video));
        });
    }
}
```

---

## 4. UI Layout & Theme

### Layout

```
┌──────────┬────────────────────────┬──────────┐
│ Sidebar  │     Center Panel       │ Queue    │
│ 56-220px │     (flex: 1)          │ 300-400px│
│          │                        │          │
│ Channels │ SettingsPanel          │ Pipeline │
│          │  hoặc                  │ ● ready  │
│ Detection│ VideoDetailPanel       │ ● render │
│          │  veya                  │ ● done   │
│          │ DetailEditor           │          │
├──────────┴────────────────────────┴──────────┤
│ TopBar (40px) — brand, quality, render toggle │
│ GPU 7% ═══ VRAM 12% ═══ RAM 75% ═══        │
├───────────────────────────────────────────────┤
│ StatusBar (26px) — detection status, alerts   │
└───────────────────────────────────────────────┘
```

### Theme (Flat Design — NO shadows, NO gradients)

| Token | Value | Usage |
|-------|-------|-------|
| Bg | `#121212` | Main background |
| Surface | `#1E1E1E` | Cards, panels |
| Accent | `#3B82F6` | Buttons, active states |
| Success | `#10B981` | Done, healthy |
| Error | `#EF4444` | Failed, alert |
| Warning | `#F59E0B` | Caution |
| TextPrimary | `#F5F5F5` | Headings, values |
| TextSecondary | `#A3A3A3` | Labels, meta |
| Border | `#333333` | Dividers |

### Typography

- Primary font: `Segoe UI` (native) or `Inter` (bundled)
- Mono font: `Cascadia Code` or `Consolas`
- Sizes: 8px (micro) → 10px (normal) → 12px (heading) → 14px (title)

---

## 5. Data Storage

### Compatibility

- **JSON store format identical** to current Electron version — zero data migration.
- **File paths identical** — `%APPDATA%\HyperClip\` same structure.
- Users upgrade seamlessly.

### Files

| Data | File | Format |
|------|------|--------|
| Workspaces | `data/workspaces.json` | JSON array |
| Channels | `data/channels.json` | JSON array |
| Rendered videos | `data/rendered_videos.json` | JSON array |
| Seen videos | `data/seen_videos.json` | JSON array |
| Settings | `settings.json` | JSON object |
| OAuth tokens | Encrypted (AES-256-GCM) | Binary |
| GCP projects | Encrypted YAML | AES-256-GCM keyed to HWID |
| Logs | `logs/` | Rotating text |

---

## 6. External Tool Integration

| Tool | How called | Async? |
|------|-----------|--------|
| yt-dlp | `Process.Start` + stdout parsing | Yes |
| FFmpeg | `Process.Start` + stderr parsing | Yes |
| nvidia-smi | NVAPI NuGet or `Process.Start` async | Yes |
| Chrome cookies | SQLite read + DPAPI decrypt | Yes (background) |
| YouTube API v3 | `HttpClient` | Yes |
| Innertube | HTTP requests (custom client) | Yes |

---

## 7. NuGet Packages

```
CommunityToolkit.Mvvm                    — MVVM source generators, [ObservableProperty], [RelayCommand]
Microsoft.Extensions.Hosting              — IHostedService, DI, background services
Microsoft.Extensions.DependencyInjection  — DI container
Microsoft.Extensions.Logging             — Logging abstractions
Serilog.Extensions.Logging               — File sink (rotating logs)
System.Text.Json                          — JSON serialization
NvApiWrapper                              — Direct GPU monitoring (optional, fallback to nvidia-smi)
Microsoft.Data.Sqlite                     — Chrome cookie extraction
```

---

## 8. Phased Implementation

### Phase 1: Foundation (Week 1-2)
- Scaffold solution, NuGet packages, DI container
- Core models + interfaces
- JSON store implementation (System.Text.Json + SemaphoreSlim file locking)
- WPF shell: MainWindow 3-pane layout + dark theme + TopBar + Sidebar skeleton

### Phase 2: Download Pipeline (Week 3-4)
- yt-dlp wrapper (async Process, parse progress, parse duration/resolution)
- Chrome cookie extraction (DPAPI + SQLite)
- Workspace lifecycle: create → downloading → ready → editing
- Queue UI: WorkspaceCard, progress bars, retry
- InputBar: paste YouTube URL, add to queue

### Phase 3: Render Pipeline (Week 5-6)
- FFmpeg wrapper (build filter chain, NVENC detection)
- WorkerPool: concurrent FFmpeg processes, RAM-aware
- Chunked render: split → parallel encode → merge
- DetailEditor: trim, speed, background, overlay, bottom bar
- Render progress + ETA display

### Phase 4: Detection & Auto-Download (Week 7-8)
- YouTubePoller (Innertube pool + OAuth fallback)
- Chrome session manager (30 profiles)
- Token manager (200 GCP projects)
- Auto-download on detection
- Activity log + notifications

### Phase 5: Settings & Polish (Week 9-10)
- Settings panel (sessions, projects, keys, storage, diagnostics)
- OAuth flow (system browser redirect)
- Hardware profile detection
- System monitor (.NET APIs, NVAPI)
- Auto-update (GitHub releases)
- Export/import data

---

## 9. Key Design Decisions

| Decision | Choice | Reason |
|----------|--------|--------|
| UI framework | WPF + .NET 8 | Native Windows, fast startup, mature ecosystem |
| MVVM | CommunityToolkit.Mvvm | Source generators reduce boilerplate 80% |
| JSON store | System.Text.Json + file locking | Zero migration, same format as Electron version |
| GPU monitor | Async nvidia-smi (fallback NVAPI) | Avoids `execSync` blocking, keeps compatibility |
| Process mgmt | `Process.Start` + async stdout | Proper async, no event loop block |
| DI | Microsoft.Extensions.DependencyInjection | Industry standard, integrates with IHostedService |
| Logging | Serilog file sink | Rotating logs, structured, same as current |
| Encryption | AES-256-GCM + HWID | Same security model as current |
