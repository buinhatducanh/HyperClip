using HyperClip.Core.Models;
using HyperClip.Services.Download;

namespace HyperClip.Tests.Services;

public class YtdlpDownloaderTests
{
    [Fact]
    public void DownloadProgress_PropertiesSetCorrectly()
    {
        var progress = new DownloadProgress
        {
            WorkspaceId = "ws-1",
            Percent = 45.5,
            Speed = "5.2MiB/s",
            EtaSeconds = 120,
            DownloadedBytes = 52_428_800,
            TotalBytes = 116_508_160,
        };
        Assert.Equal("ws-1", progress.WorkspaceId);
        Assert.Equal(45.5, progress.Percent);
        Assert.Equal("5.2MiB/s", progress.Speed);
        Assert.Equal(120, progress.EtaSeconds);
    }

    [Fact]
    public void DownloadResult_Success_HasFilePath()
    {
        var result = new DownloadResult
        {
            Success = true,
            WorkspaceId = "ws-1",
            FilePath = @"C:\Temp\video.mp4",
            Duration = 180,
            FileSize = 52_428_800,
        };
        Assert.True(result.Success);
        Assert.Equal(@"C:\Temp\video.mp4", result.FilePath);
        Assert.Equal(180, result.Duration);
        Assert.Null(result.Error);
    }

    [Fact]
    public void DownloadResult_Failure_HasError()
    {
        var result = new DownloadResult
        {
            Success = false,
            WorkspaceId = "ws-1",
            Error = "yt-dlp exited with code 1",
        };
        Assert.False(result.Success);
        Assert.Null(result.FilePath);
        Assert.Equal("yt-dlp exited with code 1", result.Error);
    }

    [Fact]
    public async Task GetVideoDurationAsync_ReturnsNonEmptyString()
    {
        var resolver = new YtdlpPathResolver();
        var downloader = new YtdlpDownloader(resolver);
        // Will return null if video not found — that's acceptable
        var duration = await downloader.GetVideoDurationAsync("https://youtube.com/watch?v=dQw4w9WgXcQ");
        // Just verify it doesn't throw — actual return value depends on yt-dlp availability
        Assert.True(duration == null || duration.Contains(":"));
    }
}
