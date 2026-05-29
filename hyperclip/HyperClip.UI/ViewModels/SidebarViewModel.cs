using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using HyperClip.Core.Interfaces;
using HyperClip.Core.Models;

namespace HyperClip.UI.ViewModels;

public partial class SidebarViewModel : ObservableObject
{
    private readonly IChannelStore _channelStore;

    [ObservableProperty] private ObservableCollection<Channel> _channels = [];
    [ObservableProperty] private string _selectedView = "dashboard";

    public SidebarViewModel(IChannelStore channelStore)
    {
        _channelStore = channelStore;
        _ = LoadChannelsAsync();
    }

    private async Task LoadChannelsAsync()
    {
        var ch = await _channelStore.GetAllAsync();
        Channels = new ObservableCollection<Channel>(ch);
    }

    [RelayCommand]
    private void Navigate(string view) => SelectedView = view;
}
