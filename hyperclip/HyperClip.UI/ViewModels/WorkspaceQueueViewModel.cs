using System.Collections.ObjectModel;
using System.Windows;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using HyperClip.Core.Enums;
using HyperClip.Core.Interfaces;
using HyperClip.Core.Models;
using HyperClip.Services.Download;
using HyperClip.Services.Store;

#pragma warning disable CS4014

namespace HyperClip.UI.ViewModels;

public partial class WorkspaceQueueViewModel : ObservableObject
{
    private readonly IWorkspaceStore _workspaceStore;
    private readonly IRenderedVideoStore _renderedVideoStore;
    private readonly DownloadPipeline _downloadPipeline;
    private readonly IYtdlpDownloader _downloader;
    private readonly List<Workspace> _allWorkspaces = [];

    [ObservableProperty] private string _inputUrl = "";
    [ObservableProperty] private string _inputError = "";
    [ObservableProperty] private bool _isDownloading;
    [ObservableProperty] private string _searchQuery = "";
    [ObservableProperty] private string _selectedTab = "pipeline";
    [ObservableProperty] private string _statusFilter = "all";
    [ObservableProperty] private int _totalCount;
    [ObservableProperty] private int _waitingCount;
    [ObservableProperty] private int _downloadingCount;
    [ObservableProperty] private int _readyCount;
    [ObservableProperty] private int _renderingCount;
    [ObservableProperty] private int _doneCount;
    [ObservableProperty] private int _errorCount;

    public ObservableCollection<Workspace> Workspaces { get; } = [];
    public ObservableCollection<RenderedVideo> RenderedVideos { get; } = [];

    public WorkspaceQueueViewModel(
        IWorkspaceStore workspaceStore,
        IRenderedVideoStore renderedVideoStore,
        DownloadPipeline downloadPipeline,
        IYtdlpDownloader downloader)
    {
        _workspaceStore = workspaceStore;
        _renderedVideoStore = renderedVideoStore;
        _downloadPipeline = downloadPipeline;
        _downloader = downloader;
        _workspaceStore.WorkspaceUpdated += OnWorkspaceUpdated;
        _ = LoadWorkspacesAsync();
        _ = LoadRenderedVideosAsync();
    }

    private async Task LoadWorkspacesAsync()
    {
        var all = await _workspaceStore.GetAllAsync();
        _allWorkspaces.Clear();
        _allWorkspaces.AddRange(all);
        ApplyFilter();
    }

    private async Task LoadRenderedVideosAsync()
    {
        var all = await _renderedVideoStore.GetAllAsync();
        await Application.Current.Dispatcher.InvokeAsync(() =>
        {
            RenderedVideos.Clear();
            foreach (var v in all) RenderedVideos.Add(v);
        });
    }

    private void OnWorkspaceUpdated(object? sender, Workspace ws)
    {
        Application.Current.Dispatcher.InvokeAsync(() =>
        {
            var existing = _allWorkspaces.FirstOrDefault(w => w.Id == ws.Id);
            if (existing != null) _allWorkspaces[_allWorkspaces.IndexOf(existing)] = ws;
            else _allWorkspaces.Add(ws);
            ApplyFilter();
        });
    }

    partial void OnSearchQueryChanged(string value) => ApplyFilter();
    partial void OnStatusFilterChanged(string value) => ApplyFilter();
    partial void OnSelectedTabChanged(string value)
    {
        if (value == "rendered") _ = LoadRenderedVideosAsync();
        else ApplyFilter();
    }

    private void ApplyFilter()
    {
        var filtered = _allWorkspaces.AsEnumerable();

        if (!string.IsNullOrWhiteSpace(SearchQuery))
        {
            var q = SearchQuery.ToLowerInvariant();
            filtered = filtered.Where(ws =>
                (ws.VideoTitle?.ToLowerInvariant().Contains(q) == true) ||
                (ws.ChannelName?.ToLowerInvariant().Contains(q) == true));
        }

        if (StatusFilter != "all")
        {
            var status = StatusFilter switch
            {
                "waiting" => WorkspaceStatus.Waiting,
                "downloading" => WorkspaceStatus.Downloading,
                "ready" => WorkspaceStatus.Ready,
                "rendering" => WorkspaceStatus.Rendering,
                "done" => WorkspaceStatus.Done,
                "error" => WorkspaceStatus.Error,
                _ => WorkspaceStatus.Waiting
            };
            filtered = filtered.Where(ws => ws.Status == status);
        }

        var result = filtered.OrderByDescending(w => w.DetectedAt).ToList();

        Application.Current.Dispatcher.InvokeAsync(() =>
        {
            Workspaces.Clear();
            foreach (var ws in result) Workspaces.Add(ws);
            UpdateCounts();
        });
    }

