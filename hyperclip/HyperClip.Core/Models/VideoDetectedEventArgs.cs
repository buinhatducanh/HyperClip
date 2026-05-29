namespace HyperClip.Core.Models;

public class VideoDetectedEventArgs : EventArgs
{
    public required string VideoId { get; init; }
    public required string ChannelId { get; init; }
    public required string Title { get; init; }
    public string? Thumbnail { get; init; }
    public string? Duration { get; init; }
    public string? PublishedAt { get; init; }
}
