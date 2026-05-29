using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using HyperClip.Core.Interfaces;
using HyperClip.Core.Models;

namespace HyperClip.UI.ViewModels;

public partial class SettingsViewModel : ObservableObject
{
    private readonly ISettingsStore _settingsStore;

    [ObservableProperty] private AppSettings _settings = new();
    [ObservableProperty] private bool _isLoaded;
    [ObservableProperty] private string _statusMessage = "";

    public SettingsViewModel(ISettingsStore settingsStore)
    {
        _settingsStore = settingsStore;
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
    }
}
