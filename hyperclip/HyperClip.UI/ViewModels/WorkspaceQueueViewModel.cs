using System.Collections.ObjectModel;
using System.Windows;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using HyperClip.Core.Enums;
using HyperClip.Core.Interfaces;
using HyperClip.Core.Models;
using HyperClip.Services.Download;

#pragma warning disable CS4014 // Intentional fire-and-forget in ViewModel constructors and relay commands

namespace HyperClip.UI.ViewModels;

public partial class WorkspaceQueueViewModel : ObservableObject
{
    private readonly IWorkspaceStore _workspaceStore;
    private readonly DownloadPipeline _downloadPipeline;
    private readonly IYtdlpDownloader _downloader;

    [ObservableProperty] private string _inputUrl = "";
    [ObservableProperty] private string _inputError = "";
    [ObservableProperty] private bool _isDownloading;

    public ObservableCollection<Workspace> Workspaces { get; } = [];

    public WorkspaceQueueViewModel(IWorkspaceStore workspaceStore, DownloadPipeline downloadPipeline, IYtdlpDownloader downloader)
    {
        _workspaceStore = workspaceStore;
        _downloadPipeline = downloadPipeline;
        _downloader = downloader;
        _workspaceStore.WorkspaceUpdated += OnWorkspaceUpdated;
        _ = LoadWorkspacesAsync();
    }

    private async Task LoadWorkspacesAsync()
    {
        var all = await _workspaceStore.GetAllAsync();
        Application.Current.Dispatcher.InvokeAsync(() =>
        {
            Workspaces.Clear();
            foreach (var ws in all) Workspaces.Add(ws);
        });
    }

    private void OnWorkspaceUpdated(object? sender, Workspace ws)
    {
        Application.Current.Dispatcher.InvokeAsync(() =>
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
        Application.Current.Dispatcher.Invoke(() =>
        {
            next = Workspaces.FirstOrDefault(w => w.Status == WorkspaceStatus.Waiting || w.Status == WorkspaceStatus.New);
        });

        if (next == null) return;

        IsDownloading = true;
        try
        {
            await _downloadPipeline.StartDownloadAsync(next);
        }
        finally
        {
            IsDownloading = false;
            _ = DownloadNextAsync();
        }
    }

    [RelayCommand]
    private async Task RetryAsync(Workspace ws)
    {
        await _workspaceStore.UpdateStatusAsync(ws.Id, WorkspaceStatus.Waiting);
        _ = DownloadNextAsync();
    }
}

#pragma warning restore CS4014
