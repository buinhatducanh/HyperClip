using System.Collections.ObjectModel;
using System.Windows;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using HyperClip.Core.Interfaces;
using HyperClip.Core.Models;
using HyperClip.Services.Store;
using Microsoft.Extensions.DependencyInjection;

namespace HyperClip.UI.ViewModels;

public partial class MainViewModel : ObservableObject
{
    private readonly IChannelStore _channelStore;
    private readonly IRenderedVideoStore _renderedVideoStore;
    private readonly IServiceProvider _services;

    [ObservableProperty] private ObservableCollection<Channel> _channels = [];
    [ObservableProperty] private ObservableCollection<RenderedVideo> _renderedVideos = [];
    [ObservableProperty] private Workspace? _selectedWorkspace;
    [ObservableProperty] private bool _isLoading = true;
    [ObservableProperty] private string _currentView = "dashboard";

    public TopBarViewModel TopBar { get; } = new();
    public WorkspaceQueueViewModel WorkspaceQueue { get; }
    public DetailEditorViewModel DetailEditor { get; }
    public ActivityLogViewModel ActivityLog { get; } = new();
    public SettingsViewModel SettingsVm => _services.GetRequiredService<SettingsViewModel>();
    public ChannelSidebarViewModel ChannelsVm => _services.GetRequiredService<ChannelSidebarViewModel>();
    public ToastViewModel ToastVm => _services.GetRequiredService<ToastViewModel>();
    public DetectionStatusBarViewModel DetectionStatus => _services.GetRequiredService<DetectionStatusBarViewModel>();
    public VideoDetailPanelViewModel DetailPanel { get; } = new();

    public MainViewModel(
        IWorkspaceStore workspaceStore,
        IChannelStore channelStore,
        IRenderedVideoStore renderedVideoStore,
        WorkspaceQueueViewModel workspaceQueue,
        DetailEditorViewModel detailEditor,
        IServiceProvider services)
    {
        _channelStore = channelStore;
        _renderedVideoStore = renderedVideoStore;
        _services = services;
        WorkspaceQueue = workspaceQueue;
        DetailEditor = detailEditor;
        _ = LoadDataAsync();
    }

    [RelayCommand]
    private void NavigateTo(string view)
    {
        CurrentView = view;
    }

    [RelayCommand]
    private void SelectWorkspace(Workspace? ws)
    {
        SelectedWorkspace = ws;
        if (ws != null)
        {
            DetailEditor.LoadWorkspace(ws);
            DetailPanel.LoadWorkspace(ws);
        }
    }

    private async Task LoadDataAsync()
    {
        IsLoading = true;
        try
        {
            var ch = await _channelStore.GetAllAsync();
            Channels = new ObservableCollection<Channel>(ch);
            var rv = await _renderedVideoStore.GetAllAsync();
            RenderedVideos = new ObservableCollection<RenderedVideo>(rv);
        }
        finally { IsLoading = false; }
    }
}
