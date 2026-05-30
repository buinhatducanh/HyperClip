using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using HyperClip.Core.Interfaces;

namespace HyperClip.UI.ViewModels.Settings;

public partial class LogsTabViewModel : ObservableObject
{
    private readonly ILogService _logService;

    [ObservableProperty] private ObservableCollection<string> _logLines = [];
    [ObservableProperty] private long _diskUsageBytes;
    [ObservableProperty] private bool _isLoading;

    public LogsTabViewModel(ILogService logService)
    {
        _logService = logService;
        _ = RefreshAsync();
    }

    [RelayCommand]
    private async Task RefreshAsync()
    {
        IsLoading = true;
        try
        {
            var lines = await _logService.ReadLogsAsync(200);
            LogLines = new ObservableCollection<string>(lines);
            DiskUsageBytes = await _logService.GetLogDiskUsageAsync();
        }
        finally { IsLoading = false; }
    }

    [RelayCommand]
    private async Task ExportAsync()
    {
        var dialog = new Microsoft.Win32.SaveFileDialog
        {
            Filter = "Log files (*.log)|*.log|All files (*.*)|*.*",
            DefaultExt = ".log",
            FileName = $"hyperclip-logs-{DateTime.Now:yyyyMMdd}.log"
        };
        if (dialog.ShowDialog() == true)
        {
            await _logService.ExportLogsAsync(dialog.FileName);
        }
    }
}
