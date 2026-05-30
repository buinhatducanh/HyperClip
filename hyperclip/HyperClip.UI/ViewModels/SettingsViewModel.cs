using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using HyperClip.Core.Interfaces;
using HyperClip.Core.Models;
using HyperClip.UI.ViewModels.Settings;

namespace HyperClip.UI.ViewModels;

public partial class SettingsViewModel : ObservableObject
{
    private readonly ISettingsStore _settingsStore;

    [ObservableProperty] private AppSettings _settings = new();
    [ObservableProperty] private bool _isLoaded;
    [ObservableProperty] private string _statusMessage = "";

    public DetectionTabViewModel DetectionTab { get; }
    public SessionsTabViewModel SessionsTab { get; }
    public ProjectsTabViewModel ProjectsTab { get; }
    public ApiKeysTabViewModel ApiKeysTab { get; }
    public StorageTabViewModel StorageTab { get; }
    public DiagnosticsTabViewModel DiagnosticsTab { get; }
    public LogsTabViewModel LogsTab { get; }

    public SettingsViewModel(
        ISettingsStore settingsStore,
        IActivityService activityService,
        IPollerService poller,
        IStorageService storage,
        IDiagnosticsService diagnostics,
        ILogService logService,
        IAuthService authService)
    {
        _settingsStore = settingsStore;
        DetectionTab = new DetectionTabViewModel(poller, activityService);
        SessionsTab = new SessionsTabViewModel(authService);
        ProjectsTab = new ProjectsTabViewModel(activityService);
        ApiKeysTab = new ApiKeysTabViewModel(activityService);
        StorageTab = new StorageTabViewModel(storage, activityService);
        DiagnosticsTab = new DiagnosticsTabViewModel(diagnostics);
        LogsTab = new LogsTabViewModel(logService);
        _ = LoadAsync();
    }

    private async Task LoadAsync()
    {
        Settings = await _settingsStore.LoadAsync();
        IsLoaded = true;
    }

    [RelayCommand]
    private async Task SaveAsync()
    {
        await _settingsStore.SaveAsync(Settings);
        StatusMessage = "Saved";
        await Task.Delay(3000);
        StatusMessage = "";
    }
}
