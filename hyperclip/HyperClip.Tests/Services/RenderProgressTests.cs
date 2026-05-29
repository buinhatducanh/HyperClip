using HyperClip.Core.Models;
using HyperClip.Services.Render;

namespace HyperClip.Tests.Services;

public class RenderProgressTests
{
    [Fact]
    public void RenderProgress_PropertiesSetCorrectly()
    {
        var p = new RenderProgress
        {
            WorkspaceId = "ws-1",
            Percent = 45.5,
            CurrentTime = "00:01:30.5",
            TotalTime = "00:03:00.0",
            Fps = 30,
            Speed = "1.5x",
            EtaSeconds = 90,
        };
        Assert.Equal("ws-1", p.WorkspaceId);
        Assert.Equal(45.5, p.Percent);
        Assert.Equal("1.5x", p.Speed);
        Assert.Equal(90, p.EtaSeconds);
    }

    [Fact]
    public void RenderResult_Success_HasOutputPath()
    {
        var r = new RenderResult
        {
            Success = true,
            WorkspaceId = "ws-1",
            OutputPath = @"C:\output\video.mp4",
            FileSize = 52_428_800,
            Duration = 180,
        };
        Assert.True(r.Success);
        Assert.Equal(@"C:\output\video.mp4", r.OutputPath);
        Assert.Equal(52_428_800L, r.FileSize);
    }

    [Fact]
    public void RenderResult_Failure_HasError()
    {
        var r = new RenderResult
        {
            Success = false,
            WorkspaceId = "ws-1",
            Error = "FFmpeg timeout",
        };
        Assert.False(r.Success);
        Assert.Null(r.OutputPath);
        Assert.Equal("FFmpeg timeout", r.Error);
    }

    [Fact]
    public void PoolJobResult_Default_HasNoError()
    {
        var r = new PoolJobResult { Success = true, OutputFile = "out.mp4", FileSize = 1000 };
        Assert.True(r.Success);
        Assert.Equal("out.mp4", r.OutputFile);
        Assert.Null(r.Error);
    }
}
