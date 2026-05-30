using System.Collections.ObjectModel;
using System.Diagnostics;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using HyperClip.Core.Interfaces;
using HyperClip.Core.Models;

namespace HyperClip.UI.ViewModels;

public partial class ChannelSidebarViewModel : ObservableObject
{
    private readonly IChannelStore _channelStore;
    private readonly IChannelService _channelService;
    private readonly IActivityService _activityService;

    [ObservableProperty] private ObservableCollection<Channel> _channels = [];
    [ObservableProperty] private Channel? _selectedChannel;
    [ObservableProperty] private string _inputUrl = "";

    public ChannelSidebarViewModel(
        IChannelStore channelStore,
        IChannelService channelService,
        IActivityService activityService)
    {
        _channelStore = channelStore;
        _channelService = channelService;
        _activityService = activityService;
        _channelStore.ChannelUpdated += OnChannelUpdated;
        _ = LoadChannelsAsync();
    }

    private async Task LoadChannelsAsync()
    {
        var all = await _channelStore.GetAllAsync();
        await System.Windows.Application.Current.Dispatcher.InvokeAsync(() =>
        {
            Channels.Clear();
            foreach (var ch in all) Channels.Add(ch);
        });
    }

    private void OnChannelUpdated(object? sender, Channel ch)
    {
        System.Windows.Application.Current.Dispatcher.InvokeAsync(() =>
        {
            var existing = Channels.FirstOrDefault(c => c.Id == ch.Id);
            if (existing != null)
            {
                var idx = Channels.IndexOf(existing);
                Channels[idx] = ch;
            }
            else Channels.Add(ch);
        });
    }

    [RelayCommand]
    private async Task AddChannelAsync()
    {
        var url = InputUrl.Trim();
        if (string.IsNullOrEmpty(url)) return;

        var channel = await _channelService.AddChannelAsync(url);
        if (channel != null)
        {
            InputUrl = "";
            _activityService.AddEntry($"Channel added: {channel.Name}", "success");
        }
    }

    [RelayCommand]
    private async Task PauseChannelAsync(Channel? ch)
    {
        if (ch == null) return;
        await _channelService.PauseChannelAsync(ch.Id);
        _activityService.AddEntry($"Channel paused: {ch.Name}", "warning");
    }

    [RelayCommand]
    private async Task ResumeChannelAsync(Channel? ch)
    {
        if (ch == null) return;
        await _channelService.ResumeChannelAsync(ch.Id);
        _activityService.AddEntry($"Channel resumed: {ch.Name}", "success");
    }

    [RelayCommand]
    private async Task DeleteChannelAsync(Channel? ch)
    {
        if (ch == null) return;
        await _channelStore.DeleteAsync(ch.Id);
        _activityService.AddEntry($"Channel removed: {ch.Name}", "info");
    }

    [RelayCommand]
    private void OpenChannel(Channel? ch)
    {
        if (ch?.ChannelId != null)
            Process.Start(new ProcessStartInfo($"https://youtube.com/channel/{ch.ChannelId}") { UseShellExecute = true });
    }
}
