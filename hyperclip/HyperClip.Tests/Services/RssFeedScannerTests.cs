using HyperClip.Services.Detection;

namespace HyperClip.Tests.Services;

public class RssFeedScannerTests
{
    [Fact]
    public async Task FetchLatestVideos_InvalidChannelId_ReturnsEmpty()
    {
        var scanner = new RssFeedScanner();
        var videos = await scanner.FetchLatestVideosAsync("not-a-channel");
        Assert.Empty(videos);
    }

    [Fact]
    public async Task FetchLatestVideos_EmptyId_ReturnsEmpty()
    {
        var scanner = new RssFeedScanner();
        var videos = await scanner.FetchLatestVideosAsync("");
        Assert.Empty(videos);
    }

    [Fact]
    public async Task GetChannelInfo_InvalidUrl_ReturnsNull()
    {
        var scanner = new RssFeedScanner();
        var info = await scanner.GetChannelInfoAsync("not-a-url");
        Assert.Null(info);
    }
}
