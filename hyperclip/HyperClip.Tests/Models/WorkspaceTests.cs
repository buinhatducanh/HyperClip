namespace HyperClip.Tests.Models;

public class WorkspaceTests
{
    [Fact]
    public void Workspace_SerializesAndDeserializes_WithAllFields()
    {
        var ws = new HyperClip.Core.Models.Workspace
        {
            Id = "test-123",
            ChannelId = "ch-456",
            ChannelName = "Test Channel",
            ChannelColor = "#FF0000",
            VideoId = "dQw4w9WgXcQ",
            VideoUrl = "https://youtube.com/watch?v=dQw4w9WgXcQ",
            VideoTitle = "Test Video",
            Thumbnail = "https://example.com/thumb.jpg",
            Duration = "10:30",
            DownloadedAt = "2026-05-29T10:00:00Z",
            Status = HyperClip.Core.Enums.WorkspaceStatus.Ready,
            TrimLimit = 5,
            Quality = HyperClip.Core.Enums.RenderQuality.Quality1080,
            FileSize = "150.5 MB",
            PublishedAt = "2026-05-29T09:55:00Z",
            DownloadedPath = "videos/test-123.mp4",
            DownloadProgress = 100,
            Metrics = new HyperClip.Core.Models.WorkspaceMetrics
            {
                DownloadMs = 45000,
                DownloadSpeedMBs = 3.2,
                DownloadFileSize = 157286400,
                RenderMs = 120000
            }
        };

        var json = System.Text.Json.JsonSerializer.Serialize(ws);
        var deserialized = System.Text.Json.JsonSerializer.Deserialize<HyperClip.Core.Models.Workspace>(json);

        Assert.NotNull(deserialized);
        Assert.Equal("test-123", deserialized.Id);
        Assert.Equal("dQw4w9WgXcQ", deserialized.VideoId);
        Assert.Equal(HyperClip.Core.Enums.WorkspaceStatus.Ready, deserialized.Status);
        Assert.Equal(5, deserialized.TrimLimit);
        Assert.NotNull(deserialized.Metrics);
        Assert.Equal(45000, deserialized.Metrics.DownloadMs);
    }

    [Fact]
    public void Workspace_TrimLimit_SupportsNumberOrFull()
    {
        var ws1 = new HyperClip.Core.Models.Workspace { TrimLimit = 5 };
        var ws2 = new HyperClip.Core.Models.Workspace { TrimLimit = null };

        var json1 = System.Text.Json.JsonSerializer.Serialize(ws1);
        var json2 = System.Text.Json.JsonSerializer.Serialize(ws2);

        var d1 = System.Text.Json.JsonSerializer.Deserialize<HyperClip.Core.Models.Workspace>(json1);
        var d2 = System.Text.Json.JsonSerializer.Deserialize<HyperClip.Core.Models.Workspace>(json2);

        Assert.Equal(5, d1!.TrimLimit);
        Assert.Null(d2!.TrimLimit);
    }
}
