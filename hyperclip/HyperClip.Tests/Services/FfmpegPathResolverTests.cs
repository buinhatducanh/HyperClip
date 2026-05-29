using HyperClip.Services.Render;

namespace HyperClip.Tests.Services;

public class FfmpegPathResolverTests
{
    [Fact]
    public void GetFfmpegPath_ReturnsNonEmpty()
    {
        var resolver = new FfmpegPathResolver();
        var path = resolver.GetFfmpegPath();
        Assert.False(string.IsNullOrEmpty(path));
    }

    [Fact]
    public void GetFfprobePath_ReturnsNonEmpty()
    {
        var resolver = new FfmpegPathResolver();
        var path = resolver.GetFfprobePath();
        Assert.False(string.IsNullOrEmpty(path));
    }

    [Fact]
    public void GetFfmpegPath_ReturnsSameOnMultipleCalls()
    {
        var resolver = new FfmpegPathResolver();
        var path1 = resolver.GetFfmpegPath();
        var path2 = resolver.GetFfmpegPath();
        Assert.Equal(path1, path2);
    }
}