    private void UpdateCounts()
    {
        TotalCount = _allWorkspaces.Count;
        WaitingCount = _allWorkspaces.Count(w => w.Status is WorkspaceStatus.Waiting or WorkspaceStatus.New);
        DownloadingCount = _allWorkspaces.Count(w => w.Status == WorkspaceStatus.Downloading);
        ReadyCount = _allWorkspaces.Count(w => w.Status == WorkspaceStatus.Ready);
        RenderingCount = _allWorkspaces.Count(w => w.Status == WorkspaceStatus.Rendering);
        DoneCount = _allWorkspaces.Count(w => w.Status == WorkspaceStatus.Done);
        ErrorCount = _allWorkspaces.Count(w => w.Status == WorkspaceStatus.Error);
    }

    [RelayCommand]
    private void SetStatusFilter(string filter) => StatusFilter = filter;

    [RelayCommand]
    private void SwitchTab(string tab) => SelectedTab = tab;

    [RelayCommand]
    private async Task AddAndDownloadAsync()
    {
        var url = InputUrl.Trim();
        if (string.IsNullOrEmpty(url)) return;

        InputError = "";
        if (!url.Contains("youtube.com") && !url.Contains("youtu.be"))
        {
            InputError = "Paste a YouTube URL";
            return;
        }

        var workspace = new Workspace
        {
            Id = Guid.NewGuid().ToString("N")[..12],
            VideoUrl = url,
            VideoTitle = "Loading...",
            Status = WorkspaceStatus.Waiting,
            DetectedAt = DateTime.UtcNow.ToString("o"),
        };

        await _workspaceStore.SaveAsync(workspace);
        InputUrl = "";
        _ = DownloadNextAsync();
    }

    [RelayCommand]
    private async Task DownloadNextAsync()
    {
        if (IsDownloading) return;

        Workspace? next = null;
        await Application.Current.Dispatcher.InvokeAsync(() =>
        {
            next = _allWorkspaces.FirstOrDefault(w => w.Status == WorkspaceStatus.Waiting || w.Status == WorkspaceStatus.New);
        });

        if (next == null) return;

        IsDownloading = true;
        try { await _downloadPipeline.StartDownloadAsync(next); }
        finally { IsDownloading = false; _ = DownloadNextAsync(); }
    }

    [RelayCommand]
    private async Task RetryAsync(Workspace ws)
    {
        await _workspaceStore.UpdateStatusAsync(ws.Id, WorkspaceStatus.Waiting);
        _ = DownloadNextAsync();
    }

    [RelayCommand]
    private async Task DeleteWorkspaceAsync(Workspace? ws)
    {
        if (ws == null) return;
        var vm = new ConfirmationViewModel
        {
            Title = "Delete Workspace",
            Message = $"Delete \"{ws.VideoTitle}\"? This action cannot be undone.",
            ConfirmText = "Delete"
        };
        var dialog = new Views.ConfirmationDialogView(vm) { Owner = Application.Current.MainWindow };
        if (dialog.ShowDialog() == true)
        {
            await _workspaceStore.DeleteAsync(ws.Id);
            _allWorkspaces.RemoveAll(w => w.Id == ws.Id);
            ApplyFilter();
        }
    }

    [RelayCommand]
    private void OpenWorkspaceFolder(Workspace? ws)
    {
        if (ws?.DownloadedPath == null) return;
        var dir = System.IO.Path.GetDirectoryName(ws.DownloadedPath);
        if (dir != null && System.IO.Directory.Exists(dir))
            System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo("explorer.exe", dir) { UseShellExecute = true });
    }

    [RelayCommand]
    private async Task DeleteRenderedVideoAsync(RenderedVideo? video)
    {
        if (video == null) return;
        await _renderedVideoStore.DeleteAsync(video.Id);
        RenderedVideos.Remove(video);
    }

    [RelayCommand]
    private void OpenRenderedFolder(RenderedVideo? video)
    {
        if (video?.OutputPath == null) return;
        var dir = System.IO.Path.GetDirectoryName(video.OutputPath);
        if (dir != null && System.IO.Directory.Exists(dir))
            System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo("explorer.exe", dir) { UseShellExecute = true });
    }
}

#pragma warning restore CS4014
