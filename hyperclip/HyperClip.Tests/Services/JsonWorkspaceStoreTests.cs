using HyperClip.Core.Enums;
using HyperClip.Core.Models;
using HyperClip.Services.Store;

namespace HyperClip.Tests.Services;

public class JsonWorkspaceStoreTests : IDisposable
{
    private readonly string _testDir;
    private readonly JsonWorkspaceStore _store;

    public JsonWorkspaceStoreTests()
    {
        _testDir = Path.Combine(Path.GetTempPath(), $"hyperclip-test-{Guid.NewGuid()}");
        Directory.CreateDirectory(_testDir);
        _store = new JsonWorkspaceStore(_testDir);
    }

    public void Dispose()
    {
        if (Directory.Exists(_testDir))
            Directory.Delete(_testDir, true);
    }

    [Fact]
    public async Task SaveAndGetAll_RoundTrips()
    {
        var ws = new Workspace
        {
            Id = "ws-1",
            ChannelId = "ch-1",
            ChannelName = "Test",
            ChannelColor = "#FF0000",
            VideoTitle = "Test Video",
            Thumbnail = "",
            Duration = "5:00",
            DownloadedAt = DateTime.UtcNow.ToString("O"),
            Status = WorkspaceStatus.Ready,
            Quality = RenderQuality.Quality1080,
            FileSize = "100MB"
        };
        await _store.SaveAsync(ws);
        var all = await _store.GetAllAsync();
        Assert.Single(all);
        Assert.Equal("ws-1", all[0].Id);
        Assert.Equal(WorkspaceStatus.Ready, all[0].Status);
    }

    [Fact]
    public async Task UpdateStatus_Persists()
    {
        var ws = new Workspace
        {
            Id = "ws-2", ChannelId = "ch-1", ChannelName = "Test", ChannelColor = "#00FF00",
            VideoTitle = "Update Test", Thumbnail = "", Duration = "3:00",
            DownloadedAt = DateTime.UtcNow.ToString("O"), Status = WorkspaceStatus.New,
            Quality = RenderQuality.Quality720, FileSize = "50MB"
        };
        await _store.SaveAsync(ws);
        await _store.UpdateStatusAsync("ws-2", WorkspaceStatus.Downloading);
        var found = await _store.GetByIdAsync("ws-2");
        Assert.Equal(WorkspaceStatus.Downloading, found!.Status);
    }

    [Fact]
    public async Task Delete_RemovesWorkspace()
    {
        var ws = new Workspace
        {
            Id = "ws-3", ChannelId = "ch-1", ChannelName = "Test", ChannelColor = "#0000FF",
            VideoTitle = "Delete Test", Thumbnail = "", Duration = "2:00",
            DownloadedAt = DateTime.UtcNow.ToString("O"), Status = WorkspaceStatus.Done,
            Quality = RenderQuality.Quality360, FileSize = "25MB"
        };
        await _store.SaveAsync(ws);
        await _store.DeleteAsync("ws-3");
        var found = await _store.GetByIdAsync("ws-3");
        Assert.Null(found);
    }

    [Fact]
    public async Task Patch_UpdatesOnlySpecifiedFields()
    {
        var ws = new Workspace
        {
            Id = "ws-4", ChannelId = "ch-1", ChannelName = "Test", ChannelColor = "#FFFF00",
            VideoTitle = "Patch Test", Thumbnail = "thumb.jpg", Duration = "4:00",
            DownloadedAt = DateTime.UtcNow.ToString("O"), Status = WorkspaceStatus.Ready,
            Quality = RenderQuality.Quality720, FileSize = "75MB"
        };
        await _store.SaveAsync(ws);
        await _store.UpdateAsync("ws-4", w => { w.RenderProgress = 50; w.RenderEta = "0:30"; });
        var found = await _store.GetByIdAsync("ws-4");
        Assert.Equal(50, found!.RenderProgress);
        Assert.Equal("0:30", found.RenderEta);
        Assert.Equal("Patch Test", found.VideoTitle);
    }
}
