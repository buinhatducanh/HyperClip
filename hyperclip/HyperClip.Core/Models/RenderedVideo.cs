namespace HyperClip.Core.Models;

public class RenderedVideo
{
    public string Id { get; set; } = string.Empty;
    public string WorkspaceId { get; set; } = string.Empty;
    public string ChannelId { get; set; } = string.Empty;
    public string ChannelName { get; set; } = string.Empty;
    public string VideoTitle { get; set; } = string.Empty;
    public string ArchivedPath { get; set; } = string.Empty;
    public string OutputPath { get; set; } = string.Empty;
    public int Quality { get; set; }
    public string Codec { get; set; } = string.Empty;
    public string FileSize { get; set; } = string.Empty;
    public long FileSizeBytes { get; set; }
    public double Duration { get; set; }
    public string Thumbnail { get; set; } = string.Empty;
    public string? ThumbnailData { get; set; }
    public string? VideoResolution { get; set; }
    public string RenderedAt { get; set; } = string.Empty;
    public long? RenderDurationMs { get; set; }
    public RenderConfig? RenderConfig { get; set; }
    public SourceInfo? SourceInfo { get; set; }
}
