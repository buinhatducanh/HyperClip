using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using HyperClip.Core.Models;

namespace HyperClip.UI.ViewModels;

public partial class VideoDetailPanelViewModel : ObservableObject
{
    [ObservableProperty] private Workspace? _workspace;
    [ObservableProperty] private bool _isVisible;

    [ObservableProperty] private string _videoTitle = "";
    [ObservableProperty] private string _channelName = "";
    [ObservableProperty] private string _fileSize = "";
    [ObservableProperty] private string _downloadQuality = "";
    [ObservableProperty] private string _sourceResolution = "";

    // Timeline
    [ObservableProperty] private string _detectedAt = "";
    [ObservableProperty] private string _downloadStartedAt = "";
    [ObservableProperty] private string _downloadCompletedAt = "";
    [ObservableProperty] private string _renderStartedAt = "";
    [ObservableProperty] private string _renderCompletedAt = "";

    // Download metrics
    [ObservableProperty] private long _downloadMs;
    [ObservableProperty] private double _downloadSpeedMBs;
    [ObservableProperty] private bool _isMultiInstance;

    // Render metrics
    [ObservableProperty] private long _renderMs;
    [ObservableProperty] private double _renderFps;
    [ObservableProperty] private int _renderWorkers;
    [ObservableProperty] private string _renderCodec = "";
    [ObservableProperty] private string _renderPreset = "";
    [ObservableProperty] private int _renderChunks;
    [ObservableProperty] private string _renderOutputResolution = "";

    // System metrics
    [ObservableProperty] private double _systemGpuLoad;
    [ObservableProperty] private double _systemVramUsed;
    [ObservableProperty] private double _systemRamUsed;

    public void LoadWorkspace(Workspace ws)
    {
        Workspace = ws;
        VideoTitle = ws.VideoTitle ?? "Untitled";
        ChannelName = ws.ChannelName ?? "";
        FileSize = ws.FileSize;
        DownloadQuality = ws.DownloadQuality ?? "N/A";
        SourceResolution = ws.VideoResolution ?? "N/A";

        var m = ws.Metrics;
        if (m != null)
        {
            DetectedAt = FormatTimestamp(m.DetectedAt);
            DownloadStartedAt = FormatTimestamp(m.DownloadStartedAt);
            DownloadCompletedAt = FormatTimestamp(m.DownloadCompletedAt);
            RenderStartedAt = FormatTimestamp(m.RenderStartedAt);
            RenderCompletedAt = FormatTimestamp(m.RenderCompletedAt);

            DownloadMs = m.DownloadMs ?? 0;
            DownloadSpeedMBs = m.DownloadSpeedMBs ?? 0;
            IsMultiInstance = m.DownloadIsMultiInstance ?? false;

            RenderMs = m.RenderMs ?? 0;
            RenderFps = m.RenderFps ?? 0;
            RenderWorkers = m.RenderWorkers ?? 0;
            RenderCodec = m.RenderCodec ?? "N/A";
            RenderPreset = m.RenderPreset ?? "N/A";
            RenderChunks = m.RenderChunks ?? 0;
            RenderOutputResolution = m.RenderOutputResolution ?? "N/A";

            SystemGpuLoad = m.SystemGpuLoad ?? 0;
            SystemVramUsed = m.SystemVramUsed ?? 0;
            SystemRamUsed = m.SystemRamUsed ?? 0;
        }

        IsVisible = true;
    }

    [RelayCommand]
    private void Close()
    {
        IsVisible = false;
        Workspace = null;
    }

    private static string FormatTimestamp(string? ts)
    {
        if (string.IsNullOrEmpty(ts)) return "--:--:--";
        if (DateTime.TryParse(ts, out var dt))
            return dt.ToString("HH:mm:ss");
        return ts;
    }
}
