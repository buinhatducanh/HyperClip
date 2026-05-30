using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using HyperClip.Core.Interfaces;

namespace HyperClip.UI.ViewModels.Settings;

public partial class StorageTabViewModel : ObservableObject
{
    private readonly IStorageService _storage;
    private readonly IActivityService _activityService;

    [ObservableProperty] private long _videoStorageBytes;
    [ObservableProperty] private long _outputBytes;
    [ObservableProperty] private long _blurCacheBytes;
    [ObservableProperty] private long _freeBytes;
    [ObservableProperty] private long _totalBytes;
    [ObservableProperty] private string _videoPath = "";
    [ObservableProperty] private string _outputPath = "";

    public StorageTabViewModel(IStorageService storage, IActivityService activityService)
    {
        _storage = storage;
        _activityService = activityService;
        VideoPath = storage.GetVideoStoragePath();
        OutputPath = storage.GetOutputPath();
        _ = RefreshAsync();
    }

    [RelayCommand]
    private async Task RefreshAsync()
    {
        var info = await _storage.GetDiskUsageAsync();
        VideoStorageBytes = info.VideoStorageBytes;
        OutputBytes = info.OutputBytes;
        BlurCacheBytes = info.BlurCacheBytes;
        FreeBytes = info.FreeBytes;
        TotalBytes = info.TotalBytes;
    }

    [RelayCommand]
    private async Task ClearDownloadsAsync()
    {
        await _storage.ClearDownloadsAsync();
        _activityService.AddEntry("Download cache cleared", "info");
        await RefreshAsync();
    }

    [RelayCommand]
    private async Task ClearBlurAsync()
    {
        await _storage.ClearBlurAsync();
        _activityService.AddEntry("Blur cache cleared", "info");
        await RefreshAsync();
    }

    [RelayCommand]
    private void OpenVideoFolder() => _storage.OpenFolder(VideoPath);

    [RelayCommand]
    private void OpenOutputFolder() => _storage.OpenFolder(OutputPath);

    public static string FormatBytes(long bytes) => bytes switch
    {
        > 1073741824 => $"{bytes / 1073741824.0:F1} GB",
        > 1048576 => $"{bytes / 1048576.0:F1} MB",
        > 1024 => $"{bytes / 1024.0:F1} KB",
        _ => $"{bytes} B"
    };
}
