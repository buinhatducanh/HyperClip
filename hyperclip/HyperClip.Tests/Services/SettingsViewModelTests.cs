using HyperClip.Core.Models;
using HyperClip.Services.Store;
using HyperClip.UI.ViewModels;

namespace HyperClip.Tests.Services;

public class SettingsViewModelTests
{
    [Fact]
    public async Task SettingsViewModel_LoadsSettings()
    {
        var tmp = Path.Combine(Path.GetTempPath(), "hc_sv_" + Guid.NewGuid().ToString("N"));
        try
        {
            var store = new JsonSettingsStore(Path.Combine(tmp, "data"));
            var vm = new SettingsViewModel(store);
            await Task.Delay(300); // wait for async load
            Assert.NotNull(vm.Settings);
        }
        finally { Directory.Delete(tmp, true); }
    }

    [Fact]
    public async Task SettingsViewModel_SaveCommand_CallsStore()
    {
        var tmp = Path.Combine(Path.GetTempPath(), "hc_sv_" + Guid.NewGuid().ToString("N"));
        try
        {
            var store = new JsonSettingsStore(Path.Combine(tmp, "data"));
            var vm = new SettingsViewModel(store);
            await Task.Delay(300);
            vm.Settings.AutoRender = true;
            await vm.SaveCommand.ExecuteAsync(null);
            Assert.Equal("Saved", vm.StatusMessage);
        }
        finally { Directory.Delete(tmp, true); }
    }
}
