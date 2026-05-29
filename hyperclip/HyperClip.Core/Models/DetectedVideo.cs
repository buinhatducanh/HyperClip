namespace HyperClip.Core.Models;

public class DetectedVideo
{
    public string VideoId { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string ChannelId { get; set; } = string.Empty;
    public string ChannelName { get; set; } = string.Empty;
    public string Thumbnail { get; set; } = string.Empty;
    public string Duration { get; set; } = string.Empty;
    public string PublishedAt { get; set; } = string.Empty;
    public long DetectedAt { get; set; }
}
