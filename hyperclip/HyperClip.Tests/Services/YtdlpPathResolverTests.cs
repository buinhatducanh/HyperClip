using HyperClip.Services.Download;

namespace HyperClip.Tests.Services;

public class YtdlpPathResolverTests
{
    [Fact]
    public void GetYtdlpPath_ReturnsNonEmpty()
    {
        var resolver = new YtdlpPathResolver();
        var path = resolver.GetYtdlpPath();
        Assert.False(string.IsNullOrEmpty(path));
    }

    [Fact]
    public void GetYtdlpPath_ReturnsSameOnMultipleCalls()
    {
        var resolver = new YtdlpPathResolver();
        var path1 = resolver.GetYtdlpPath();
        var path2 = resolver.GetYtdlpPath();
        Assert.Equal(path1, path2);
    }
}
