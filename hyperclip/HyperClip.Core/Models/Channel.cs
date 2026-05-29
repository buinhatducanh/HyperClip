namespace HyperClip.Core.Models;

public class Channel
{
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string Handle { get; set; } = string.Empty;
    public string AvatarColor { get; set; } = string.Empty;
    public string? ChannelId { get; set; }
    public string? AvatarUrl { get; set; }
    public bool Paused { get; set; }
    public ChannelSettings? Settings { get; set; }
}

public class ChannelSettings
{
    public int? TrimLimit { get; set; }
    public string? DownloadQuality { get; set; }
    public bool? AutoRender { get; set; }
    public string? Resolution { get; set; }
    public bool? AutoSplit { get; set; }
    public int? SplitMinutes { get; set; }
    public int? Fps { get; set; }
}
