using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using HyperClip.Core.Interfaces;
using HyperClip.Core.Models;
using HyperClip.Services.Store;

namespace HyperClip.UI.ViewModels;

public partial class MainViewModel : ObservableObject
{
    private readonly IWorkspaceStore _workspaceStore;
    private readonly IChannelStore _channelStore;
    private readonly IRenderedVideoStore _renderedVideoStore;

    [ObservableProperty] private ObservableCollection<Workspace> _workspaces = [];
    [ObservableProperty] private ObservableCollection<Channel> _channels = [];
    [ObservableProperty] private ObservableCollection<RenderedVideo> _renderedVideos = [];
    [ObservableProperty] private Workspace? _selectedWorkspace;
    [ObservableProperty] private bool _isLoading = true;

    public TopBarViewModel TopBar { get; } = new();
    public WorkspaceQueueViewModel WorkspaceQueue { get; }
    public DetailEditorViewModel DetailEditor { get; }
    public ActivityLogViewModel ActivityLog { get; } = new();

    public MainViewModel(
        IWorkspaceStore workspaceStore,
        IChannelStore channelStore,
        IRenderedVideoStore renderedVideoStore,
        WorkspaceQueueViewModel workspaceQueue,
        DetailEditorViewModel detailEditor)
    {
        _workspaceStore = workspaceStore;
        _channelStore = channelStore;
        _renderedVideoStore = renderedVideoStore;
        WorkspaceQueue = workspaceQueue;
        DetailEditor = detailEditor;
        _workspaceStore.WorkspaceUpdated += OnWorkspaceUpdated;
        _ = LoadDataAsync();
    }

    private async Task LoadDataAsync()
    {
        IsLoading = true;
        try
        {
            var ws = await _workspaceStore.GetAllAsync();
            Workspaces = new ObservableCollection<Workspace>(ws);
            var ch = await _channelStore.GetAllAsync();
            Channels = new ObservableCollection<Channel>(ch);
            var rv = await _renderedVideoStore.GetAllAsync();
            RenderedVideos = new ObservableCollection<RenderedVideo>(rv);
        }
        finally { IsLoading = false; }
    }

    private void OnWorkspaceUpdated(object? sender, Workspace ws)
    {
        System.Windows.Application.Current.Dispatcher.InvokeAsync(() =>
        {
            var existing = Workspaces.FirstOrDefault(w => w.Id == ws.Id);
            if (existing != null)
            {
                var idx = Workspaces.IndexOf(existing);
                Workspaces[idx] = ws;
            }
            else Workspaces.Add(ws);
        });
    }
}
