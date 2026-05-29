using HyperClip.Core.Models;
using HyperClip.Services.Store;

namespace HyperClip.Tests.Services;

public class JsonSettingsStoreTests
{
    [Fact]
    public async Task LoadAsync_ReturnsDefaults_WhenNoFile()
    {
        var tmp = Path.Combine(Path.GetTempPath(), "hc_settings_" + Guid.NewGuid().ToString("N"));
        try
        {
            var store = new JsonSettingsStore(Path.Combine(tmp, "data"));
            var settings = await store.LoadAsync();
            Assert.Equal(720, settings.DefaultQuality);
            Assert.False(settings.AutoRender);
        }
        finally { Directory.Delete(tmp, true); }
    }

    [Fact]
    public async Task SaveAsync_PersistsSettings()
    {
        var tmp = Path.Combine(Path.GetTempPath(), "hc_settings_" + Guid.NewGuid().ToString("N"));
        try
        {
            var store = new JsonSettingsStore(Path.Combine(tmp, "data"));
            var settings = new AppSettings { AutoRender = true, DefaultQuality = 1080, PollingEnabled = true };
            await store.SaveAsync(settings);
            var loaded = await store.LoadAsync();
            Assert.True(loaded.AutoRender);
            Assert.Equal(1080, loaded.DefaultQuality);
            Assert.True(loaded.PollingEnabled);
        }
        finally { Directory.Delete(tmp, true); }
    }

    [Fact]
    public async Task SaveAsync_FiresSettingsUpdated()
    {
        var tmp = Path.Combine(Path.GetTempPath(), "hc_settings_" + Guid.NewGuid().ToString("N"));
        try
        {
            var store = new JsonSettingsStore(Path.Combine(tmp, "data"));
            AppSettings? received = null;
            store.SettingsUpdated += (_, s) => received = s;
            var settings = new AppSettings { MinimizeToTray = true };
            await store.SaveAsync(settings);
            Assert.NotNull(received);
            Assert.True(received!.MinimizeToTray);
        }
        finally { Directory.Delete(tmp, true); }
    }

    [Fact]
    public async Task RoundTrip_AllFields()
    {
        var tmp = Path.Combine(Path.GetTempPath(), "hc_settings_" + Guid.NewGuid().ToString("N"));
        try
        {
            var store = new JsonSettingsStore(Path.Combine(tmp, "data"));
            var settings = new AppSettings
            {
                OutputFolder = @"D:\Output",
                DefaultQuality = 1080,
                AutoRender = true,
                PollingEnabled = true,
                PollIntervalMs = 3000,
                MaxConcurrentRenders = 4,
                MaxConcurrentDownloads = 2,
                ProxyEnabled = true,
                ProxyHost = "127.0.0.1",
                ProxyPort = 8080,
                QuitOnClose = false,
            };
            await store.SaveAsync(settings);
            var loaded = await store.LoadAsync();
            Assert.Equal(@"D:\Output", loaded.OutputFolder);
            Assert.Equal(1080, loaded.DefaultQuality);
            Assert.Equal(8080, loaded.ProxyPort);
            Assert.False(loaded.QuitOnClose);
        }
        finally { Directory.Delete(tmp, true); }
    }
}
