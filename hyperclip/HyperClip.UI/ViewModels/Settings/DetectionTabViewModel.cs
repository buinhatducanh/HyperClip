using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using HyperClip.Core.Interfaces;

namespace HyperClip.UI.ViewModels.Settings;

public partial class DetectionTabViewModel : ObservableObject
{
    private readonly IPollerService _poller;
    private readonly IActivityService _activityService;

    [ObservableProperty] private bool _isPolling;
    [ObservableProperty] private int _pollIntervalMs = 5000;
    [ObservableProperty] private string _statusText = "Inactive";
    [ObservableProperty] private int _channelCount;
    [ObservableProperty] private int _videoCount;
    [ObservableProperty] private string? _lastError;

    public DetectionTabViewModel(IPollerService poller, IActivityService activityService)
    {
        _poller = poller;
        _activityService = activityService;
        IsPolling = poller.IsActive;
        RefreshStatus();
    }

    private void RefreshStatus()
    {
        var status = _poller.GetStatus();
        IsPolling = status.Active;
        PollIntervalMs = status.PollIntervalMs;
        StatusText = status.Active ? "Active" : "Inactive";
        ChannelCount = status.ChannelCount;
        VideoCount = status.VideoCount;
        LastError = status.LastError;
    }

    [RelayCommand]
    private void TogglePolling()
    {
        if (_poller.IsActive) { _poller.Pause(); _activityService.AddEntry("Poller paused", "warning"); }
        else { _poller.Resume(); _activityService.AddEntry("Poller resumed", "success"); }
        RefreshStatus();
    }
}

public class PollerStatusInfo
{
    public bool Active { get; set; }
    public int PollIntervalMs { get; set; }
    public long? LastPollAt { get; set; }
    public long? LastNewVideosAt { get; set; }
    public int ChannelCount { get; set; }
    public int VideoCount { get; set; }
    public int NewVideoCount { get; set; }
    public string? LastError { get; set; }
}
