namespace HyperClip.Core.Models;

public class PollerStatus
{
    public bool Active { get; set; }
    public int PollIntervalMs { get; set; }
    public long? LastPollAt { get; set; }
    public long? LastNewVideosAt { get; set; }
    public int ChannelCount { get; set; }
    public int VideoCount { get; set; }
    public int NewVideoCount { get; set; }
    public string? LastError { get; set; }
}
