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

    [Fact]
    public async Task UpdateStatus_FiresWorkspaceUpdatedEvent()
    {
        var tmp = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(tmp);
        try
        {
            var store = new JsonWorkspaceStore(tmp);
            var ws = new Workspace { Id = "ws-ev", Status = WorkspaceStatus.Waiting };
            await store.SaveAsync(ws);

            Workspace? updated = null;
            store.WorkspaceUpdated += (_, w) => updated = w;

            await store.UpdateStatusAsync("ws-ev", WorkspaceStatus.Downloading);

            Assert.NotNull(updated);
            Assert.Equal(WorkspaceStatus.Downloading, updated!.Status);
        }
        finally
        {
            Directory.Delete(tmp, true);
        }
    }

    [Fact]
    public async Task Retry_Flow_WaitingToDownloadingToReady()
    {
        var tmp = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(tmp);
        try
        {
            var store = new JsonWorkspaceStore(tmp);
            var ws = new Workspace { Id = "ws-retry", Status = WorkspaceStatus.Error, VideoUrl = "https://youtube.com/watch?v=dQw4w9WgXcQ" };
            await store.SaveAsync(ws);

            await store.UpdateStatusAsync("ws-retry", WorkspaceStatus.Waiting);
            var waiting = await store.GetByIdAsync("ws-retry");
            Assert.Equal(WorkspaceStatus.Waiting, waiting!.Status);

            await store.UpdateStatusAsync("ws-retry", WorkspaceStatus.Downloading);
            var downloading = await store.GetByIdAsync("ws-retry");
            Assert.Equal(WorkspaceStatus.Downloading, downloading!.Status);

            await store.UpdateStatusAsync("ws-retry", WorkspaceStatus.Ready);
            await store.UpdateAsync("ws-retry", w => w.DownloadedPath = "test.mp4");
            var ready = await store.GetByIdAsync("ws-retry");
            Assert.Equal(WorkspaceStatus.Ready, ready!.Status);
            Assert.Equal("test.mp4", ready.DownloadedPath);
        }
        finally
        {
            Directory.Delete(tmp, true);
        }
    }

    [Fact]
    public async Task Patch_CanUpdateMultipleFields()
    {
        var tmp = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(tmp);
        try
        {
            var store = new JsonWorkspaceStore(tmp);
            var ws = new Workspace { Id = "ws-patch", Status = WorkspaceStatus.Downloading };
            await store.SaveAsync(ws);

            await store.UpdateAsync("ws-patch", w =>
            {
                w.Status = WorkspaceStatus.Ready;
                w.DownloadedPath = "patched.mp4";
                w.DownloadProgress = 100;
                w.FileSize = "50MB";
            });

            var patched = await store.GetByIdAsync("ws-patch");
            Assert.Equal(WorkspaceStatus.Ready, patched!.Status);
            Assert.Equal("patched.mp4", patched.DownloadedPath);
            Assert.Equal(100, patched.DownloadProgress);
            Assert.Equal("50MB", patched.FileSize);
        }
        finally
        {
            Directory.Delete(tmp, true);
        }
    }

    [Fact]
    public async Task DownloadProgress_UpdatesPersistToStore()
    {
        var tmp = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(tmp);
        try
        {
            var store = new JsonWorkspaceStore(tmp);
            var ws = new Workspace { Id = "ws-prog", Status = WorkspaceStatus.Downloading };
            await store.SaveAsync(ws);

            await store.UpdateAsync("ws-prog", w => w.DownloadProgress = 25.0);
            await store.UpdateAsync("ws-prog", w => w.DownloadSpeed = "5.2MiB/s");
            await store.UpdateAsync("ws-prog", w => w.DownloadProgress = 50.0);
            await store.UpdateAsync("ws-prog", w => { w.DownloadProgress = 100.0; w.Status = WorkspaceStatus.Ready; w.DownloadedPath = "done.mp4"; });

            var final = await store.GetByIdAsync("ws-prog");
            Assert.Equal(WorkspaceStatus.Ready, final!.Status);
            Assert.Equal(100.0, final.DownloadProgress);
            Assert.Equal("5.2MiB/s", final.DownloadSpeed);
            Assert.Equal("done.mp4", final.DownloadedPath);
        }
        finally
        {
            Directory.Delete(tmp, true);
        }
    }
}
