using HyperClip.Core.Enums;
using HyperClip.Core.Interfaces;
using HyperClip.Core.Models;
using HyperClip.Services.Detection;
using Microsoft.Extensions.Logging;

namespace HyperClip.Services.Download;

public class AutoDownloadService : IDisposable
{
    private readonly YoutubePoller _poller;
    private readonly IWorkspaceStore _workspaceStore;
    private readonly DownloadPipeline _downloadPipeline;
    private readonly ILogger<AutoDownloadService> _logger;

    public AutoDownloadService(
        YoutubePoller poller,
        IWorkspaceStore workspaceStore,
        DownloadPipeline downloadPipeline,
        ILogger<AutoDownloadService> logger)
    {
        _poller = poller;
        _workspaceStore = workspaceStore;
        _downloadPipeline = downloadPipeline;
        _logger = logger;
    }

    public void Start()
    {
        _poller.OnVideoDetected += OnVideoDetected;
        _poller.Start();
        _logger.LogInformation("[AutoDownload] Started polling");
    }

    public void Stop()
    {
        _poller.OnVideoDetected -= OnVideoDetected;
        _poller.Stop();
        _logger.LogInformation("[AutoDownload] Stopped polling");
    }

    private async void OnVideoDetected(object? sender, DetectedVideo video)
    {
        _logger.LogInformation("[AutoDownload] Detected: {Title} on {Channel}", video.Title, video.ChannelName);

        var workspace = new Workspace
        {
            Id = Guid.NewGuid().ToString("N")[..12],
            VideoId = video.VideoId,
            VideoUrl = $"https://www.youtube.com/watch?v={video.VideoId}",
            VideoTitle = video.Title,
            ChannelId = video.ChannelId,
            ChannelName = video.ChannelName,
            Thumbnail = video.Thumbnail,
            Duration = video.Duration,
            Status = WorkspaceStatus.Waiting,
            DetectedAt = DateTimeOffset.FromUnixTimeMilliseconds(video.DetectedAt).ToString("o"),
        };

        await _workspaceStore.SaveAsync(workspace);
        await _downloadPipeline.StartDownloadAsync(workspace);
    }

    public void Dispose()
    {
        Stop();
        _poller.Dispose();
    }
}
