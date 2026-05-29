using HyperClip.Core.Models;

namespace HyperClip.Tests.Services;

public class DetectedVideoTests
{
    [Fact]
    public void DetectedVideo_DefaultValues()
    {
        var v = new DetectedVideo();
        Assert.Equal(string.Empty, v.VideoId);
        Assert.Equal(string.Empty, v.Title);
        Assert.Equal(0L, v.DetectedAt);
    }

    [Fact]
    public void DetectedVideo_SetProperties()
    {
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var v = new DetectedVideo
        {
            VideoId = "dQw4w9WgXcQ",
            Title = "Never Gonna Give You Up",
            ChannelId = "UCuAXFkgsw1L7xaCfnd5JJOw",
            ChannelName = "Rick Astley",
            Duration = "3:33",
            DetectedAt = now,
        };
        Assert.Equal("dQw4w9WgXcQ", v.VideoId);
        Assert.Equal("3:33", v.Duration);
    }

    [Fact]
    public void PollerStatus_DefaultValues()
    {
        var s = new PollerStatus();
        Assert.False(s.Active);
        Assert.Equal(0, s.ChannelCount);
    }
}
