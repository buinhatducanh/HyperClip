using System.Windows.Threading;
using CommunityToolkit.Mvvm.ComponentModel;
using HyperClip.Core.Interfaces;

namespace HyperClip.UI.ViewModels;

public partial class DetectionStatusBarViewModel : ObservableObject, IDisposable
{
    private readonly IPollerService _poller;
    private readonly DispatcherTimer _refreshTimer;

    [ObservableProperty] private bool _isPolling;
    [ObservableProperty] private int _activeSessions;
    [ObservableProperty] private int _totalSessions = 30;
    [ObservableProperty] private string _statusText = "Checking...";
    [ObservableProperty] private int _channelCount;

    public DetectionStatusBarViewModel(IPollerService poller)
    {
        _poller = poller;
        Refresh();
        _refreshTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(10) };
        _refreshTimer.Tick += (_, _) => Refresh();
        _refreshTimer.Start();
    }

    private void Refresh()
    {
        var status = _poller.GetStatus();
        IsPolling = status.Active;
        ChannelCount = status.ChannelCount;
        StatusText = status.Active ? "Polling active" : "Poller paused";
    }

    public void Dispose()
    {
        _refreshTimer.Stop();
    }
}
