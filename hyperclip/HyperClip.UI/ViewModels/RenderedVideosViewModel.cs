using System.Collections.ObjectModel;
using System.Diagnostics;
using System.IO;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using HyperClip.Core.Interfaces;
using HyperClip.Core.Models;
using HyperClip.Services.Store;

namespace HyperClip.UI.ViewModels;

public partial class RenderedVideosViewModel : ObservableObject
{
    private readonly IRenderedVideoStore _store;
    private readonly IActivityService _activityService;

    [ObservableProperty] private ObservableCollection<RenderedVideo> _videos = [];
    [ObservableProperty] private RenderedVideo? _selectedVideo;

    public RenderedVideosViewModel(IRenderedVideoStore store, IActivityService activityService)
    {
        _store = store;
        _activityService = activityService;
        _ = LoadAsync();
    }

    private async Task LoadAsync()
    {
        var all = await _store.GetAllAsync();
        await System.Windows.Application.Current.Dispatcher.InvokeAsync(() =>
        {
            Videos.Clear();
            foreach (var v in all) Videos.Add(v);
        });
    }

    [RelayCommand]
    private void OpenOutputFolder(RenderedVideo? video)
    {
        if (video?.OutputPath != null)
        {
            var dir = Path.GetDirectoryName(video.OutputPath);
            if (dir != null && Directory.Exists(dir))
                Process.Start(new ProcessStartInfo("explorer.exe", dir) { UseShellExecute = true });
        }
    }

    [RelayCommand]
    private async Task DeleteVideoAsync(RenderedVideo? video)
    {
        if (video == null) return;
        await _store.DeleteAsync(video.Id);
        Videos.Remove(video);
        _activityService.AddEntry($"Rendered video deleted: {video.VideoTitle}", "info");
    }
}
