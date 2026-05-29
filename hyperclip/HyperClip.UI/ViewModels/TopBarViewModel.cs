using System.Windows.Threading;
using CommunityToolkit.Mvvm.ComponentModel;
using HyperClip.Core.Interfaces;
using HyperClip.Core.Models;

namespace HyperClip.UI.ViewModels;

public partial class TopBarViewModel : ObservableObject, IDisposable
{
    private readonly ISystemMonitor? _systemMonitor;
    private DispatcherTimer? _statsTimer;

    [ObservableProperty] private AppSettings _settings = new();
    [ObservableProperty] private SystemStats _systemStats = new();
    [ObservableProperty] private bool _autoRender;

    public TopBarViewModel() { }

    public TopBarViewModel(ISystemMonitor systemMonitor)
    {
        _systemMonitor = systemMonitor;
        _statsTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(5) };
        _statsTimer.Tick += async (_, _) => await UpdateStatsAsync();
        _ = UpdateStatsAsync();
        _statsTimer.Start();
    }

    private async System.Threading.Tasks.Task UpdateStatsAsync()
    {
        if (_systemMonitor == null) return;
        try
        {
            var stats = await _systemMonitor.GetStatsAsync();
            SystemStats = stats;
        }
        catch { }
    }

    partial void OnAutoRenderChanged(bool value)
    {
        Settings.AutoRender = value;
    }

    public void Dispose()
    {
        _statsTimer?.Stop();
        _statsTimer = null;
    }
}
